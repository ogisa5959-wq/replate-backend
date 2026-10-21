import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EmergencyService } from './emergency.service';
import { BroadcastService } from './broadcast.service';
import { CapacityService } from '../recipients/capacity.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import configuration from '@/config/configuration';
import {
  EmergencyRequestStatus,
  EmergencyUrgencyLevel,
  BroadcastStatus,
  SupplierResponseStatus,
  FoodCategory,
  FoodCondition,
  PackagingStatus,
  FoodSafetyStatus,
  RouteHierarchy,
  ListingLifecycleStatus,
  JourneyStatus,
  AuditAction,
} from '@prisma/client';

describe('EmergencyService (Integration - Fase 9 TASK-009)', () => {
  let emergencyService: EmergencyService;
  let broadcastService: BroadcastService;
  let capacityService: CapacityService;
  let prisma: PrismaService;

  const mockMitra = {
    id: '10000000-0000-0000-0000-000000000003',
    email: 'mitra@replate.id',
    fullName: 'Siti Rahma Pengelola Dapur',
    role: 'MITRA',
    organizationId: '00000000-0000-0000-0000-000000000003',
  };

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
      providers: [EmergencyService, BroadcastService, CapacityService],
    }).compile();

    emergencyService = module.get<EmergencyService>(EmergencyService);
    broadcastService = module.get<BroadcastService>(BroadcastService);
    capacityService = module.get<CapacityService>(CapacityService);
    prisma = module.get<PrismaService>(PrismaService);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.recipientCapacity.updateMany({
      where: { recipientId: '20000000-0000-0000-0000-000000000001', capacityDate: today },
      data: { allocatedCapacityKg: 0, receivedCapacityKg: 0, availableCapacityKg: 100 },
    });
  });

  it('should create an emergency request with OPEN status and standardized estimatedKg', async () => {
    const req = await emergencyService.create(
      {
        neededFoodType: 'cooked_meals',
        foodTypeName: 'Makanan Siap Santap / Nasi Kotak',
        requestedPortions: 60,
        beneficiaryCount: 60,
        beneficiaryGroup: 'Warga Pengungsi Genangan Air',
        targetLocation: 'Posko Dapur Umum Mandiri, Tebet Barat',
        urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
        urgencyDeadline: 'Sebelum 12:30 WIB (Makan Siang)',
        urgencyReason: 'Persediaan makanan untuk pengungsi luapan kali habis.',
        contactPerson: 'Ibu Siti Rahma',
        contactPhone: '0812-3456-7890',
        notes: 'Diutamakan makanan siap santap hangat',
      },
      mockMitra as any,
    );

    expect(req).toBeDefined();
    expect(req.id).toBeDefined();
    expect(req.status).toBe(EmergencyRequestStatus.OPEN);
    expect(Number(req.requestedPortions)).toBe(60);
    expect(Number(req.estimatedKg)).toBe(21); // 60 * 0.35 = 21.0 kg
    expect(req.urgencyLevel).toBe(EmergencyUrgencyLevel.CRITICAL);
  });

  it('should reject non-mitra/non-admin user from creating emergency request', async () => {
    await expect(
      emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Kotak',
          requestedPortions: 30,
          beneficiaryCount: 30,
          beneficiaryGroup: 'Kelompok Warga',
          targetLocation: 'Posko Banjir',
          urgencyLevel: EmergencyUrgencyLevel.HIGH,
          urgencyDeadline: 'Sore',
          urgencyReason: 'Alasan darurat yang cukup panjang',
          contactPerson: 'Budi',
          contactPhone: '0812-1111-2222',
        },
        mockSupplier as any,
      ),
    ).rejects.toThrow('Hanya Mitra Penerima atau Admin yang berwenang');
  });

  it('matching-surplus: should strictly match surplus with FSG PASS and exclude REJECT/REVIEW', async () => {
    // 1. Create emergency request
    const emgReq = await emergencyService.create(
      {
        neededFoodType: 'cooked_meals',
        foodTypeName: 'Makanan Siap Santap',
        requestedPortions: 20,
        beneficiaryCount: 20,
        beneficiaryGroup: 'Lansia',
        targetLocation: 'Dapur Lansia Tebet',
        urgencyLevel: EmergencyUrgencyLevel.HIGH,
        urgencyDeadline: 'Sore ini',
        urgencyReason: 'Kebutuhan makan malam lansia binaan',
        contactPerson: 'Siti Rahma',
        contactPhone: '0812-0000-1111',
      },
      mockMitra as any,
    );

    // 2. Create PASS surplus
    const passSurplus = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Ayam Kecap Bersertifikat Aman',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 7,
        portions: 20,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 95,
        preparedAt: new Date(),
        safeUntilTimestamp: new Date(Date.now() + 4 * 3600 * 1000),
        currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
        safetyAssessment: {
          create: {
            safetyStatus: FoodSafetyStatus.PASS,
            gateReasons: ['Compliant'],
          },
        },
        scoreAssessment: {
          create: {
            totalScore: 88,
            conditionSubscore: 30,
            urgencySubscore: 25,
            quantitySubscore: 15,
            easeSubscore: 15,
            destinationFitSubscore: 15,
            recommendedRoute: RouteHierarchy.REDISTRIBUTE,
            scoreBreakdown: {},
          },
        },
      },
    });

    // 3. Create REJECT surplus (spoilage)
    const rejectSurplus = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Daging Berbau Asam Basi',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 10,
        portions: 30,
        condition: FoodCondition.SPOILED,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 40,
        preparedAt: new Date(),
        safeUntilTimestamp: new Date(Date.now() + 4 * 3600 * 1000),
        currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
        safetyAssessment: {
          create: {
            safetyStatus: FoodSafetyStatus.REJECT,
            gateReasons: ['Clear spoilage detected'],
          },
        },
        scoreAssessment: {
          create: {
            totalScore: 0,
            conditionSubscore: 0,
            urgencySubscore: 0,
            quantitySubscore: 0,
            easeSubscore: 0,
            destinationFitSubscore: 0,
            recommendedRoute: RouteHierarchy.ORGANIC,
            scoreBreakdown: {},
          },
        },
      },
    });

    const matches = await emergencyService.findMatchingSurplus(emgReq.id, mockMitra as any);
    const matchedIds = matches.map((m) => m.id);

    expect(matchedIds).toContain(passSurplus.id);
    expect(matchedIds).not.toContain(rejectSurplus.id);

    const matchedPass = matches.find((m) => m.id === passSurplus.id);
    expect(matchedPass).toBeDefined();
    expect(matchedPass!.distanceKm).toBeDefined();
    expect(matchedPass!.distanceKm).not.toBeNull();
    expect(matchedPass!.estimatedTransitMinutes).toBeDefined();
    expect(matchedPass!.estimatedTransitMinutes).toBeGreaterThanOrEqual(10);
  });

  it('should allocate PASS surplus to emergency request in atomic transaction', async () => {
    // 1. Create emergency request
    const emgReq = await emergencyService.create(
      {
        neededFoodType: 'cooked_meals',
        foodTypeName: 'Nasi Kotak Berkah',
        requestedPortions: 15,
        beneficiaryCount: 15,
        beneficiaryGroup: 'Dhuafa',
        targetLocation: 'Posko Matraman',
        urgencyLevel: EmergencyUrgencyLevel.HIGH,
        urgencyDeadline: 'Siang',
        urgencyReason: 'Pemenuhan bantuan makan siang dhuafa',
        contactPerson: 'Siti Rahma',
        contactPhone: '0812-7777-8888',
      },
      mockMitra as any,
    );

    // 2. Create PASS surplus
    const passSurplus = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Nasi Goreng Spesial',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 5,
        portions: 15,
        condition: FoodCondition.FRESH,
        packagingStatus: PackagingStatus.INTACT_SEALED,
        hygieneScore: 90,
        preparedAt: new Date(),
        safeUntilTimestamp: new Date(Date.now() + 4 * 3600 * 1000),
        currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
        safetyAssessment: {
          create: {
            safetyStatus: FoodSafetyStatus.PASS,
            gateReasons: ['Compliant'],
          },
        },
        scoreAssessment: {
          create: {
            totalScore: 85,
            conditionSubscore: 30,
            urgencySubscore: 25,
            quantitySubscore: 15,
            easeSubscore: 15,
            destinationFitSubscore: 15,
            recommendedRoute: RouteHierarchy.REDISTRIBUTE,
            scoreBreakdown: {},
          },
        },
      },
    });

    const beforeCap = await capacityService.getMyCapacity(mockMitra.organizationId);

    const allocResult = await emergencyService.allocate(
      emgReq.id,
      {
        surplusListingId: passSurplus.id,
        notes: 'Alokasi darurat makan siang',
      },
      mockMitra as any,
    );

    expect(allocResult.success).toBe(true);
    expect(allocResult.data.emergencyRequest.status).toBe(EmergencyRequestStatus.ALLOCATED);
    expect(allocResult.data.emergencyRequest.matchedSurplusId).toBe(passSurplus.id);
    expect(allocResult.data.journey.currentStatus).toBe(JourneyStatus.MATCHED);

    // Verify recipient capacity allocated
    const afterCap = await capacityService.getMyCapacity(mockMitra.organizationId);
    expect(afterCap.allocatedCapacityKg).toBe(beforeCap.allocatedCapacityKg + 5);

    // Verify surplus listing status is MATCHED
    const updatedSurplus = await prisma.surplusListing.findUnique({
      where: { id: passSurplus.id },
    });
    expect(updatedSurplus!.currentLifecycleStatus).toBe(ListingLifecycleStatus.MATCHED);
  });

  it('Safety Hard Gate: should strictly block allocation of REJECT or REVIEW food', async () => {
    const emgReq = await emergencyService.create(
      {
        neededFoodType: 'cooked_meals',
        foodTypeName: 'Makanan Darurat',
        requestedPortions: 10,
        beneficiaryCount: 10,
        beneficiaryGroup: 'Pengungsi',
        targetLocation: 'Posko Cilandak',
        urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
        urgencyDeadline: 'Segera',
        urgencyReason: 'Pasokan darurat mendesak untuk warga',
        contactPerson: 'Siti Rahma',
        contactPhone: '0812-9999-0000',
      },
      mockMitra as any,
    );

    const rejectSurplus = await prisma.surplusListing.create({
      data: {
        donorOrganizationId: mockSupplier.organizationId,
        reporterUserId: mockSupplier.id,
        foodName: 'Nasi Basi Berlendir',
        foodCategory: FoodCategory.COOKED_MEALS,
        quantityKg: 4,
        portions: 10,
        condition: FoodCondition.SPOILED,
        packagingStatus: PackagingStatus.DAMAGED,
        hygieneScore: 30,
        preparedAt: new Date(),
        safeUntilTimestamp: new Date(Date.now() + 2 * 3600 * 1000),
        currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
        safetyAssessment: {
          create: {
            safetyStatus: FoodSafetyStatus.REJECT,
            gateReasons: ['Spoiled and contaminated'],
          },
        },
        scoreAssessment: {
          create: {
            totalScore: 0,
            conditionSubscore: 0,
            urgencySubscore: 0,
            quantitySubscore: 0,
            easeSubscore: 0,
            destinationFitSubscore: 0,
            recommendedRoute: RouteHierarchy.SAFE_DISPOSAL,
            scoreBreakdown: {},
          },
        },
      },
    });

    await expect(
      emergencyService.allocate(
        emgReq.id,
        { surplusListingId: rejectSurplus.id },
        mockMitra as any,
      ),
    ).rejects.toThrow('Keamanan pangan mutlak dilindungi');
  });

  it('should update emergency request status to FULFILLED and record timestamp', async () => {
    const emgReq = await emergencyService.create(
      {
        neededFoodType: 'cooked_meals',
        foodTypeName: 'Nasi Kotak Telur',
        requestedPortions: 10,
        beneficiaryCount: 10,
        beneficiaryGroup: 'Warga',
        targetLocation: 'Posko',
        urgencyLevel: EmergencyUrgencyLevel.MEDIUM,
        urgencyDeadline: 'Besok',
        urgencyReason: 'Kebutuhan makan warga sekitar posko',
        contactPerson: 'Siti',
        contactPhone: '0812-3333-4444',
      },
      mockMitra as any,
    );

    const updated = await emergencyService.updateStatus(
      emgReq.id,
      { status: EmergencyRequestStatus.FULFILLED },
      mockMitra as any,
    );

    expect(updated.status).toBe(EmergencyRequestStatus.FULFILLED);
    expect(updated.fulfilledAt).toBeDefined();
  });

  it('Tombstone Soft Delete: should soft delete emergency request and exclude from queries', async () => {
    const emgReq = await emergencyService.create(
      {
        neededFoodType: 'fresh_produce',
        foodTypeName: 'Sayur Segar',
        requestedPortions: 10,
        beneficiaryCount: 10,
        beneficiaryGroup: 'Dapur Lansia',
        targetLocation: 'Posko Lansia',
        urgencyLevel: EmergencyUrgencyLevel.MEDIUM,
        urgencyDeadline: 'Siang',
        urgencyReason: 'Kebutuhan sayuran untuk dapur lansia',
        contactPerson: 'Siti',
        contactPhone: '0812-5555-6666',
      },
      mockMitra as any,
    );

    const deleteRes = await emergencyService.delete(emgReq.id, mockMitra as any);
    expect(deleteRes.success).toBe(true);

    // Verify DB flag
    const dbReq = await prisma.emergencyFoodRequest.findUnique({
      where: { id: emgReq.id },
    });
    expect(dbReq!.isDeleted).toBe(true);
    expect(dbReq!.deletedAt).toBeDefined();

    // Verify findOne throws NotFound
    await expect(emergencyService.findOne(emgReq.id)).rejects.toThrow('tidak ditemukan');

    // Verify findAll excludes deleted request
    const all = await emergencyService.findAll({});
    expect(all.some((r) => r.id === emgReq.id)).toBe(false);

    // Verify AuditLog
    const audit = await prisma.auditLog.findFirst({
      where: {
        tableName: 'emergency_food_requests',
        recordId: emgReq.id,
        action: AuditAction.DELETE,
      },
    });
    expect(audit).toBeDefined();
  });

  describe('SOS Emergency Broadcasts (Fase 13 - TASK-013)', () => {
    it('T-SOS-01: should automatically create an EmergencyBroadcast when an emergency request is created', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Kotak Ayam Bakar',
          requestedPortions: 50,
          beneficiaryCount: 50,
          beneficiaryGroup: 'Korban Banjir Bandang',
          targetLocation: 'Posko Utama Matraman',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: 'Sebelum 13:00 WIB',
          urgencyReason: 'Pasokan makanan darurat habis mendadak',
          contactPerson: 'Siti Rahma',
          contactPhone: '0812-3333-4444',
        },
        mockMitra as any,
      );

      const broadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });

      expect(broadcast).toBeDefined();
      expect(broadcast!.status).toBe(BroadcastStatus.ACTIVE);
      expect(broadcast!.neededFoodType).toBe('cooked_meals');
      expect(broadcast!.requestedPortions).toBe(50);
      expect(Number(broadcast!.targetQuantityKg)).toBe(17.5); // 50 * 0.35
      expect(broadcast!.radiusKm.toNumber()).toBe(20.0);
      expect(broadcast!.latitude).toBeDefined();
      expect(broadcast!.longitude).toBeDefined();
    });

    it('T-SOS-02: should calculate expiresAt ~2 hours from now for CRITICAL urgency', async () => {
      const expiry = broadcastService.calculateExpiry(EmergencyUrgencyLevel.CRITICAL);
      const diffMs = expiry.getTime() - Date.now();
      const diffHours = diffMs / (1000 * 60 * 60);

      expect(diffHours).toBeGreaterThanOrEqual(1.98);
      expect(diffHours).toBeLessThanOrEqual(2.02);
    });

    it('T-SOS-03: should calculate expiresAt ~4 hours for HIGH urgency', async () => {
      const expiry = broadcastService.calculateExpiry(EmergencyUrgencyLevel.HIGH);
      const diffMs = expiry.getTime() - Date.now();
      const diffHours = diffMs / (1000 * 60 * 60);

      expect(diffHours).toBeGreaterThanOrEqual(3.98);
      expect(diffHours).toBeLessThanOrEqual(4.02);
    });

    it('T-SOS-04: should calculate expiresAt for MEDIUM urgency toward end of day', async () => {
      const expiry = broadcastService.calculateExpiry(EmergencyUrgencyLevel.MEDIUM);
      expect(expiry.getTime()).toBeGreaterThan(Date.now());
      // Verify UTC hours is 16 (which corresponds to 23:59:59 WIB in UTC+7)
      expect(expiry.getUTCHours()).toBe(16);
      expect(expiry.getUTCMinutes()).toBe(59);
    });

    it('T-SOS-05: supplier should successfully respond to active SOS broadcast and create journey', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Kotak Rendang',
          requestedPortions: 30,
          beneficiaryCount: 30,
          beneficiaryGroup: 'Warga Mengungsi Mandiri',
          targetLocation: 'Balai Warga RW 05',
          urgencyLevel: EmergencyUrgencyLevel.HIGH,
          urgencyDeadline: 'Siang ini',
          urgencyReason: 'Tambahan pengungsi shift 2',
          contactPerson: 'Bambang',
          contactPhone: '0812-9999-8888',
        },
        mockMitra as any,
      );

      const broadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });
      expect(broadcast).toBeDefined();

      const result = await broadcastService.respondToBroadcast(
        broadcast!.id,
        { notes: 'Tersedia 30 porsi makanan siap santap higienis' },
        mockSupplier as any,
      );

      expect(result.success).toBe(true);
      expect(result.data.response).toBeDefined();
      expect(result.data.journey).toBeDefined();
      expect(result.data.surplusListing).toBeDefined();

      // Verify SurplusListing attributes
      const listing = await prisma.surplusListing.findUnique({
        where: { id: result.data.surplusListing.id },
        include: { safetyAssessment: true },
      });
      expect(listing!.isEmergencyResponse).toBe(true);
      expect(listing!.currentLifecycleStatus).toBe(ListingLifecycleStatus.MATCHED);
      expect(listing!.safetyAssessment?.safetyStatus).toBe(FoodSafetyStatus.PASS);

      // Verify Journey
      const journey = await prisma.rescueJourney.findUnique({
        where: { id: result.data.journey.id },
      });
      expect(journey!.currentStatus).toBe(JourneyStatus.MATCHED);

      // Verify Broadcast is now RESPONDED
      const updatedBroadcast = await prisma.emergencyBroadcast.findUnique({
        where: { id: broadcast!.id },
      });
      expect(updatedBroadcast!.status).toBe(BroadcastStatus.RESPONDED);

      // Verify EmergencyFoodRequest is now ALLOCATED
      const updatedEmg = await prisma.emergencyFoodRequest.findUnique({
        where: { id: emgReq.id },
      });
      expect(updatedEmg!.status).toBe(EmergencyRequestStatus.ALLOCATED);
      expect(updatedEmg!.matchedSurplusId).toBe(listing!.id);
    });

    it('T-SOS-06: should reject duplicate response from same supplier organization with 409 Conflict', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Liwet Darurat',
          requestedPortions: 20,
          beneficiaryCount: 20,
          beneficiaryGroup: 'Posko Darurat',
          targetLocation: 'Posko 1',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: 'Segera',
          urgencyReason: 'Mendesak',
          contactPerson: 'Siti',
          contactPhone: '0812-0000-1111',
        },
        mockMitra as any,
      );

      const broadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });

      // First response succeeds
      await broadcastService.respondToBroadcast(
        broadcast!.id,
        { notes: 'Siap kirim' },
        mockSupplier as any,
      );

      // Second response from same supplier fails
      await expect(
        broadcastService.respondToBroadcast(
          broadcast!.id,
          { notes: 'Siap kirim lagi' },
          mockSupplier as any,
        ),
      ).rejects.toThrow();
    });

    it('T-SOS-07: should reject response to expired broadcast with 422 Unprocessable Entity', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'fresh_produce',
          foodTypeName: 'Sayuran',
          requestedPortions: 15,
          beneficiaryCount: 15,
          beneficiaryGroup: 'Dapur Sayur',
          targetLocation: 'Posko Sayur',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: 'Pagi',
          urgencyReason: 'Sayur habis',
          contactPerson: 'Budi',
          contactPhone: '0812-7777-8888',
        },
        mockMitra as any,
      );

      // Force expiresAt to the past
      const broadcast = await prisma.emergencyBroadcast.update({
        where: { emergencyRequestId: emgReq.id },
        data: { expiresAt: new Date(Date.now() - 3600 * 1000) },
      });

      await expect(
        broadcastService.respondToBroadcast(
          broadcast.id,
          { notes: 'Coba respond expired' },
          mockSupplier as any,
        ),
      ).rejects.toThrow('kedaluwarsa');
    });

    it('T-SOS-08: should reject unauthorized roles from responding to broadcast', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Makanan',
          requestedPortions: 10,
          beneficiaryCount: 10,
          beneficiaryGroup: 'Kelompok Posko',
          targetLocation: 'Posko Mitra',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: 'Siang',
          urgencyReason: 'Alasan darurat',
          contactPerson: 'Mitra',
          contactPhone: '0812-1212-3434',
        },
        mockMitra as any,
      );

      const broadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });

      // MITRA role cannot respond to broadcast
      await expect(
        broadcastService.respondToBroadcast(
          broadcast!.id,
          { notes: 'Mitra mencoba kirim donasi' },
          mockMitra as any,
        ),
      ).rejects.toThrow('Hanya penyedia surplus');
    });

    it('T-SOS-09: expireStaleBroadcasts should automatically transition overdue ACTIVE broadcasts to EXPIRED', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'pantry_staples',
          foodTypeName: 'Beras & Sembako',
          requestedPortions: 40,
          beneficiaryCount: 40,
          beneficiaryGroup: 'Warga Terdampak',
          targetLocation: 'Gudang Posko Tebet',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: 'Segera',
          urgencyReason: 'Stok beras menipis',
          contactPerson: 'Koordinator Sembako',
          contactPhone: '0812-4444-5555',
        },
        mockMitra as any,
      );

      // Force broadcast to overdue
      await prisma.emergencyBroadcast.update({
        where: { emergencyRequestId: emgReq.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const expiredCount = await broadcastService.expireStaleBroadcasts();
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const updated = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });
      expect(updated!.status).toBe(BroadcastStatus.EXPIRED);
    });

    it('T-SOS-10: findActive should return active unexpired broadcasts and exclude expired ones', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Rawon Hangat',
          requestedPortions: 25,
          beneficiaryCount: 25,
          beneficiaryGroup: 'Dapur Relawan',
          targetLocation: 'Posko Relawan Jakarta',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: '1 Jam Lagi',
          urgencyReason: 'Pasokan darurat relawan',
          contactPerson: 'Pak Hendra',
          contactPhone: '0812-8888-9999',
        },
        mockMitra as any,
      );

      const activeBroadcasts = await broadcastService.findActive(mockSupplier as any);
      expect(activeBroadcasts.some((b) => b.emergencyRequestId === emgReq.id)).toBe(true);

      // Force expire it
      await prisma.emergencyBroadcast.update({
        where: { emergencyRequestId: emgReq.id },
        data: { expiresAt: new Date(Date.now() - 5000) },
      });

      const afterExpiry = await broadcastService.findActive(mockSupplier as any);
      expect(afterExpiry.some((b) => b.emergencyRequestId === emgReq.id)).toBe(false);
    });

    it('T-SOS-11: findMyResponses should list all confirmed responses for the calling supplier', async () => {
      const responses = await broadcastService.findMyResponses(mockSupplier as any);
      expect(Array.isArray(responses)).toBe(true);
      if (responses.length > 0) {
        expect(responses[0].supplierOrgId).toBe(mockSupplier.organizationId);
        expect(responses[0].broadcast).toBeDefined();
      }
    });

    it('T-SOS-12: cancelling emergency request should automatically cancel active broadcast', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'bakery_snacks',
          foodTypeName: 'Roti Gandum',
          requestedPortions: 20,
          beneficiaryCount: 20,
          beneficiaryGroup: 'Anak-anak Pengungsian',
          targetLocation: 'Posko Anak',
          urgencyLevel: EmergencyUrgencyLevel.MEDIUM,
          urgencyDeadline: 'Sore',
          urgencyReason: 'Kudapan sore anak',
          contactPerson: 'Ibu Rina',
          contactPhone: '0812-7777-1111',
        },
        mockMitra as any,
      );

      const initialBroadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });
      expect(initialBroadcast!.status).toBe(BroadcastStatus.ACTIVE);

      // Cancel the emergency request
      await emergencyService.updateStatus(
        emgReq.id,
        { status: EmergencyRequestStatus.CANCELLED, cancelReason: 'Bantuan sudah didapat dari posko tetangga' },
        mockMitra as any,
      );

      const cancelledBroadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });
      expect(cancelledBroadcast!.status).toBe(BroadcastStatus.CANCELLED);
    });
  });

  describe('Geospatial SOS Targeting (< 20 km Radius - TASK-015)', () => {
    let nearSupplierUser: any;
    let farSupplierUser: any;
    let noCoordSupplierUser: any;
    let adminUser: any;

    beforeAll(async () => {
      // 1. Setup Near Supplier (Grand Sahid, ~3 km from Matraman)
      nearSupplierUser = {
        id: '10000000-0000-0000-0000-000000000002',
        email: 'supplier@replate.id',
        role: 'SUPPLIER',
        organizationId: '00000000-0000-0000-0000-000000000002',
      };

      // 2. Setup Far Supplier (Bogor Catering, ~43 km from Matraman)
      const farOrg = await prisma.organization.upsert({
        where: { id: '00000000-0000-0000-0000-000000000099' },
        create: {
          id: '00000000-0000-0000-0000-000000000099',
          name: 'Katering Sedap Bogor',
          type: 'SUPPLIER',
          address: 'Jl. Raya Pajajaran No. 12, Bogor',
          latitude: -6.5971,
          longitude: 106.8060,
          isVerified: true,
        },
        update: {
          latitude: -6.5971,
          longitude: 106.8060,
        },
      });

      farSupplierUser = {
        id: '10000000-0000-0000-0000-000000000099',
        email: 'bogor@katering.id',
        role: 'SUPPLIER',
        organizationId: farOrg.id,
      };

      // 3. Setup Supplier without coordinates
      const noCoordOrg = await prisma.organization.upsert({
        where: { id: '00000000-0000-0000-0000-000000000098' },
        create: {
          id: '00000000-0000-0000-0000-000000000098',
          name: 'Warung Nasi Baru',
          type: 'SUPPLIER',
          address: 'Jl. Belum Disetel',
          latitude: null,
          longitude: null,
          isVerified: true,
        },
        update: {
          latitude: null,
          longitude: null,
        },
      });

      noCoordSupplierUser = {
        id: '10000000-0000-0000-0000-000000000098',
        email: 'nocoord@warung.id',
        role: 'SUPPLIER',
        organizationId: noCoordOrg.id,
      };

      // 4. Setup Admin User
      adminUser = {
        id: '10000000-0000-0000-0000-000000000001',
        email: 'admin@replate.id',
        role: 'ADMIN',
        organizationId: '00000000-0000-0000-0000-000000000001',
      };
    });

    it('T-GEO-01: should automatically populate posko coordinates and default radius 20 km on broadcast', async () => {
      const emgReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Bungkus Darurat',
          requestedPortions: 30,
          beneficiaryCount: 30,
          beneficiaryGroup: 'Korban Angin Kencang',
          targetLocation: 'Posko Matraman Barat',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: '1 Jam',
          urgencyReason: 'Kebutuhan mendesak pengungsi',
          contactPerson: 'Pak Joko',
          contactPhone: '0812-9988-7766',
        },
        mockMitra as any,
      );

      const broadcast = await prisma.emergencyBroadcast.findUnique({
        where: { emergencyRequestId: emgReq.id },
      });

      expect(broadcast).toBeDefined();
      expect(Number(broadcast!.radiusKm)).toBe(20.0);
      expect(broadcast!.latitude).not.toBeNull();
      expect(broadcast!.longitude).not.toBeNull();
      expect(Number(broadcast!.latitude)).toBeLessThan(0);
      expect(Number(broadcast!.longitude)).toBeGreaterThan(100);
    });

    it('T-GEO-02: supplier located near posko (< 20 km) should see active broadcast with distanceKm', async () => {
      const activeBroadcasts = await broadcastService.findActive(nearSupplierUser);
      expect(activeBroadcasts.length).toBeGreaterThan(0);
      const match = activeBroadcasts.find((b) => b.recipientLocation === 'Posko Matraman Barat');
      expect(match).toBeDefined();
      expect(match!.distanceKm).toBeDefined();
      expect(match!.distanceKm).toBeLessThan(20.0);
      expect(match!.requiresLocationSetup).toBe(false);
    });

    it('T-GEO-03: supplier located ~43 km away (> 20 km) should NOT see the broadcast', async () => {
      const activeBroadcasts = await broadcastService.findActive(farSupplierUser);
      const match = activeBroadcasts.find((b) => b.recipientLocation === 'Posko Matraman Barat');
      expect(match).toBeUndefined();
    });

    it('T-GEO-04: selective filtering with near posko (3 km) vs far posko (40 km)', async () => {
      // Create a distant posko organization and recipient profile in Bogor
      const bogorMitraOrg = await prisma.organization.upsert({
        where: { id: '00000000-0000-0000-0000-000000000088' },
        create: {
          id: '00000000-0000-0000-0000-000000000088',
          name: 'Dapur Posko Bencana Bogor',
          type: 'RECIPIENT',
          address: 'Jl. Pajajaran No. 88, Bogor',
          latitude: -6.5971,
          longitude: 106.8060,
          isVerified: true,
        },
        update: {
          latitude: -6.5971,
          longitude: 106.8060,
        },
      });

      const distantRecipientProfile = await prisma.recipientProfile.upsert({
        where: { organizationId: bogorMitraOrg.id },
        create: {
          organizationId: bogorMitraOrg.id,
          recipientType: 'COMMUNITY_KITCHEN',
          acceptedFoodCategories: ['COOKED_MEALS'],
          dailyMaxCapacityKg: 50.0,
          latitude: -6.5971,
          longitude: 106.8060,
        },
        update: {
          latitude: -6.5971,
          longitude: 106.8060,
        },
      });

      await prisma.user.upsert({
        where: { id: '10000000-0000-0000-0000-000000000088' },
        create: {
          id: '10000000-0000-0000-0000-000000000088',
          email: 'posko_bogor@replate.id',
          fullName: 'Relawan Posko Bogor',
          passwordHash: 'dummyhash123',
          role: 'MITRA',
          organizationId: bogorMitraOrg.id,
        },
        update: {
          organizationId: bogorMitraOrg.id,
        },
      });

      const bogorMitraUser = {
        id: '10000000-0000-0000-0000-000000000088',
        email: 'posko_bogor@replate.id',
        role: 'MITRA',
        organizationId: bogorMitraOrg.id,
      };

      const distantReq = await emergencyService.create(
        {
          neededFoodType: 'cooked_meals',
          foodTypeName: 'Nasi Kotak Posko Bogor',
          requestedPortions: 25,
          beneficiaryCount: 25,
          beneficiaryGroup: 'Warga Longsor Bogor',
          targetLocation: 'Posko Bencana Cisarua',
          urgencyLevel: EmergencyUrgencyLevel.CRITICAL,
          urgencyDeadline: 'Segera',
          urgencyReason: 'Akses logistik terputus',
          contactPerson: 'Pak Hendra',
          contactPhone: '0813-8888-9999',
        },
        bogorMitraUser as any,
      );

      // Jakarta nearSupplier calls findActive -> should NOT see the Bogor broadcast
      const jakartaSupplierBroadcasts = await broadcastService.findActive(nearSupplierUser);
      expect(jakartaSupplierBroadcasts.some((b) => b.emergencyRequestId === distantReq.id)).toBe(false);

      // Bogor farSupplier calls findActive -> SHOULD see the Bogor broadcast (< 5 km)
      const bogorSupplierBroadcasts = await broadcastService.findActive(farSupplierUser);
      const bogorMatch = bogorSupplierBroadcasts.find((b) => b.emergencyRequestId === distantReq.id);
      expect(bogorMatch).toBeDefined();
      expect(bogorMatch!.distanceKm).toBeLessThan(5.0);
    });

    it('T-GEO-05: sorting priority should rank CRITICAL before HIGH before MEDIUM, then nearest distance', async () => {
      const activeBroadcasts = await broadcastService.findActive(nearSupplierUser);
      expect(activeBroadcasts.length).toBeGreaterThan(1);

      // Verify that all CRITICAL urgency broadcasts appear before MEDIUM broadcasts
      let seenMedium = false;
      for (const b of activeBroadcasts) {
        if (b.urgencyLevel === 'MEDIUM') {
          seenMedium = true;
        }
        if (seenMedium) {
          expect(b.urgencyLevel).not.toBe('CRITICAL');
        }
      }
    });

    it('T-GEO-06: ADMIN role should see all broadcasts without distance elimination', async () => {
      const adminBroadcasts = await broadcastService.findActive(adminUser);
      expect(adminBroadcasts.length).toBeGreaterThan(0);
      // Admin sees both Jakarta and Bogor requests
      const hasJakarta = adminBroadcasts.some((b) => b.recipientLocation === 'Posko Matraman Barat');
      const hasBogor = adminBroadcasts.some((b) => b.recipientLocation === 'Posko Bencana Cisarua');
      expect(hasJakarta).toBe(true);
      expect(hasBogor).toBe(true);
    });

    it('T-GEO-07: supplier without coordinates should receive broadcasts with requiresLocationSetup flag', async () => {
      const broadcasts = await broadcastService.findActive(noCoordSupplierUser);
      expect(broadcasts.length).toBeGreaterThan(0);
      expect(broadcasts[0].requiresLocationSetup).toBe(true);
      expect(broadcasts[0].distanceKm).toBeNull();
    });

    it('T-GEO-08: supplier located outside 20 km radius should be rejected when attempting to respond', async () => {
      const jakartaBroadcast = await prisma.emergencyBroadcast.findFirst({
        where: { recipientLocation: 'Posko Matraman Barat', status: BroadcastStatus.ACTIVE },
      });
      expect(jakartaBroadcast).toBeDefined();

      // Bogor far supplier attempts to respond to Jakarta broadcast (~43 km away)
      await expect(
        broadcastService.respondToBroadcast(
          jakartaBroadcast!.id,
          { notes: 'Mencoba kirim dari Bogor luar jangkauan' },
          farSupplierUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
