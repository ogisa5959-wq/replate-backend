import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SurplusService } from './surplus.service';
import { SurplusExpiryWorker } from './surplus-expiry.worker';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import configuration from '@/config/configuration';
import {
  FoodCategory,
  FoodCondition,
  PackagingStatus,
  UserRole,
  FoodSafetyStatus,
  ListingLifecycleStatus,
  JourneyStatus,
} from '@prisma/client';

describe('SurplusService & ExpiryWorker (Integration)', () => {
  let surplusService: SurplusService;
  let expiryWorker: SurplusExpiryWorker;
  let prisma: PrismaService;

  const mockSupplier = {
    id: '10000000-0000-0000-0000-000000000002',
    email: 'supplier@replate.id',
    fullName: 'Budi Chef Executive',
    role: 'SUPPLIER',
    organizationId: '00000000-0000-0000-0000-000000000002',
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        PrismaModule,
      ],
      providers: [SurplusService, SurplusExpiryWorker],
    }).compile();

    surplusService = module.get<SurplusService>(SurplusService);
    expiryWorker = module.get<SurplusExpiryWorker>(SurplusExpiryWorker);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create a valid surplus listing and pass Food Safety Gate', async () => {
    const listing = await surplusService.create(
      {
        foodName: 'Nasi Kotak Ayam Panggang',
        foodCategory: FoodCategory.COOKED_MEALS,
        foodTypeCode: 'COOKED_BUFFET',
        quantityKg: 10,
        portions: 25,
        condition: FoodCondition.FRESH,
        storageTemperatureC: 65,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 90,
        preparedAt: new Date().toISOString(),
        timeWindowId: '1_3h',
        safetyConditionId: 'no_visible_damage',
        storageHistoryId: 'known_compliant',
        storageTempId: 'hot_holding_above_60',
        packagingConditionId: 'intact_proper',
        handlingIntegrityId: 'hygienic_separated',
      },
      mockSupplier,
    );

    expect(listing.id).toBeDefined();
    expect(listing.safetyAssessment.status).toBe(FoodSafetyStatus.PASS);
    expect(listing.safetyAssessment.eligibleForConsumption).toBe(true);
    expect(Number(listing.scoreAssessment.totalScore)).toBeGreaterThanOrEqual(70);
  });

  it('should evaluate spoiled listing as REJECT and block human consumption', async () => {
    const listing = await surplusService.create(
      {
        foodName: 'Sayur Basi',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 5,
        portions: 10,
        condition: FoodCondition.SPOILED,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 50,
        preparedAt: new Date().toISOString(),
        safetyConditionId: 'clear_spoilage',
        storageHistoryId: 'suspected_non_compliant',
      },
      mockSupplier,
    );

    expect(listing.id).toBeDefined();
    expect(listing.safetyAssessment.status).toBe(FoodSafetyStatus.REJECT);
    expect(listing.safetyAssessment.eligibleForConsumption).toBe(false);
    expect(listing.scoreAssessment.recommendedRoute).toBe('ORGANIC');
  });

  it('should retrieve dispatches for the logged-in supplier', async () => {
    const dispatches = await surplusService.getMyDispatches(mockSupplier);
    expect(dispatches.length).toBeGreaterThanOrEqual(1);
    expect(dispatches[0].donorOrganizationId).toBe(mockSupplier.organizationId);
  });

  it('should retrieve assessment and matching candidates', async () => {
    const created = await surplusService.create(
      {
        foodName: 'Roti Manis',
        foodCategory: FoodCategory.BAKERY_PASTRY,
        quantityKg: 8,
        portions: 20,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 95,
        preparedAt: new Date().toISOString(),
        safetyConditionId: 'no_visible_damage',
      },
      mockSupplier,
    );

    const assessment = await surplusService.getAssessment(created.id);
    expect(assessment.listingId).toBe(created.id);
    expect(assessment.matches).toBeDefined();
    expect(Array.isArray(assessment.matches)).toBe(true);
  });

  it('should allow supplier to update safety parameters if status was REVIEW', async () => {
    const created = await surplusService.create(
      {
        foodName: 'Buah Segar Belum Diperiksa',
        foodCategory: FoodCategory.FRESH_PRODUCE,
        quantityKg: 6,
        portions: 12,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 80,
        preparedAt: new Date().toISOString(),
        safetyConditionId: 'not_checked',
      },
      mockSupplier,
    );

    expect(created.safetyAssessment.status).toBe(FoodSafetyStatus.REVIEW);

    const updated = await surplusService.updateSafetyParameters(
      created.id,
      {
        safetyConditionId: 'no_visible_damage',
        storageHistoryId: 'known_compliant',
        reVerificationNotes: 'Telah diperiksa langsung oleh Chef Budi',
      },
      mockSupplier,
    );

    expect(updated.safetyStatus).toBe(FoodSafetyStatus.PASS);
  });

  it('Expiry Worker: should cancel expired MATCHED listing and restore recipient capacity', async () => {
    // 1. Create a listing that has expired safeUntilTimestamp (in past)
    const pastDate = new Date(Date.now() - 5 * 3600 * 1000); // 5 hours ago
    const expiredTimestamp = new Date(Date.now() - 1 * 3600 * 1000); // 1 hour ago

    const listing = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Nasi Kotak Expired Pre-Pickup',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 15,
        portions: 30,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 85,
        preparedAt: pastDate,
        safeUntilTimestamp: expiredTimestamp,
        currentLifecycleStatus: ListingLifecycleStatus.MATCHED,
      },
    });

    const recipientProfile = await prisma.recipientProfile.findFirst();

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Initial allocate 15kg to recipient
    await prisma.recipientCapacity.update({
      where: {
        recipientId_capacityDate: {
          recipientId: recipientProfile!.id,
          capacityDate: today,
        },
      },
      data: {
        allocatedCapacityKg: { increment: 15 },
        availableCapacityKg: { decrement: 15 },
      },
    });

    const journey = await prisma.rescueJourney.create({
      data: {
        listingId: listing.id,
        recipientId: recipientProfile!.id,
        currentStatus: JourneyStatus.MATCHED,
      },
    });

    // Run Expiry Worker
    const workerResult = await expiryWorker.handleSurplusExpiry();
    expect(workerResult.cancelledMatchedCount).toBeGreaterThanOrEqual(1);

    // Verify journey status is CANCELLED
    const updatedJourney = await prisma.rescueJourney.findUnique({
      where: { id: journey.id },
    });
    expect(updatedJourney!.currentStatus).toBe(JourneyStatus.CANCELLED);
    expect(updatedJourney!.cancellationReason).toContain('Expiry Worker');

    // Verify listing is CANCELLED
    const updatedListing = await prisma.surplusListing.findUnique({
      where: { id: listing.id },
    });
    expect(updatedListing!.currentLifecycleStatus).toBe(ListingLifecycleStatus.CANCELLED);
  });
});
