import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ProfileService } from './profile.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import configuration from '@/config/configuration';
import { calculateHaversineDistanceKm } from '@/common/utils/haversine.util';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

describe('ProfileService & Geolocation (Fase 14 TASK-014)', () => {
  let profileService: ProfileService;
  let prisma: PrismaService;

  const mockSupplierUserId = '10000000-0000-0000-0000-000000000002';
  const mockMitraUserId = '10000000-0000-0000-0000-000000000003';

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        PrismaModule,
      ],
      providers: [ProfileService],
    }).compile();

    profileService = module.get<ProfileService>(ProfileService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Kembalikan kondisi data demo agar tidak mengotori test suite modul lain
    const supplierHash = await argon2.hash('supplier123');
    await prisma.user.update({
      where: { id: mockSupplierUserId },
      data: {
        fullName: 'Budi Chef Executive',
        passwordHash: supplierHash,
      },
    });
    await prisma.organization.update({
      where: { id: '00000000-0000-0000-0000-000000000002' },
      data: {
        name: 'Grand Sahid Catering & Hotel',
        address: 'Jl. Jend. Sudirman Kav. 86, Jakarta Pusat',
        contactPhone: '021-5704444',
        contactEmail: 'catering@grandsahid.com',
        latitude: -6.208763,
        longitude: 106.818573,
      },
    });

    await prisma.user.update({
      where: { id: mockMitraUserId },
      data: { fullName: 'Ahmad Pengelola Dapur' },
    });
    await prisma.organization.update({
      where: { id: '00000000-0000-0000-0000-000000000003' },
      data: {
        name: 'Dapur Sosial Barokah Matraman',
        address: 'Jl. Matraman Raya No. 42, Jakarta Timur',
        contactPhone: '0812-3456-7890',
        contactEmail: 'dapur@barokah.org',
        latitude: -6.2088,
        longitude: 106.8456,
      },
    });
    await prisma.recipientProfile.update({
      where: { id: '20000000-0000-0000-0000-000000000001' },
      data: {
        dailyMaxCapacityKg: 100.0,
        latitude: -6.2088,
        longitude: 106.8456,
      },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.recipientCapacity.updateMany({
      where: {
        recipientId: '20000000-0000-0000-0000-000000000001',
        capacityDate: today,
      },
      data: {
        maxCapacityKg: 100.0,
        allocatedCapacityKg: 0,
        receivedCapacityKg: 0,
        availableCapacityKg: 100.0,
      },
    });
  });

  // T-PROF-01: GET /profile untuk SUPPLIER
  it('T-PROF-01: should get full profile for SUPPLIER with organization details and null recipientProfile', async () => {
    const profile = await profileService.getProfile(mockSupplierUserId);

    expect(profile).toBeDefined();
    expect(profile.user.id).toBe(mockSupplierUserId);
    expect(profile.user.role).toBe('SUPPLIER');
    expect(profile.organization).toBeDefined();
    expect(profile.organization.name).toMatch(/Surya Katering|Grand Sahid/);
    expect(profile.organization.latitude).toBeDefined();
    expect(profile.organization.longitude).toBeDefined();
    expect(profile.recipientProfile).toBeNull();
  });

  // T-PROF-02: GET /profile untuk MITRA
  it('T-PROF-02: should get full profile for MITRA including recipientProfile specs and coordinates', async () => {
    const profile = await profileService.getProfile(mockMitraUserId);

    expect(profile).toBeDefined();
    expect(profile.user.id).toBe(mockMitraUserId);
    expect(profile.user.role).toBe('MITRA');
    expect(profile.organization).toBeDefined();
    expect(profile.recipientProfile).toBeDefined();
    expect(profile.recipientProfile?.recipientType).toBe('COMMUNITY_KITCHEN');
    expect(profile.recipientProfile?.dailyMaxCapacityKg).toBeGreaterThan(0);
    expect(profile.recipientProfile?.latitude).toBeDefined();
    expect(profile.recipientProfile?.longitude).toBeDefined();
  });

  // T-PROF-03: PUT /profile update nama, nomor kontak, alamat, koordinat
  it('T-PROF-03: should update user name, organization address, and coordinates successfully', async () => {
    const updated = await profileService.updateProfile(mockSupplierUserId, {
      fullName: 'Budi Chef Executive Head',
      organizationName: 'Grand Sahid Catering & Ballroom',
      address: 'Jl. Jend. Sudirman No. 86-88, Jakarta Pusat',
      contactPhone: '021-5705555',
      contactEmail: 'catering.head@grandsahid.com',
      latitude: -6.2091,
      longitude: 106.8192,
    });

    expect(updated.user.fullName).toBe('Budi Chef Executive Head');
    expect(updated.organization.name).toBe('Grand Sahid Catering & Ballroom');
    expect(updated.organization.address).toContain('86-88');
    expect(updated.organization.contactPhone).toBe('021-5705555');
    expect(updated.organization.contactEmail).toBe('catering.head@grandsahid.com');
    expect(updated.organization.latitude).toBe(-6.2091);
    expect(updated.organization.longitude).toBe(106.8192);

    // Verify AuditLog was recorded
    const auditLog = await prisma.auditLog.findFirst({
      where: {
        recordId: mockSupplierUserId,
        tableName: 'users',
      },
      orderBy: { timestamp: 'desc' },
    });
    expect(auditLog).toBeDefined();
    expect(auditLog?.reason).toContain('geospasial');
  });

  // T-PROF-04: Validasi DTO menolak latitude di luar [-90, 90]
  it('T-PROF-04: should reject invalid latitude out of range via DTO validation', async () => {
    const invalidDto = plainToInstance(UpdateProfileDto, {
      latitude: 95.5,
      longitude: 106.8,
    });
    const errors = await validate(invalidDto);
    expect(errors.length).toBeGreaterThan(0);
    const latError = errors.find((e) => e.property === 'latitude');
    expect(latError).toBeDefined();
    expect(latError?.constraints?.max).toBeDefined();
  });

  // T-PROF-05: Validasi DTO menolak longitude di luar [-180, 180]
  it('T-PROF-05: should reject invalid longitude out of range via DTO validation', async () => {
    const invalidDto = plainToInstance(UpdateProfileDto, {
      latitude: -6.2,
      longitude: 195.0,
    });
    const errors = await validate(invalidDto);
    expect(errors.length).toBeGreaterThan(0);
    const lonError = errors.find((e) => e.property === 'longitude');
    expect(lonError).toBeDefined();
    expect(lonError?.constraints?.max).toBeDefined();
  });

  // T-PROF-06: PUT /profile pada MITRA sinkronisasi koordinat & spesifikasi operasional
  it('T-PROF-06: should sync coordinates to recipientProfile and update capacity specs for MITRA', async () => {
    const updated = await profileService.updateProfile(mockMitraUserId, {
      fullName: 'Ahmad Pengelola Posko Dapur',
      address: 'Jl. Matraman Raya No. 50, Jakarta Timur',
      latitude: -6.2095,
      longitude: 106.8465,
      recipientProfile: {
        dailyMaxCapacityKg: 120.0,
        hasRefrigeration: true,
        hasFreezer: true,
        acceptedFoodCategories: ['COOKED_MEALS', 'BAKERY_PASTRY', 'FRESH_PRODUCE', 'DAIRY_EGGS'],
      },
    });

    expect(updated.organization.latitude).toBe(-6.2095);
    expect(updated.organization.longitude).toBe(106.8465);
    expect(updated.recipientProfile?.latitude).toBe(-6.2095);
    expect(updated.recipientProfile?.longitude).toBe(106.8465);
    expect(updated.recipientProfile?.dailyMaxCapacityKg).toBe(120.0);
    expect(updated.recipientProfile?.hasFreezer).toBe(true);

    // Verify RecipientCapacity updated in DB
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const capacity = await prisma.recipientCapacity.findFirst({
      where: {
        recipientId: updated.recipientProfile?.id,
        capacityDate: today,
      },
    });
    expect(capacity).toBeDefined();
    expect(Number(capacity?.maxCapacityKg)).toBe(120.0);
  });

  // T-PROF-07: PUT /profile/password sukses jika password lama cocok
  it('T-PROF-07: should change password successfully when current password is valid', async () => {
    // Reset password to supplier123 first to be sure
    const currentHash = await argon2.hash('supplier123');
    await prisma.user.update({
      where: { id: mockSupplierUserId },
      data: { passwordHash: currentHash },
    });

    const result = await profileService.changePassword(mockSupplierUserId, {
      currentPassword: 'supplier123',
      newPassword: 'supplierBaru456!',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('berhasil diperbarui');

    // Verify in DB that password hash actually changed and matches new password
    const updatedUser = await prisma.user.findUnique({
      where: { id: mockSupplierUserId },
    });
    expect(updatedUser).toBeDefined();
    const isNewValid = await argon2.verify(
      updatedUser!.passwordHash,
      'supplierBaru456!',
    );
    expect(isNewValid).toBe(true);
  });

  // T-PROF-08: PUT /profile/password menolak jika password lama salah
  it('T-PROF-08: should reject password change if current password is wrong', async () => {
    await expect(
      profileService.changePassword(mockSupplierUserId, {
        currentPassword: 'salahPassword!',
        newPassword: 'supplierBebas789!',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  // T-PROF-09: PUT /profile/password menolak jika password baru sama dengan password lama
  it('T-PROF-09: should reject password change if new password is same as current password', async () => {
    await expect(
      profileService.changePassword(mockSupplierUserId, {
        currentPassword: 'supplierBaru456!',
        newPassword: 'supplierBaru456!',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  // T-PROF-10: PUT /profile/password membatalkan semua refresh token aktif
  it('T-PROF-10: should revoke all active refresh tokens when password is changed', async () => {
    // Create an active dummy refresh token
    await prisma.refreshToken.create({
      data: {
        userId: mockSupplierUserId,
        tokenHash: 'dummy_hash_' + Date.now(),
        expiresAt: new Date(Date.now() + 86400000),
        isRevoked: false,
      },
    });

    // Change password back to supplier123
    await profileService.changePassword(mockSupplierUserId, {
      currentPassword: 'supplierBaru456!',
      newPassword: 'supplier123',
    });

    // Check all refresh tokens are revoked
    const activeTokens = await prisma.refreshToken.findMany({
      where: {
        userId: mockSupplierUserId,
        isRevoked: false,
      },
    });
    expect(activeTokens.length).toBe(0);
  });

  // T-PROF-11: Utilitas Haversine menghitung jarak geospasial bola bumi
  it('T-PROF-11: should calculate Haversine distance between two coordinates accurately', () => {
    // Monumen Nasional (Monas): -6.175392, 106.827153
    // Tebet Barat: -6.226891, 106.858032
    // Jarak nyata garis lurus sekitar 6.64 km
    const distanceKm = calculateHaversineDistanceKm(
      -6.175392,
      106.827153,
      -6.226891,
      106.858032,
    );

    expect(distanceKm).toBeGreaterThan(6.0);
    expect(distanceKm).toBeLessThan(7.2);
    expect(distanceKm).toBe(6.67);

    // Titik yang sama harus 0 km
    const zeroDistance = calculateHaversineDistanceKm(
      -6.175392,
      106.827153,
      -6.175392,
      106.827153,
    );
    expect(zeroDistance).toBe(0);

    // Verifikasi SOS radius check (<= 20 km)
    expect(distanceKm <= 20).toBe(true);
  });
});
