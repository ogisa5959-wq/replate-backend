import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { RespondBroadcastDto } from './dto/respond-broadcast.dto';
import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { calculateHaversineDistanceKm } from '@/common/utils/haversine.util';
import {
  BroadcastStatus,
  SupplierResponseStatus,
  EmergencyUrgencyLevel,
  EmergencyRequestStatus,
  UserRole,
  FoodCategory,
  FoodCondition,
  PackagingStatus,
  ListingLifecycleStatus,
  FoodSafetyStatus,
  RouteHierarchy,
  JourneyStatus,
  AuditAction,
  EmergencyFoodRequest,
} from '@prisma/client';

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Helper to calculate expiry date based on urgency level
   */
  calculateExpiry(urgencyLevel: EmergencyUrgencyLevel): Date {
    const now = new Date();
    if (urgencyLevel === EmergencyUrgencyLevel.CRITICAL) {
      return new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours
    }
    if (urgencyLevel === EmergencyUrgencyLevel.HIGH) {
      return new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours
    }
    // MEDIUM: End of day (WIB is UTC+7, 23:59:59 WIB is 16:59:59.999 UTC)
    const wibNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const endOfDayUtc = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate(), 16, 59, 59, 999));
    return endOfDayUtc.getTime() > now.getTime()
      ? endOfDayUtc
      : new Date(endOfDayUtc.getTime() + 24 * 60 * 60 * 1000);
  }

  /**
   * Automatically publish an EmergencyBroadcast when an EmergencyFoodRequest is created
   */
  async publishFromRequest(request: EmergencyFoodRequest & { recipient?: { organization?: { name: string } } }) {
    try {
      let recipientOrgName = request.recipient?.organization?.name;
      let poskoLatitude: number | null = null;
      let poskoLongitude: number | null = null;

      const recipientProfile = await this.prisma.recipientProfile.findUnique({
        where: { id: request.recipientId },
        include: { organization: true },
      });

      if (!recipientOrgName) {
        recipientOrgName = recipientProfile?.organization?.name || 'Mitra Posko Darurat';
      }

      if (recipientProfile?.latitude && recipientProfile?.longitude) {
        poskoLatitude = Number(recipientProfile.latitude);
        poskoLongitude = Number(recipientProfile.longitude);
      } else if (recipientProfile?.organization?.latitude && recipientProfile?.organization?.longitude) {
        poskoLatitude = Number(recipientProfile.organization.latitude);
        poskoLongitude = Number(recipientProfile.organization.longitude);
      }

      const expiresAt = this.calculateExpiry(request.urgencyLevel);
      const targetQuantityKg = request.estimatedKg
        ? Number(request.estimatedKg)
        : Math.round(request.requestedPortions * 0.35 * 100) / 100;

      const broadcast = await this.prisma.emergencyBroadcast.create({
        data: {
          emergencyRequestId: request.id,
          recipientOrgName,
          recipientLocation: request.targetLocation,
          latitude: poskoLatitude,
          longitude: poskoLongitude,
          neededFoodType: request.neededFoodType,
          foodTypeName: request.foodTypeName,
          requestedPortions: request.requestedPortions,
          targetQuantityKg,
          urgencyLevel: request.urgencyLevel,
          urgencyDeadline: request.urgencyDeadline,
          urgencyReason: request.urgencyReason,
          contactPerson: request.contactPerson,
          contactPhone: request.contactPhone,
          radiusKm: 20.0,
          expiresAt,
          status: BroadcastStatus.ACTIVE,
        },
      });

      this.logger.log(`EmergencyBroadcast ${broadcast.id} published for request ${request.id}`);
      return broadcast;
    } catch (err: any) {
      this.logger.error(`Failed to publish broadcast for request ${request.id}: ${err.message}`, err.stack);
      throw err;
    }
  }

  /**
   * Background and lazy expiry routine
   */
  async expireStaleBroadcasts(): Promise<number> {
    const result = await this.prisma.emergencyBroadcast.updateMany({
      where: {
        status: BroadcastStatus.ACTIVE,
        expiresAt: { lte: new Date() },
      },
      data: {
        status: BroadcastStatus.EXPIRED,
      },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} overdue emergency broadcasts as EXPIRED`);
    }
    return result.count;
  }

  /**
   * Retrieve active emergency broadcasts for suppliers with geospatial targeting (< 20 km)
   */
  async findActive(
    user: AuthenticatedUser,
    queryCoords?: { latitude?: number; longitude?: number },
  ) {
    await this.expireStaleBroadcasts();

    // 1. Determine supplier coordinates (priority: queryCoords > user.organization in DB)
    let supplierLat: number | null = null;
    let supplierLon: number | null = null;

    if (
      queryCoords?.latitude !== undefined &&
      queryCoords?.longitude !== undefined &&
      !isNaN(queryCoords.latitude) &&
      !isNaN(queryCoords.longitude)
    ) {
      supplierLat = Number(queryCoords.latitude);
      supplierLon = Number(queryCoords.longitude);
    } else if (user.organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { latitude: true, longitude: true },
      });
      if (
        org?.latitude !== null &&
        org?.latitude !== undefined &&
        org?.longitude !== null &&
        org?.longitude !== undefined
      ) {
        supplierLat = Number(org.latitude);
        supplierLon = Number(org.longitude);
      }
    }

    const broadcasts = await this.prisma.emergencyBroadcast.findMany({
      where: {
        status: BroadcastStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: {
        supplierResponses: {
          where: { supplierOrgId: user.organizationId },
        },
        emergencyRequest: {
          select: {
            id: true,
            status: true,
            beneficiaryGroup: true,
            beneficiaryCount: true,
            recipient: {
              select: {
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },
      orderBy: [
        { urgencyLevel: 'asc' }, // CRITICAL before HIGH before MEDIUM
        { createdAt: 'desc' },
      ],
    });

    const results: any[] = [];

    for (const b of broadcasts) {
      const hasResponded = b.supplierResponses.length > 0;
      const poskoLat =
        b.latitude !== null && b.latitude !== undefined
          ? Number(b.latitude)
          : b.emergencyRequest?.recipient?.latitude
          ? Number(b.emergencyRequest.recipient.latitude)
          : null;

      const poskoLon =
        b.longitude !== null && b.longitude !== undefined
          ? Number(b.longitude)
          : b.emergencyRequest?.recipient?.longitude
          ? Number(b.emergencyRequest.recipient.longitude)
          : null;

      let distanceKm: number | null = null;
      if (
        supplierLat !== null &&
        supplierLon !== null &&
        poskoLat !== null &&
        poskoLon !== null
      ) {
        try {
          distanceKm = calculateHaversineDistanceKm(poskoLat, poskoLon, supplierLat, supplierLon);
        } catch {
          distanceKm = null;
        }
      }

      const allowedRadius = Number(b.radiusKm) || 20.0;

      // Filter: if user is SUPPLIER and both coordinates are known, exclude if distance exceeds allowed radius (< 20 km)
      if (user.role === UserRole.SUPPLIER && distanceKm !== null && distanceKm > allowedRadius) {
        continue;
      }

      results.push({
        ...b,
        hasResponded,
        distanceKm,
        requiresLocationSetup: supplierLat === null || supplierLon === null,
      });
    }

    // Sort: 1. Urgency Level, 2. distanceKm asc (nulls last), 3. createdAt desc
    results.sort((a, b) => {
      const urgencyRank: Record<string, number> = {
        CRITICAL: 1,
        HIGH: 2,
        MEDIUM: 3,
      };
      const rankDiff = (urgencyRank[a.urgencyLevel] || 99) - (urgencyRank[b.urgencyLevel] || 99);
      if (rankDiff !== 0) return rankDiff;

      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      if (a.distanceKm !== null && b.distanceKm === null) return -1;
      if (a.distanceKm === null && b.distanceKm !== null) return 1;

      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return results;
  }

  /**
   * Retrieve all SOS responses confirmed by the calling supplier
   */
  async findMyResponses(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPPLIER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya penyedia surplus atau admin yang dapat melihat riwayat respons bantuan');
    }

    return this.prisma.supplierBroadcastResponse.findMany({
      where: { supplierOrgId: user.organizationId },
      include: {
        broadcast: true,
      },
      orderBy: { respondedAt: 'desc' },
    });
  }

  /**
   * Atomically confirm SOS response from a supplier
   */
  async respondToBroadcast(broadcastId: string, dto: RespondBroadcastDto, user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPPLIER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya penyedia surplus atau admin yang berwenang merespons siaran SOS darurat');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock emergency broadcast row
      const lockedRows = await tx.$queryRaw<any[]>`
        SELECT id, emergency_request_id, status, expires_at, recipient_org_name,
               needed_food_type, food_type_name, requested_portions, target_quantity_kg
        FROM emergency_broadcasts
        WHERE id = ${broadcastId}::uuid
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new NotFoundException(`Siaran darurat dengan ID ${broadcastId} tidak ditemukan`);
      }

      const row = lockedRows[0];

      if (row.status !== BroadcastStatus.ACTIVE) {
        throw new UnprocessableEntityException(
          `Siaran darurat tidak dapat direspons karena berstatus ${row.status}`,
        );
      }

      if (new Date(row.expires_at) <= new Date()) {
        await tx.emergencyBroadcast.update({
          where: { id: broadcastId },
          data: { status: BroadcastStatus.EXPIRED },
        });
        throw new UnprocessableEntityException(
          'Siaran darurat telah melewati batas waktu (kedaluwarsa) dan tidak dapat lagi direspons',
        );
      }

      // 1.5 Validate physical distance (< 20 km) if user is SUPPLIER and coordinates exist
      if (user.role === UserRole.SUPPLIER && user.organizationId) {
        const suppOrg = await tx.organization.findUnique({
          where: { id: user.organizationId },
          select: { latitude: true, longitude: true },
        });

        const bcast = await tx.emergencyBroadcast.findUnique({
          where: { id: broadcastId },
          select: { latitude: true, longitude: true, radiusKm: true },
        });

        if (
          suppOrg?.latitude !== null &&
          suppOrg?.latitude !== undefined &&
          suppOrg?.longitude !== null &&
          suppOrg?.longitude !== undefined &&
          bcast?.latitude !== null &&
          bcast?.latitude !== undefined &&
          bcast?.longitude !== null &&
          bcast?.longitude !== undefined
        ) {
          const distKm = calculateHaversineDistanceKm(
            Number(bcast.latitude),
            Number(bcast.longitude),
            Number(suppOrg.latitude),
            Number(suppOrg.longitude),
          );
          const maxRadius = Number(bcast.radiusKm) || 20.0;
          if (distKm > maxRadius) {
            throw new BadRequestException(
              `Lokasi dapur Anda berjarak ${distKm} km dari posko, melebihi batas radius tanggap darurat (${maxRadius} km)`,
            );
          }
        }
      }

      // 2. Prevent duplicate responses from the same supplier organization
      const existingResponse = await tx.supplierBroadcastResponse.findUnique({
        where: {
          broadcastId_supplierOrgId: {
            broadcastId,
            supplierOrgId: user.organizationId,
          },
        },
      });

      if (existingResponse) {
        throw new ConflictException('Organisasi Anda sudah pernah mengonfirmasi respons untuk siaran darurat ini');
      }

      // 3. Verify underlying emergency request
      const emgReq = await tx.emergencyFoodRequest.findUnique({
        where: { id: row.emergency_request_id },
        include: { recipient: true },
      });

      if (!emgReq || emgReq.isDeleted || emgReq.status !== EmergencyRequestStatus.OPEN) {
        throw new BadRequestException('Permohonan darurat terkait sudah tidak aktif atau telah dialokasikan');
      }

      // 4. Resolve food category and food type
      let foodCategory: FoodCategory = FoodCategory.COOKED_MEALS;
      if (row.needed_food_type === 'fresh_produce') {
        foodCategory = FoodCategory.FRESH_PRODUCE;
      } else if (row.needed_food_type === 'bakery_snacks') {
        foodCategory = FoodCategory.BAKERY_PASTRY;
      } else if (row.needed_food_type === 'pantry_staples') {
        foodCategory = FoodCategory.PACKAGED_DRY;
      }

      let foodType = await tx.foodType.findFirst({
        where: { code: row.needed_food_type },
      });
      if (!foodType) {
        foodType = await tx.foodType.findFirst();
      }

      // 5. Fetch supplier organization name
      const supplierOrg = await tx.organization.findUnique({
        where: { id: user.organizationId },
      });
      const supplierOrgName = supplierOrg?.name || user.fullName || 'Penyedia Surplus';

      // 6. Create SurplusListing with emergency response flag
      const surplusListing = await tx.surplusListing.create({
        data: {
          donorOrganizationId: user.organizationId,
          reporterUserId: user.id,
          foodTypeId: foodType?.id,
          foodName: row.food_type_name || foodType?.nameId || 'Makanan Darurat Siap Santap',
          foodCategory,
          quantityKg: Number(row.target_quantity_kg),
          portions: Number(row.requested_portions),
          condition: FoodCondition.FRESH,
          packagingStatus: PackagingStatus.INTACT_SEALED,
          hygieneScore: 5,
          preparedAt: new Date(),
          safeUntilTimestamp: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4h window
          notes: dto.notes
            ? `[RESPONS DARURAT SOS] ${dto.notes}`
            : '[RESPONS DARURAT SOS] Atestasi donor: Makanan aman, higienis, dan layak konsumsi.',
          currentLifecycleStatus: ListingLifecycleStatus.MATCHED,
          isEmergencyResponse: true,
        },
      });

      // 7. Auto-generate FoodSafetyAssessment with PASS status (emergency donor attestation)
      await tx.foodSafetyAssessment.create({
        data: {
          listingId: surplusListing.id,
          safetyStatus: FoodSafetyStatus.PASS,
          gateReasons: ['Atestasi darurat donor: Makanan disiapkan higienis dan dinyatakan aman untuk konsumsi manusia'],
          storageHistoryKnown: true,
          isExpired: false,
          hasSpoilageSigns: false,
          packagingDamaged: false,
          hygieneAdequate: true,
          tempAbuseDetected: false,
        },
      });

      // 8. Auto-generate RescueScoreAssessment
      await tx.rescueScoreAssessment.create({
        data: {
          listingId: surplusListing.id,
          totalScore: 92.0,
          conditionSubscore: 30.0,
          urgencySubscore: 25.0,
          quantitySubscore: 15.0,
          easeSubscore: 12.0,
          destinationFitSubscore: 10.0,
          recommendedRoute: RouteHierarchy.REDISTRIBUTE,
          scoreBreakdown: { emergencyPriority: true },
        },
      });

      // 9. Auto-create RescueJourney in MATCHED status
      const journey = await tx.rescueJourney.create({
        data: {
          listingId: surplusListing.id,
          recipientId: emgReq.recipientId,
          currentStatus: JourneyStatus.MATCHED,
          notes: `Respons darurat SOS dari ${supplierOrgName} untuk posko: ${emgReq.targetLocation}`,
        },
      });

      // 10. Create JourneyTimelineEvent
      await tx.journeyTimelineEvent.create({
        data: {
          journeyId: journey.id,
          status: JourneyStatus.MATCHED,
          note: `Bantuan darurat dikonfirmasi oleh donor (${supplierOrgName}). Siap didistribusikan ke posko penerima.`,
          actorUserId: user.id,
        },
      });

      // 11. Create SupplierBroadcastResponse
      const response = await tx.supplierBroadcastResponse.create({
        data: {
          broadcastId,
          supplierOrgId: user.organizationId,
          supplierOrgName,
          supplierUserId: user.id,
          surplusListingId: surplusListing.id,
          journeyId: journey.id,
          status: SupplierResponseStatus.CONFIRMED,
        },
      });

      // 12. Update EmergencyBroadcast status to RESPONDED
      await tx.emergencyBroadcast.update({
        where: { id: broadcastId },
        data: { status: BroadcastStatus.RESPONDED },
      });

      // 13. Update EmergencyFoodRequest status to ALLOCATED
      await tx.emergencyFoodRequest.update({
        where: { id: emgReq.id },
        data: {
          status: EmergencyRequestStatus.ALLOCATED,
          matchedSurplusId: surplusListing.id,
          matchedAt: new Date(),
        },
      });

      // 14. Log audit entry
      await tx.auditLog.create({
        data: {
          tableName: 'emergency_broadcasts',
          recordId: broadcastId,
          action: AuditAction.UPDATE,
          actorUserId: user.id,
          previousState: { status: BroadcastStatus.ACTIVE },
          newState: {
            status: BroadcastStatus.RESPONDED,
            surplusListingId: surplusListing.id,
            journeyId: journey.id,
          },
          reason: 'Penyedia surplus mengonfirmasi pengiriman bantuan pangan darurat via SOS Broadcast',
        },
      });

      return {
        success: true,
        message: 'Bantuan pangan darurat berhasil dikonfirmasi dan dicatat ke dalam logistik perjalanan.',
        data: {
          response,
          journey,
          surplusListing,
        },
      };
    });
  }

  /**
   * Cancel or update broadcast status
   */
  async updateStatus(broadcastId: string, status: BroadcastStatus, user: AuthenticatedUser) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya administrator yang berwenang mengubah status siaran secara manual');
    }

    const broadcast = await this.prisma.emergencyBroadcast.findUnique({
      where: { id: broadcastId },
    });

    if (!broadcast) {
      throw new NotFoundException(`Siaran darurat dengan ID ${broadcastId} tidak ditemukan`);
    }

    return this.prisma.emergencyBroadcast.update({
      where: { id: broadcastId },
      data: { status },
    });
  }

  /**
   * Cancel broadcast when associated emergency request is cancelled
   */
  async cancelByRequestId(emergencyRequestId: string) {
    return this.prisma.emergencyBroadcast.updateMany({
      where: {
        emergencyRequestId,
        status: BroadcastStatus.ACTIVE,
      },
      data: {
        status: BroadcastStatus.CANCELLED,
      },
    });
  }
}
