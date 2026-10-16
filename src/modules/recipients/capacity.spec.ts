import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { CapacityService } from './capacity.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import configuration from '@/config/configuration';
import { ConflictException } from '@nestjs/common';

describe('CapacityService (Concurrency & Constraints)', () => {
  let capacityService: CapacityService;
  let prisma: PrismaService;

  const mockMitraOrgId = '00000000-0000-0000-0000-000000000003';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        PrismaModule,
      ],
      providers: [CapacityService],
    }).compile();

    capacityService = module.get<CapacityService>(CapacityService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should retrieve my-capacity for authenticated recipient partner', async () => {
    const cap = await capacityService.getMyCapacity(mockMitraOrgId);
    expect(cap).toBeDefined();
    expect(cap.organizationName).toContain('Barokah');
    expect(cap.maxCapacityKg).toBe(100);
    expect(cap.availableCapacityKg).toBeGreaterThanOrEqual(0);
  });

  it('should prevent overbooking and throw ConflictException when requesting capacity > available', async () => {
    const profile = await prisma.recipientProfile.findUnique({
      where: { organizationId: mockMitraOrgId },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        // Request 999 kg when max is 100 kg
        await capacityService.reserveCapacity(profile!.id, 999, tx);
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should atomically allocate and release capacity', async () => {
    const profile = await prisma.recipientProfile.findUnique({
      where: { organizationId: mockMitraOrgId },
    });

    const initialCap = await capacityService.getMyCapacity(mockMitraOrgId);
    const initialAvail = initialCap.availableCapacityKg;

    // Allocate 10 kg
    await prisma.$transaction(async (tx) => {
      await capacityService.reserveCapacity(profile!.id, 10, tx);
    });

    const allocatedCap = await capacityService.getMyCapacity(mockMitraOrgId);
    expect(allocatedCap.allocatedCapacityKg).toBe(initialCap.allocatedCapacityKg + 10);
    expect(allocatedCap.availableCapacityKg).toBe(initialAvail - 10);

    // Release 10 kg (e.g. on cancellation)
    await prisma.$transaction(async (tx) => {
      await capacityService.releaseCapacity(profile!.id, 10, tx);
    });

    const releasedCap = await capacityService.getMyCapacity(mockMitraOrgId);
    expect(releasedCap.allocatedCapacityKg).toBe(initialCap.allocatedCapacityKg);
    expect(releasedCap.availableCapacityKg).toBe(initialAvail);
  });
});
