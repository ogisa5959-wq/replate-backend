import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateEmergencyRequestDto } from './dto/create-emergency-request.dto';
import { AllocateEmergencyDto } from './dto/allocate-emergency.dto';
import { UpdateEmergencyStatusDto } from './dto/update-emergency-status.dto';
import { CapacityService } from '../recipients/capacity.service';
import { BroadcastService } from './broadcast.service';
import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import {
  safeCalculateHaversineDistanceKm,
  estimateTransitMinutes,
} from '@/common/utils/haversine.util';
import {
  EmergencyRequestStatus,
  EmergencyUrgencyLevel,
  UserRole,
  ListingLifecycleStatus,
  JourneyStatus,
  AuditAction,
  FoodSafetyStatus,
  RouteHierarchy,
  BroadcastStatus,
} from '@prisma/client';

@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    private prisma: PrismaService,
    private capacityService: CapacityService,
    private broadcastService: BroadcastService,
  ) {}

  async create(dto: CreateEmergencyRequestDto, user: AuthenticatedUser) {
    if (user.role !== UserRole.MITRA && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya Mitra Penerima atau Admin yang berwenang mengajukan permohonan darurat');
    }

    const recipientProfile = await this.prisma.recipientProfile.findUnique({
      where: { organizationId: user.organizationId },
    });

    if (!recipientProfile) {
      throw new BadRequestException('Profil mitra penerima untuk organisasi Anda belum terdaftar');
    }

    const estimatedKg = Math.round(dto.requestedPortions * 0.35 * 100) / 100;

    const request = await this.prisma.emergencyFoodRequest.create({
      data: {
        recipientId: recipientProfile.id,
        requesterUserId: user.id,
        neededFoodType: dto.neededFoodType,
        foodTypeName: dto.foodTypeName,
        requestedPortions: dto.requestedPortions,
        estimatedKg,
        beneficiaryCount: dto.beneficiaryCount,
        beneficiaryGroup: dto.beneficiaryGroup,
        targetLocation: dto.targetLocation,
        urgencyLevel: dto.urgencyLevel,
        urgencyDeadline: dto.urgencyDeadline,
        urgencyReason: dto.urgencyReason,
        contactPerson: dto.contactPerson,
        contactPhone: dto.contactPhone,
        notes: dto.notes,
        status: EmergencyRequestStatus.OPEN,
      },
      include: {
        recipient: { include: { organization: true } },
        requester: { select: { id: true, fullName: true, email: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tableName: 'emergency_food_requests',
        recordId: request.id,
        action: AuditAction.CREATE,
        actorUserId: user.id,
        newState: {
          portions: dto.requestedPortions,
          urgency: dto.urgencyLevel,
          target: dto.targetLocation,
        },
        reason: 'Pengajuan permohonan distribusi pangan darurat baru',
      },
    });

    // Auto-publish emergency SOS broadcast to suppliers
    await this.broadcastService.publishFromRequest(request);

    return request;
  }

  async findAll(params: {
    status?: EmergencyRequestStatus;
    urgencyLevel?: EmergencyUrgencyLevel;
  }) {
    const where: any = { isDeleted: false };
    if (params.status) where.status = params.status;
    if (params.urgencyLevel) where.urgencyLevel = params.urgencyLevel;

    return this.prisma.emergencyFoodRequest.findMany({
      where,
      include: {
        recipient: { include: { organization: true } },
        requester: { select: { id: true, fullName: true, email: true } },
        matchedSurplus: {
          include: {
            donorOrganization: true,
            safetyAssessment: true,
            scoreAssessment: true,
          },
        },
      },
      orderBy: [
        { urgencyLevel: 'asc' }, // CRITICAL before HIGH before MEDIUM
        { createdAt: 'desc' },
      ],
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.emergencyFoodRequest.findUnique({
      where: { id },
      include: {
        recipient: { include: { organization: true } },
        requester: { select: { id: true, fullName: true, email: true } },
        matchedSurplus: {
          include: {
            donorOrganization: true,
            safetyAssessment: true,
            scoreAssessment: true,
            journeys: {
              include: {
                timelineEvents: { orderBy: { timestamp: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!request || request.isDeleted) {
      throw new NotFoundException(`Permohonan darurat dengan ID ${id} tidak ditemukan`);
    }

    return request;
  }

  async findMatchingSurplus(id: string, user: AuthenticatedUser) {
    const emergencyRequest = await this.findOne(id);

    const poskoLat: number | null = emergencyRequest.recipient?.latitude
      ? Number(emergencyRequest.recipient.latitude)
      : (emergencyRequest.recipient?.organization?.latitude ? Number(emergencyRequest.recipient.organization.latitude) : null);
    const poskoLon: number | null = emergencyRequest.recipient?.longitude
      ? Number(emergencyRequest.recipient.longitude)
      : (emergencyRequest.recipient?.organization?.longitude ? Number(emergencyRequest.recipient.organization.longitude) : null);

    // Hard Gate: only match listings where Food Safety Gate is PASS and route is REDISTRIBUTE or PROCESS
    const listings = await this.prisma.surplusListing.findMany({
      where: {
        isDeleted: false,
        currentLifecycleStatus: {
          in: [ListingLifecycleStatus.REPORTED, ListingLifecycleStatus.ASSESSED],
        },
        safeUntilTimestamp: {
          gt: new Date(),
        },
        safetyAssessment: {
          safetyStatus: FoodSafetyStatus.PASS,
        },
        scoreAssessment: {
          recommendedRoute: {
            in: [RouteHierarchy.REDISTRIBUTE, RouteHierarchy.PROCESS],
          },
        },
      },
      include: {
        donorOrganization: true,
        safetyAssessment: true,
        scoreAssessment: true,
      },
      orderBy: [
        { scoreAssessment: { totalScore: 'desc' } },
        { createdAt: 'asc' },
      ],
    });

    const mapped = listings.map((listing) => {
      const donorLat = listing.donorOrganization?.latitude !== null && listing.donorOrganization?.latitude !== undefined
        ? Number(listing.donorOrganization.latitude)
        : null;
      const donorLon = listing.donorOrganization?.longitude !== null && listing.donorOrganization?.longitude !== undefined
        ? Number(listing.donorOrganization.longitude)
        : null;

      const distanceKm = safeCalculateHaversineDistanceKm(poskoLat, poskoLon, donorLat, donorLon);
      const estimatedTransitMinutes = distanceKm !== null ? estimateTransitMinutes(distanceKm) : null;

      return {
        ...listing,
        distanceKm,
        estimatedTransitMinutes,
      };
    });

    // Sort by nearest distance first; if distance tied or not available, sort by totalScore desc
    return mapped.sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) {
        if (a.distanceKm !== b.distanceKm) {
          return a.distanceKm - b.distanceKm;
        }
      } else if (a.distanceKm !== null && b.distanceKm === null) {
        return -1;
      } else if (a.distanceKm === null && b.distanceKm !== null) {
        return 1;
      }
      const scoreA = Number(a.scoreAssessment?.totalScore || 0);
      const scoreB = Number(b.scoreAssessment?.totalScore || 0);
      return scoreB - scoreA;
    });
  }

  async allocate(id: string, dto: AllocateEmergencyDto, user: AuthenticatedUser) {
    const emergencyRequest = await this.findOne(id);

    if (
      user.role !== UserRole.ADMIN &&
      emergencyRequest.recipient.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Hanya mitra pemohon atau admin yang berwenang mengalokasikan bantuan');
    }

    if (emergencyRequest.status !== EmergencyRequestStatus.OPEN) {
      throw new BadRequestException(
        `Permohonan darurat tidak dapat dialokasikan karena status saat ini adalah ${emergencyRequest.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock emergency request
      const lockedRequests = await tx.$queryRaw<any[]>`
        SELECT id, status, recipient_id, requested_portions
        FROM emergency_food_requests
        WHERE id = ${id}::uuid AND status = 'OPEN' AND is_deleted = false
        FOR UPDATE
      `;

      if (!lockedRequests || lockedRequests.length === 0) {
        throw new BadRequestException('Permohonan darurat tidak valid atau sudah dialokasikan oleh proses lain');
      }

      // 2. Lock surplus listing row
      const lockedSurplus = await tx.$queryRaw<any[]>`
        SELECT id, quantity_kg, current_lifecycle_status, safe_until_timestamp
        FROM surplus_listings
        WHERE id = ${dto.surplusListingId}::uuid AND is_deleted = false
        FOR UPDATE
      `;

      if (!lockedSurplus || lockedSurplus.length === 0) {
        throw new NotFoundException('Laporan surplus donasi tidak ditemukan');
      }

      const surplusRow = lockedSurplus[0];

      // Fetch assessments
      const surplusListing = await tx.surplusListing.findUnique({
        where: { id: dto.surplusListingId },
        include: {
          safetyAssessment: true,
          scoreAssessment: true,
        },
      });

      if (!surplusListing) {
        throw new NotFoundException('Laporan surplus donasi tidak ditemukan');
      }

      // Verify lifecycle status
      if (
        surplusRow.current_lifecycle_status !== ListingLifecycleStatus.REPORTED &&
        surplusRow.current_lifecycle_status !== ListingLifecycleStatus.ASSESSED
      ) {
        throw new BadRequestException(
          `Surplus tidak dapat dialokasikan karena status saat ini adalah ${surplusRow.current_lifecycle_status}`,
        );
      }

      // Verify safeUntilTimestamp
      if (new Date(surplusRow.safe_until_timestamp) <= new Date()) {
        throw new BadRequestException('Surplus telah melewati batas waktu aman (kedaluwarsa)');
      }

      // HARD GATE: Safety assessment MUST be PASS!
      const safetyStatus = surplusListing.safetyAssessment?.safetyStatus;
      if (safetyStatus !== FoodSafetyStatus.PASS) {
        throw new UnprocessableEntityException(
          `Keamanan pangan mutlak dilindungi: Makanan dengan status ${safetyStatus || 'UNKNOWN'} DILARANG dialokasikan untuk konsumsi manusia darurat.`,
        );
      }

      // Verify route
      const route = surplusListing.scoreAssessment?.recommendedRoute;
      if (
        route !== RouteHierarchy.REDISTRIBUTE &&
        route !== RouteHierarchy.PROCESS
      ) {
        throw new BadRequestException('Rute surplus ini bukan untuk konsumsi pangan manusia');
      }

      const surplusQuantityKg = Number(surplusRow.quantity_kg);

      // 3. Atomically reserve recipient capacity
      await this.capacityService.reserveCapacity(emergencyRequest.recipientId, surplusQuantityKg, tx);

      // 4. Create RescueJourney
      const journey = await tx.rescueJourney.create({
        data: {
          listingId: surplusListing.id,
          recipientId: emergencyRequest.recipientId,
          currentStatus: JourneyStatus.MATCHED,
          notes: dto.notes
            ? `Alokasi Permintaan Darurat ${emergencyRequest.id} | ${dto.notes}`
            : `Alokasi Permintaan Darurat ${emergencyRequest.id}`,
        },
      });

      // 5. Update surplus listing status
      await tx.surplusListing.update({
        where: { id: surplusListing.id },
        data: { currentLifecycleStatus: ListingLifecycleStatus.MATCHED },
      });

      // 6. Update emergency request status
      const updatedRequest = await tx.emergencyFoodRequest.update({
        where: { id },
        data: {
          status: EmergencyRequestStatus.ALLOCATED,
          matchedSurplusId: surplusListing.id,
          matchedAt: new Date(),
        },
        include: {
          recipient: { include: { organization: true } },
          matchedSurplus: {
            include: { donorOrganization: true },
          },
        },
      });

      // 7. Timeline Event
      await tx.journeyTimelineEvent.create({
        data: {
          journeyId: journey.id,
          status: JourneyStatus.MATCHED,
          note: `Dialokasikan untuk Permintaan Darurat: ${emergencyRequest.id} (${emergencyRequest.recipient.organization.name})`,
          actorUserId: user.id,
        },
      });

      // 8. Audit Log
      await tx.auditLog.create({
        data: {
          tableName: 'emergency_food_requests',
          recordId: id,
          action: AuditAction.UPDATE,
          actorUserId: user.id,
          previousState: { status: EmergencyRequestStatus.OPEN },
          newState: {
            status: EmergencyRequestStatus.ALLOCATED,
            matchedSurplusId: surplusListing.id,
            journeyId: journey.id,
          },
          reason: 'Alokasi bantuan surplus pangan ke posko darurat',
        },
      });

      return {
        success: true,
        message: 'Surplus berhasil dialokasikan ke permohonan pangan darurat',
        data: {
          emergencyRequest: updatedRequest,
          journey,
        },
      };
    });
  }

  async updateStatus(id: string, dto: UpdateEmergencyStatusDto, user: AuthenticatedUser) {
    const request = await this.findOne(id);

    if (
      user.role !== UserRole.ADMIN &&
      request.recipient.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Hanya mitra pemohon atau admin yang berwenang mengubah status');
    }

    const data: any = { status: dto.status };
    if (dto.status === EmergencyRequestStatus.FULFILLED) {
      data.fulfilledAt = new Date();
    } else if (dto.status === EmergencyRequestStatus.CANCELLED) {
      data.cancelledAt = new Date();
      data.cancelReason = dto.cancelReason || 'Dibatalkan oleh pemohon';
      await this.broadcastService.cancelByRequestId(id);
    }

    const updated = await this.prisma.emergencyFoodRequest.update({
      where: { id },
      data,
    });

    await this.prisma.auditLog.create({
      data: {
        tableName: 'emergency_food_requests',
        recordId: id,
        action: AuditAction.STATUS_CHANGE,
        actorUserId: user.id,
        previousState: { status: request.status },
        newState: { status: dto.status, cancelReason: dto.cancelReason },
        reason: 'Pembaruan status permohonan pangan darurat',
      },
    });

    return updated;
  }

  async delete(id: string, user: AuthenticatedUser) {
    const request = await this.findOne(id);

    if (
      user.role !== UserRole.ADMIN &&
      request.recipient.organizationId !== user.organizationId
    ) {
      throw new ForbiddenException('Hanya mitra pemohon atau admin yang berwenang menghapus permohonan');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.emergencyFoodRequest.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      await tx.emergencyBroadcast.updateMany({
        where: {
          emergencyRequestId: id,
          status: BroadcastStatus.ACTIVE,
        },
        data: {
          status: BroadcastStatus.CANCELLED,
        },
      });

      await tx.auditLog.create({
        data: {
          tableName: 'emergency_food_requests',
          recordId: id,
          action: AuditAction.DELETE,
          actorUserId: user.id,
          previousState: { status: request.status },
          newState: { isDeleted: true, deletedAt: updated.deletedAt },
          reason: 'Penghapusan permohonan pangan darurat via soft delete (Tombstone)',
        },
      });

      return {
        success: true,
        statusCode: 200,
        message: 'Permohonan darurat berhasil dihapus.',
      };
    });
  }
}
