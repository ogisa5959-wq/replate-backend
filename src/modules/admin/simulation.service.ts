import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import {
  ListingLifecycleStatus,
  JourneyStatus,
  FoodCategory,
  FoodCondition,
  PackagingStatus,
  FoodSafetyStatus,
  RouteHierarchy,
  AuditAction,
} from '@prisma/client';

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(private prisma: PrismaService) {}

  async loadDemoData(adminUserId: string) {
    this.logger.log('Loading demo simulation dataset...');

    const supplierOrg = await this.prisma.organization.findFirst({
      where: { type: 'SUPPLIER' },
    });
    const recipientProfile = await this.prisma.recipientProfile.findFirst({
      include: { organization: true },
    });

    if (!supplierOrg || !recipientProfile) {
      throw new Error('Master data supplier atau recipient belum tersedia. Jalankan seed terlebih dahulu.');
    }

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600 * 1000);
    const oneHourAgo = new Date(now.getTime() - 1 * 3600 * 1000);

    return this.prisma.$transaction(async (tx) => {
      // 1. Demo completed journey (RECEIVED)
      const listing1 = await tx.surplusListing.create({
        data: {
          donorOrganizationId: supplierOrg.id,
          reporterUserId: adminUserId,
          foodName: '[DEMO] Nasi Uduk & Lauk Lengkap (50 Porsi)',
          foodCategory: FoodCategory.COOKED_MEALS,
          quantityKg: 17.5,
          portions: 50,
          condition: FoodCondition.FRESH,
          storageTemperatureC: 68.0,
          packagingStatus: PackagingStatus.INTACT_SEALED,
          hygieneScore: 95,
          preparedAt: twoHoursAgo,
          safeUntilTimestamp: new Date(now.getTime() + 2 * 3600 * 1000),
          currentLifecycleStatus: ListingLifecycleStatus.RECEIVED,
          notes: 'Demo simulasi prasmanan sarapan hotel terselamatkan',
        },
      });

      await tx.foodSafetyAssessment.create({
        data: {
          listingId: listing1.id,
          safetyStatus: FoodSafetyStatus.PASS,
          gateReasons: [],
          storageHistoryKnown: true,
          hygieneAdequate: true,
        },
      });

      await tx.rescueScoreAssessment.create({
        data: {
          listingId: listing1.id,
          totalScore: 94,
          conditionSubscore: 100,
          urgencySubscore: 90,
          quantitySubscore: 95,
          easeSubscore: 85,
          destinationFitSubscore: 95,
          recommendedRoute: RouteHierarchy.REDISTRIBUTE,
          scoreBreakdown: {},
        },
      });

      const journey1 = await tx.rescueJourney.create({
        data: {
          listingId: listing1.id,
          recipientId: recipientProfile.id,
          currentStatus: JourneyStatus.RECEIVED,
          assignedAt: twoHoursAgo,
          initiatedAt: oneHourAgo,
          receivedAt: now,
          actualReceivedKg: 17.5,
          notes: 'Diterima dalam kondisi prima',
        },
      });

      await tx.journeyTimelineEvent.createMany({
        data: [
          { journeyId: journey1.id, status: JourneyStatus.MATCHED, note: 'Mitra dikonfirmasi', timestamp: twoHoursAgo },
          { journeyId: journey1.id, status: JourneyStatus.RESCUE_INITIATED, note: 'Kurir motor mengangkut donasi', timestamp: oneHourAgo },
          { journeyId: journey1.id, status: JourneyStatus.RECEIVED, note: 'Diterima fisik lengkap 17.5 kg', timestamp: now },
        ],
      });

      // 2. Demo active journey (IN_TRANSIT)
      const listing2 = await tx.surplusListing.create({
        data: {
          donorOrganizationId: supplierOrg.id,
          reporterUserId: adminUserId,
          foodName: '[DEMO] Roti Aneka Rasa & Danish Pastry (30 Pcs)',
          foodCategory: FoodCategory.BAKERY_PASTRY,
          quantityKg: 6.0,
          portions: 30,
          condition: FoodCondition.FRESH,
          storageTemperatureC: 22.0,
          packagingStatus: PackagingStatus.INTACT_SEALED,
          hygieneScore: 90,
          preparedAt: oneHourAgo,
          safeUntilTimestamp: new Date(now.getTime() + 20 * 3600 * 1000),
          currentLifecycleStatus: ListingLifecycleStatus.MATCHED,
          notes: 'Demo sisa display toko roti sore hari',
        },
      });

      await tx.foodSafetyAssessment.create({
        data: {
          listingId: listing2.id,
          safetyStatus: FoodSafetyStatus.PASS,
          gateReasons: [],
          storageHistoryKnown: true,
          hygieneAdequate: true,
        },
      });

      await tx.rescueScoreAssessment.create({
        data: {
          listingId: listing2.id,
          totalScore: 88,
          conditionSubscore: 95,
          urgencySubscore: 75,
          quantitySubscore: 90,
          easeSubscore: 95,
          destinationFitSubscore: 90,
          recommendedRoute: RouteHierarchy.REDISTRIBUTE,
          scoreBreakdown: {},
        },
      });

      const journey2 = await tx.rescueJourney.create({
        data: {
          listingId: listing2.id,
          recipientId: recipientProfile.id,
          currentStatus: JourneyStatus.RESCUE_INITIATED,
          assignedAt: oneHourAgo,
          initiatedAt: now,
          estimatedTransitMinutes: 15,
        },
      });

      await tx.journeyTimelineEvent.createMany({
        data: [
          { journeyId: journey2.id, status: JourneyStatus.MATCHED, note: 'Mitra dikonfirmasi', timestamp: oneHourAgo },
          { journeyId: journey2.id, status: JourneyStatus.RESCUE_INITIATED, note: 'Dalam perjalanan pengiriman', timestamp: now },
        ],
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          tableName: 'surplus_listings',
          recordId: listing1.id,
          action: AuditAction.CREATE,
          actorUserId: adminUserId,
          reason: 'Pemuatan paket simulasi data demo perkotaan',
        },
      });

      return {
        message: 'Data simulasi demo berhasil dimuat',
        createdListingsCount: 2,
        createdJourneysCount: 2,
      };
    });
  }

  async clearDemoData(adminUserId: string) {
    this.logger.log('Clearing demo simulation dataset...');

    const demoListings = await this.prisma.surplusListing.findMany({
      where: {
        foodName: { startsWith: '[DEMO]' },
      },
      select: { id: true },
    });

    const listingIds = demoListings.map((l) => l.id);

    return this.prisma.$transaction(async (tx) => {
      // Delete timeline events
      await tx.journeyTimelineEvent.deleteMany({
        where: {
          journey: {
            listingId: { in: listingIds },
          },
        },
      });

      // Delete journeys
      await tx.rescueJourney.deleteMany({
        where: {
          listingId: { in: listingIds },
        },
      });

      // Delete safety assessments
      await tx.foodSafetyAssessment.deleteMany({
        where: {
          listingId: { in: listingIds },
        },
      });

      // Delete rescue score assessments
      await tx.rescueScoreAssessment.deleteMany({
        where: {
          listingId: { in: listingIds },
        },
      });

      // Delete listings
      const deleted = await tx.surplusListing.deleteMany({
        where: {
          id: { in: listingIds },
        },
      });

      await tx.auditLog.create({
        data: {
          tableName: 'surplus_listings',
          recordId: '00000000-0000-0000-0000-000000000000',
          action: AuditAction.DELETE,
          actorUserId: adminUserId,
          reason: 'Pembersihan seluruh data simulasi demo',
        },
      });

      return {
        message: 'Seluruh data simulasi demo berhasil dibersihkan',
        deletedCount: deleted.count,
      };
    });
  }
}
