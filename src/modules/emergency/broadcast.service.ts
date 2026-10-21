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
      if (!recipientOrgName) {
        const recipientProfile = await this.prisma.recipientProfile.findUnique({
          where: { id: request.recipientId },
          include: { organization: true },
        });
        recipientOrgName = recipientProfile?.organization?.name || 'Mitra Posko Darurat';
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
          neededFoodType: request.neededFoodType,
          foodTypeName: request.foodTypeName,
          requestedPortions: request.requestedPortions,
          targetQuantityKg,
          urgencyLevel: request.urgencyLevel,
          urgencyDeadline: request.urgencyDeadline,
          urgencyReason: request.urgencyReason,
          contactPerson: request.contactPerson,
          contactPhone: request.contactPhone,
          radiusKm: 10.0,
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
   * Retrieve active emergency broadcasts for suppliers
   */
  async findActive(user: AuthenticatedUser) {
    await this.expireStaleBroadcasts();

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
          },
        },
      },
      orderBy: [
        { urgencyLevel: 'asc' }, // CRITICAL before HIGH before MEDIUM
        { createdAt: 'desc' },
      ],
    });

    return broadcasts.map((b) => ({
      ...b,
      hasResponded: b.supplierResponses.length > 0,
    }));
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
