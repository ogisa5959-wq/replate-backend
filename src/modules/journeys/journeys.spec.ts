import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JourneysService } from './journeys.service';
import { CapacityService } from '../recipients/capacity.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import configuration from '@/config/configuration';
import {
  FoodCategory,
  FoodCondition,
  PackagingStatus,
  JourneyStatus,
  ListingLifecycleStatus,
  AuditAction,
} from '@prisma/client';

describe('JourneysService (Lifecycle, Concurrency & Doorstep Rejection)', () => {
  let journeysService: JourneysService;
  let capacityService: CapacityService;
  let prisma: PrismaService;

  const mockSupplier = {
    id: '10000000-0000-0000-0000-000000000002',
    email: 'supplier@replate.id',
    fullName: 'Budi Chef Executive',
    role: 'SUPPLIER',
    organizationId: '00000000-0000-0000-0000-000000000002',
  };

  const mockMitra = {
    id: '10000000-0000-0000-0000-000000000003',
    email: 'mitra@replate.id',
    fullName: 'Ahmad Pengelola Dapur',
    role: 'MITRA',
    organizationId: '00000000-0000-0000-0000-000000000003',
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        PrismaModule,
      ],
      providers: [JourneysService, CapacityService],
    }).compile();

    journeysService = module.get<JourneysService>(JourneysService);
    capacityService = module.get<CapacityService>(CapacityService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should assign destination, reserve capacity, and transition status to MATCHED', async () => {
    const recipient = await prisma.recipientProfile.findFirst({
      where: { organizationId: mockMitra.organizationId },
    });

    const listing = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Nasi Kotak Ayam Goreng',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 12,
        portions: 30,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 90,
        preparedAt: new Date(),
        safeUntilTimestamp: new Date(Date.now() + 4 * 3600 * 1000),
        currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
      },
    });

    const initialCap = await capacityService.getMyCapacity(mockMitra.organizationId);

    const journey = await journeysService.assignDestination(
      listing.id,
      { recipientId: recipient!.id, notes: 'Pengantaran sore hari' },
      mockSupplier,
    );

    expect(journey.id).toBeDefined();
    expect(journey.currentStatus).toBe(JourneyStatus.MATCHED);
    expect(journey.distanceKm).toBeDefined();
    expect(journey.distanceKm).not.toBeNull();
    expect(journey.estimatedTransitMinutes).toBeDefined();
    expect(journey.estimatedTransitMinutes).toBeGreaterThanOrEqual(10);

    // Verify listing is now MATCHED
    const updatedListing = await prisma.surplusListing.findUnique({
      where: { id: listing.id },
    });
    expect(updatedListing!.currentLifecycleStatus).toBe(ListingLifecycleStatus.MATCHED);

    // Verify capacity was reserved
    const afterCap = await capacityService.getMyCapacity(mockMitra.organizationId);
    expect(afterCap.allocatedCapacityKg).toBe(initialCap.allocatedCapacityKg + 12);
    expect(afterCap.availableCapacityKg).toBe(initialCap.availableCapacityKg - 12);
  });

  it('should advance journey status to RESCUE_INITIATED', async () => {
    const journey = await prisma.rescueJourney.findFirst({
      where: {
        currentStatus: JourneyStatus.MATCHED,
        listing: { donorOrganizationId: mockSupplier.organizationId },
      },
    });

    const advanced = await journeysService.advanceStatus(
      journey!.id,
      { note: 'Kurir motor telah mengambil barang', estimatedTransitMinutes: 20 },
      mockSupplier,
    );

    expect(advanced.currentStatus).toBe(JourneyStatus.RESCUE_INITIATED);
    expect(advanced.initiatedAt).toBeDefined();
    expect(advanced.estimatedTransitMinutes).toBe(20);
  });

  it('should confirm physical receipt with actualReceivedKg and adjust capacity', async () => {
    const journey = await prisma.rescueJourney.findFirst({
      where: {
        currentStatus: JourneyStatus.RESCUE_INITIATED,
        recipient: { organizationId: mockMitra.organizationId },
      },
      include: { listing: true },
    });

    const allocatedKg = Number(journey!.listing.quantityKg);
    const initialCap = await capacityService.getMyCapacity(mockMitra.organizationId);

    const confirmed = await journeysService.confirmReceipt(
      journey!.id,
      {
        actualReceivedKg: 11.5,
        notes: 'Diterima dalam kondisi hangat dan bersih, ditimbang 11.5 kg',
      },
      mockMitra,
    );

    expect(confirmed.currentStatus).toBe(JourneyStatus.RECEIVED);
    expect(Number(confirmed.actualReceivedKg)).toBe(11.5);
    expect(confirmed.receivedAt).toBeDefined();

    // Verify listing is RECEIVED
    const updatedListing = await prisma.surplusListing.findUnique({
      where: { id: journey!.listingId },
    });
    expect(updatedListing!.currentLifecycleStatus).toBe(ListingLifecycleStatus.RECEIVED);

    // Verify capacity shifted from allocated to received
    const afterCap = await capacityService.getMyCapacity(mockMitra.organizationId);
    expect(afterCap.allocatedCapacityKg).toBe(Math.max(0, initialCap.allocatedCapacityKg - allocatedKg));
    expect(afterCap.receivedCapacityKg).toBe(initialCap.receivedCapacityKg + 11.5);
  });

  it('Doorstep Physical Rejection: Mitra rejects delivery at the door -> CANCELLED, capacity restored, NO reroute', async () => {
    const recipient = await prisma.recipientProfile.findFirst({
      where: { organizationId: mockMitra.organizationId },
    });

    // 1. Create a fresh listing and assign it
    const listing = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Ikan Bakar Bumbu Rujak',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 8,
        portions: 20,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 85,
        preparedAt: new Date(),
        safeUntilTimestamp: new Date(Date.now() + 4 * 3600 * 1000),
        currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
      },
    });

    const journey = await journeysService.assignDestination(
      listing.id,
      { recipientId: recipient!.id },
      mockSupplier,
    );

    // Advance to RESCUE_INITIATED
    await journeysService.advanceStatus(journey.id, {}, mockSupplier);

    // Capture capacity right before rejection
    const beforeRejectionCap = await capacityService.getMyCapacity(mockMitra.organizationId);

    // 2. Mitra rejects physically at the doorstep
    const rejectionReason = 'Penolakan fisik di pintu dapur: ikan mengeluarkan bau asam menyengat dan kemasan berlubang';
    const rejectedJourney = await journeysService.cancel(
      journey.id,
      { cancellationReason: rejectionReason },
      mockMitra,
    );

    expect(rejectedJourney.currentStatus).toBe(JourneyStatus.CANCELLED);
    expect(rejectedJourney.cancellationReason).toBe(rejectionReason);
    expect(rejectedJourney.cancelledAt).toBeDefined();

    // Verify listing is CANCELLED (never RECEIVED)
    const updatedListing = await prisma.surplusListing.findUnique({
      where: { id: listing.id },
    });
    expect(updatedListing!.currentLifecycleStatus).toBe(ListingLifecycleStatus.CANCELLED);

    // 3. Verify capacity is fully released and restored
    const afterRejectionCap = await capacityService.getMyCapacity(mockMitra.organizationId);
    expect(afterRejectionCap.allocatedCapacityKg).toBe(beforeRejectionCap.allocatedCapacityKg - 8);
    expect(afterRejectionCap.availableCapacityKg).toBe(beforeRejectionCap.availableCapacityKg + 8);

    // 4. Verify Audit Trail and Timeline
    const timelineEvents = await prisma.journeyTimelineEvent.findMany({
      where: { journeyId: journey.id },
      orderBy: { timestamp: 'desc' },
    });
    expect(timelineEvents[0].status).toBe(JourneyStatus.CANCELLED);
    expect(timelineEvents[0].note).toContain('PENOLAKAN FISIK DI LOKASI MITRA');

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        recordId: journey.id,
        action: AuditAction.PHYSICAL_REJECTION,
      },
    });
    expect(auditLog).toBeDefined();
    expect(auditLog!.reason).toBe(rejectionReason);
  });

  describe('In-Transit Logistics Incidents (Fase 12 - TASK-012)', () => {
    it('should cancel journey with in-transit incident metadata and label timeline [KENDALA PENGIRIMAN]', async () => {
      const recipient = await prisma.recipientProfile.findFirst({
        where: { organizationId: mockMitra.organizationId },
      });

      const listing = await prisma.surplusListing.create({
        data: {
          donorOrganizationId: mockSupplier.organizationId,
          reporterUserId: mockSupplier.id,
          foodName: 'Sop Daging Kambing',
          foodCategory: FoodCategory.COOKED_MEALS,
          quantityKg: 6,
          portions: 15,
          condition: FoodCondition.FRESH,
          packagingStatus: PackagingStatus.INTACT_SEALED,
          hygieneScore: 90,
          preparedAt: new Date(),
          safeUntilTimestamp: new Date(Date.now() + 3 * 3600 * 1000),
          currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
        },
      });

      const journey = await journeysService.assignDestination(
        listing.id,
        { recipientId: recipient!.id },
        mockSupplier,
      );

      await journeysService.advanceStatus(journey.id, {}, mockSupplier);

      const cancelResult = await journeysService.cancel(
        journey.id,
        {
          cancellationReason: 'Boks pendingin pecah saat motor kurir terjatuh',
          isIncidentReport: true,
          issueReportedBy: 'Budi (Kurir Logistik)',
          note: 'Makanan tumpah di jalan tol lingkar barat',
        },
        mockSupplier,
      );

      expect(cancelResult.currentStatus).toBe(JourneyStatus.CANCELLED);

      // Verify timeline event note contains [KENDALA PENGIRIMAN] and reporter
      const events = await prisma.journeyTimelineEvent.findMany({
        where: { journeyId: journey.id },
        orderBy: { timestamp: 'desc' },
      });
      expect(events[0].note).toContain('[KENDALA PENGIRIMAN]');
      expect(events[0].note).toContain('Budi (Kurir Logistik)');

      // Verify audit log reason contains [KENDALA PENGIRIMAN]
      const audit = await prisma.auditLog.findFirst({
        where: { recordId: journey.id, action: AuditAction.CANCEL },
      });
      expect(audit).toBeDefined();
      expect(audit!.reason).toContain('[KENDALA PENGIRIMAN]');
    });
  });
});
