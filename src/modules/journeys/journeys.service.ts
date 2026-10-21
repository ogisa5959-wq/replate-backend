import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CapacityService } from '../recipients/capacity.service';
import { AssignDestinationDto } from './dto/assign-destination.dto';
import { AdvanceStatusDto } from './dto/advance-status.dto';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { CancelJourneyDto } from './dto/cancel-journey.dto';
import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import {
  safeCalculateHaversineDistanceKm,
  estimateTransitMinutes,
} from '@/common/utils/haversine.util';
import {
  JourneyStatus,
  ListingLifecycleStatus,
  UserRole,
  AuditAction,
  FoodSafetyStatus,
  RecipientType,
} from '@prisma/client';

@Injectable()
export class JourneysService {
  private readonly logger = new Logger(JourneysService.name);

  constructor(
    private prisma: PrismaService,
    private capacityService: CapacityService,
  ) {}

  async assignDestination(
    listingId: string,
    dto: AssignDestinationDto,
    user: AuthenticatedUser,
  ) {
    const listing = await this.prisma.surplusListing.findUnique({
      where: { id: listingId },
      include: {
        donorOrganization: true,
        safetyAssessment: true,
      },
    });

    if (!listing) {
      throw new NotFoundException(`Surplus listing ${listingId} tidak ditemukan`);
    }

    // Role & Ownership check
    if (user.role !== UserRole.ADMIN && listing.donorOrganizationId !== user.organizationId) {
      throw new ForbiddenException('Hanya donor pemilik atau admin yang dapat menetapkan mitra tujuan');
    }

    if (
      listing.currentLifecycleStatus !== ListingLifecycleStatus.REPORTED &&
      listing.currentLifecycleStatus !== ListingLifecycleStatus.ASSESSED
    ) {
      throw new BadRequestException(
        `Surplus listing tidak dapat dialokasikan karena status saat ini adalah ${listing.currentLifecycleStatus}`,
      );
    }

    // Recipient check
    const recipient = await this.prisma.recipientProfile.findUnique({
      where: { id: dto.recipientId },
      include: { organization: true },
    });

    if (!recipient) {
      throw new NotFoundException(`Mitra penerima ${dto.recipientId} tidak ditemukan`);
    }

    // Food Safety Gate Invariant
    const safetyStatus = listing.safetyAssessment?.safetyStatus;
    const isHumanRecipient = recipient.recipientType !== RecipientType.COMPOST_FACILITY;

    if (safetyStatus === FoodSafetyStatus.REJECT && isHumanRecipient) {
      throw new BadRequestException(
        'PELANGGARAN KEAMANAN PANGAN: Makanan berstatus REJECT dilarang mutlak dialokasikan ke mitra konsumsi manusia',
      );
    }

    if (safetyStatus === FoodSafetyStatus.REVIEW && isHumanRecipient) {
      throw new BadRequestException(
        'PELANGGARAN KEAMANAN PANGAN: Makanan berstatus REVIEW ditahan sementara dan tidak dapat dialokasikan sebelum verifikasi lengkap',
      );
    }

    const qtyKg = Number(listing.quantityKg);

    // Calculate geodetic distance and estimated transit time
    const donorLat = listing.donorOrganization?.latitude !== null && listing.donorOrganization?.latitude !== undefined
      ? Number(listing.donorOrganization.latitude)
      : null;
    const donorLon = listing.donorOrganization?.longitude !== null && listing.donorOrganization?.longitude !== undefined
      ? Number(listing.donorOrganization.longitude)
      : null;
    const recipientLat = recipient.latitude !== null && recipient.latitude !== undefined
      ? Number(recipient.latitude)
      : (recipient.organization?.latitude ? Number(recipient.organization.latitude) : null);
    const recipientLon = recipient.longitude !== null && recipient.longitude !== undefined
      ? Number(recipient.longitude)
      : (recipient.organization?.longitude ? Number(recipient.organization.longitude) : null);

    const distanceKm = safeCalculateHaversineDistanceKm(donorLat, donorLon, recipientLat, recipientLon);
    const estimatedTransitMinutes = distanceKm !== null ? estimateTransitMinutes(distanceKm) : null;

    // Atomic transaction with pessimistic row locking on recipient capacity
    return this.prisma.$transaction(async (tx) => {
      // 1. Reserve recipient capacity with SELECT ... FOR UPDATE
      await this.capacityService.reserveCapacity(dto.recipientId, qtyKg, tx);

      // 2. Update listing status
      await tx.surplusListing.update({
        where: { id: listingId },
        data: { currentLifecycleStatus: ListingLifecycleStatus.MATCHED },
      });

      // 3. Create rescue journey
      const journey = await tx.rescueJourney.create({
        data: {
          listingId,
          recipientId: dto.recipientId,
          currentStatus: JourneyStatus.MATCHED,
          estimatedTransitMinutes,
          notes: dto.notes,
        },
      });

      const distanceNote = distanceKm !== null
        ? ` Jarak pengiriman: ${distanceKm} km (estimasi tiba ~${estimatedTransitMinutes} mnt).`
        : '';

      // 4. Record initial timeline event
      await tx.journeyTimelineEvent.create({
        data: {
          journeyId: journey.id,
          status: JourneyStatus.MATCHED,
          note: `Mitra penampung dikonfirmasi: ${recipient.organization.name}.${distanceNote} Kuota ${qtyKg} kg dicadangkan.`,
          actorUserId: user.id,
        },
      });

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          tableName: 'rescue_journeys',
          recordId: journey.id,
          action: AuditAction.CREATE,
          actorUserId: user.id,
          newState: {
            journeyId: journey.id,
            listingId,
            recipientId: dto.recipientId,
            status: JourneyStatus.MATCHED,
            distanceKm,
            estimatedTransitMinutes,
          },
          reason: 'Penetapan mitra penampung dan penguncian kuota kapasitas',
        },
      });

      return {
        ...journey,
        distanceKm,
        estimatedTransitMinutes,
        recipient: {
          id: recipient.id,
          organizationName: recipient.organization.name,
          recipientType: recipient.recipientType,
          latitude: recipientLat,
          longitude: recipientLon,
        },
      };
    });
  }

  private attachDistanceToJourney<T extends { listing?: any; recipient?: any }>(journey: T): T & { distanceKm: number | null } {
    const donor = journey.listing?.donorOrganization;
    const recipient = journey.recipient;
    const donorLat = donor?.latitude !== null && donor?.latitude !== undefined ? Number(donor.latitude) : null;
    const donorLon = donor?.longitude !== null && donor?.longitude !== undefined ? Number(donor.longitude) : null;
    const recLat = recipient?.latitude !== null && recipient?.latitude !== undefined
      ? Number(recipient.latitude)
      : (recipient?.organization?.latitude ? Number(recipient.organization.latitude) : null);
    const recLon = recipient?.longitude !== null && recipient?.longitude !== undefined
      ? Number(recipient.longitude)
      : (recipient?.organization?.longitude ? Number(recipient.organization.longitude) : null);

    const distanceKm = safeCalculateHaversineDistanceKm(donorLat, donorLon, recLat, recLon);
    return {
      ...journey,
      distanceKm,
    };
  }

  async findAll(params: {
    status?: JourneyStatus;
    recipientId?: string;
    donorId?: string;
  }, user: AuthenticatedUser) {
    const where: any = {};

    if (params.status) {
      where.currentStatus = params.status;
    }

    if (user.role === UserRole.MITRA) {
      // Mitra only sees journeys assigned to their organization
      const profile = await this.prisma.recipientProfile.findUnique({
        where: { organizationId: user.organizationId },
      });
      where.recipientId = profile?.id || '00000000-0000-0000-0000-000000000000';
    } else if (user.role === UserRole.SUPPLIER) {
      // Supplier only sees journeys for their reported listings
      where.listing = {
        donorOrganizationId: user.organizationId,
      };
    } else {
      // Admin can filter by recipientId or donorId
      if (params.recipientId) where.recipientId = params.recipientId;
      if (params.donorId) where.listing = { donorOrganizationId: params.donorId };
    }

    const journeys = await this.prisma.rescueJourney.findMany({
      where,
      include: {
        listing: {
          include: {
            donorOrganization: true,
            safetyAssessment: true,
            scoreAssessment: true,
          },
        },
        recipient: {
          include: { organization: true },
        },
        timelineEvents: {
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return journeys.map((j) => this.attachDistanceToJourney(j));
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const journey = await this.prisma.rescueJourney.findUnique({
      where: { id },
      include: {
        listing: {
          include: {
            donorOrganization: true,
            safetyAssessment: true,
            scoreAssessment: true,
          },
        },
        recipient: {
          include: { organization: true },
        },
        timelineEvents: {
          include: { actorUser: { select: { fullName: true, role: true } } },
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!journey) {
      throw new NotFoundException(`Journey ${id} tidak ditemukan`);
    }

    // Role-based visibility check
    if (user.role === UserRole.SUPPLIER && journey.listing.donorOrganizationId !== user.organizationId) {
      throw new ForbiddenException('Akses ditolak: perjalanan ini bukan milik organisasi Anda');
    }
    if (user.role === UserRole.MITRA && journey.recipient.organizationId !== user.organizationId) {
      throw new ForbiddenException('Akses ditolak: perjalanan ini tidak ditujukan ke mitra Anda');
    }

    return this.attachDistanceToJourney(journey);
  }

  async advanceStatus(id: string, dto: AdvanceStatusDto, user: AuthenticatedUser) {
    const journey = await this.findOne(id, user);

    if (user.role !== UserRole.SUPPLIER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya donor pengirim atau admin yang berwenang menyerahkan ke kurir');
    }

    if (journey.currentStatus !== JourneyStatus.MATCHED) {
      throw new BadRequestException(
        `Perjalanan tidak dapat dimajukan ke RESCUE_INITIATED karena status saat ini adalah ${journey.currentStatus}`,
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.rescueJourney.update({
        where: { id },
        data: {
          currentStatus: JourneyStatus.RESCUE_INITIATED,
          initiatedAt: now,
          estimatedTransitMinutes: dto.estimatedTransitMinutes || 30,
        },
      });

      await tx.journeyTimelineEvent.create({
        data: {
          journeyId: id,
          status: JourneyStatus.RESCUE_INITIATED,
          note: dto.note || 'Makanan telah diserahkan kepada armada penjemputan/kurir',
          actorUserId: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          tableName: 'rescue_journeys',
          recordId: id,
          action: AuditAction.STATUS_CHANGE,
          actorUserId: user.id,
          previousState: { status: JourneyStatus.MATCHED },
          newState: { status: JourneyStatus.RESCUE_INITIATED },
          reason: 'Penyerahan surplus makanan ke armada logistik penjemputan',
        },
      });

      return updated;
    });
  }

  async confirmReceipt(id: string, dto: ConfirmReceiptDto, user: AuthenticatedUser) {
    const journey = await this.findOne(id, user);

    // Authorization: Only recipient mitra or admin
    if (user.role !== UserRole.MITRA && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya mitra penerima atau admin yang berwenang mengonfirmasi serah terima fisik');
    }

    if (user.role === UserRole.MITRA && journey.recipient.organizationId !== user.organizationId) {
      throw new ForbiddenException('Hanya mitra penerima yang dituju yang berwenang mengonfirmasi penerimaan');
    }

    if (journey.currentStatus !== JourneyStatus.RESCUE_INITIATED) {
      throw new BadRequestException(
        `Penerimaan fisik tidak dapat dikonfirmasi karena perjalanan masih berstatus ${journey.currentStatus}`,
      );
    }

    const now = new Date();
    const allocatedKg = Number(journey.listing.quantityKg);
    const actualKg = Number(dto.actualReceivedKg);

    return this.prisma.$transaction(async (tx) => {
      // 1. Update journey status to RECEIVED
      const updatedJourney = await tx.rescueJourney.update({
        where: { id },
        data: {
          currentStatus: JourneyStatus.RECEIVED,
          receivedAt: now,
          actualReceivedKg: actualKg,
          notes: dto.notes ? `${journey.notes || ''} | Catatan Penerimaan: ${dto.notes}` : journey.notes,
        },
      });

      // 2. Update listing status to RECEIVED
      await tx.surplusListing.update({
        where: { id: journey.listingId },
        data: { currentLifecycleStatus: ListingLifecycleStatus.RECEIVED },
      });

      // 3. Confirm capacity on recipient daily capacity
      await this.capacityService.confirmReceivedCapacity(
        journey.recipientId,
        allocatedKg,
        actualKg,
        tx,
      );

      // 4. Record timeline event
      await tx.journeyTimelineEvent.create({
        data: {
          journeyId: id,
          status: JourneyStatus.RECEIVED,
          note: `Serah terima fisik berhasil terkonfirmasi. Berat aktual diterima: ${actualKg} kg. ${dto.notes || ''}`.trim(),
          actorUserId: user.id,
        },
      });

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          tableName: 'rescue_journeys',
          recordId: id,
          action: AuditAction.STATUS_CHANGE,
          actorUserId: user.id,
          previousState: { status: JourneyStatus.RESCUE_INITIATED },
          newState: { status: JourneyStatus.RECEIVED, actualReceivedKg: actualKg },
          reason: 'Konfirmasi serah terima fisik makanan di lokasi mitra penerima',
        },
      });

      return updatedJourney;
    });
  }

  async cancel(id: string, dto: CancelJourneyDto, user: AuthenticatedUser) {
    const journey = await this.findOne(id, user);

    if (
      journey.currentStatus === JourneyStatus.RECEIVED ||
      journey.currentStatus === JourneyStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Perjalanan tidak dapat dibatalkan karena sudah berstatus terminal ${journey.currentStatus}`,
      );
    }

    // Role check:
    // - MITRA can cancel (Doorstep Physical Rejection when delivery arrives at doorstep)
    // - SUPPLIER can cancel (if donor needs to revoke before handoff)
    // - ADMIN can cancel
    const isMitra = user.role === UserRole.MITRA && journey.recipient.organizationId === user.organizationId;
    const isSupplier = user.role === UserRole.SUPPLIER && journey.listing.donorOrganizationId === user.organizationId;
    const isAdmin = user.role === UserRole.ADMIN;

    if (!isMitra && !isSupplier && !isAdmin) {
      throw new ForbiddenException('Anda tidak memiliki wewenang untuk membatalkan pengiriman ini');
    }

    const isPhysicalRejection = isMitra;
    const now = new Date();
    const qtyKg = Number(journey.listing.quantityKg);

    return this.prisma.$transaction(async (tx) => {
      // 1. Update journey to CANCELLED
      const updatedJourney = await tx.rescueJourney.update({
        where: { id },
        data: {
          currentStatus: JourneyStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: dto.cancellationReason,
        },
      });

      // 2. Update listing to CANCELLED
      await tx.surplusListing.update({
        where: { id: journey.listingId },
        data: { currentLifecycleStatus: ListingLifecycleStatus.CANCELLED },
      });

      // 3. Atomically release capacity back to recipient (no hanging capacity!)
      await this.capacityService.releaseCapacity(journey.recipientId, qtyKg, tx);

      // 4. Record timeline event
      let timelineNote: string;
      if (dto.isIncidentReport) {
        timelineNote = `[KENDALA PENGIRIMAN] ${dto.cancellationReason}${dto.issueReportedBy ? ` (Dilaporkan oleh: ${dto.issueReportedBy})` : ''}${dto.note ? ` | Catatan: ${dto.note}` : ''}. Kapasitas kuota penerima telah dipulihkan.`;
      } else if (isPhysicalRejection) {
        timelineNote = `PENOLAKAN FISIK DI LOKASI MITRA: ${dto.cancellationReason}. Kapasitas kuota penerima telah dipulihkan.`;
      } else {
        timelineNote = `Pembatalan operasional pengiriman: ${dto.cancellationReason}. Kapasitas kuota penerima telah dipulihkan.`;
      }

      await tx.journeyTimelineEvent.create({
        data: {
          journeyId: id,
          status: JourneyStatus.CANCELLED,
          note: timelineNote,
          actorUserId: user.id,
        },
      });

      // 5. Audit log
      await tx.auditLog.create({
        data: {
          tableName: 'rescue_journeys',
          recordId: id,
          action: isPhysicalRejection ? AuditAction.PHYSICAL_REJECTION : AuditAction.CANCEL,
          actorUserId: user.id,
          previousState: { status: journey.currentStatus },
          newState: {
            status: JourneyStatus.CANCELLED,
            cancellationReason: dto.cancellationReason,
            isIncidentReport: dto.isIncidentReport || false,
            issueReportedBy: dto.issueReportedBy || null,
          },
          reason: dto.isIncidentReport
            ? `[KENDALA PENGIRIMAN] ${dto.cancellationReason}`
            : dto.cancellationReason,
        },
      });

      // IMPORTANT: TIDAK ADA reroute otomatis ke ORGANIC/kompos!
      return {
        ...updatedJourney,
        message: isPhysicalRejection
          ? 'Penolakan fisik di lokasi mitra berhasil dicatat. Kapasitas mitra telah dipulihkan.'
          : 'Perjalanan donasi berhasil dibatalkan. Kapasitas mitra telah dipulihkan.',
      };
    });
  }
}
