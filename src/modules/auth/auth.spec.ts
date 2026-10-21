import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import configuration from '@/config/configuration';

describe('AuthService (Integration)', () => {
  let authService: AuthService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        JwtModule.register({}),
        PrismaModule,
      ],
      providers: [AuthService],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should authenticate demo admin successfully and return JWT tokens', async () => {
    const result = await authService.login({
      email: 'admin@replate.id',
      password: 'admin123',
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe('admin@replate.id');
    expect(result.user.role).toBe('ADMIN');
    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(result.expiresIn).toBe(900);
  });

  it('should authenticate demo supplier successfully', async () => {
    const result = await authService.login({
      email: 'supplier@replate.id',
      password: 'supplier123',
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe('supplier@replate.id');
    expect(result.user.role).toBe('SUPPLIER');
  });

  it('should authenticate demo mitra successfully', async () => {
    const result = await authService.login({
      email: 'mitra@replate.id',
      password: 'mitra123',
    });

    expect(result).toBeDefined();
    expect(result.user.email).toBe('mitra@replate.id');
    expect(result.user.role).toBe('MITRA');
  });

  it('should reject login with incorrect password', async () => {
    await expect(
      authService.login({
        email: 'admin@replate.id',
        password: 'wrongpassword',
      }),
    ).rejects.toThrow('Email atau password tidak sesuai');
  });

  it('should reject login with non-existent email', async () => {
    await expect(
      authService.login({
        email: 'ghost@replate.id',
        password: 'password123',
      }),
    ).rejects.toThrow('Email atau password tidak sesuai');
  });

  it('should perform token rotation on refresh', async () => {
    const loginResult = await authService.login({
      email: 'supplier@replate.id',
      password: 'supplier123',
    });

    const refreshed = await authService.refreshTokens(loginResult.refreshToken);
    expect(refreshed.accessToken).toBeDefined();
    expect(refreshed.refreshToken).toBeDefined();
    expect(refreshed.refreshToken).not.toBe(loginResult.refreshToken);

    // Old refresh token must be revoked and fail
    await expect(authService.refreshTokens(loginResult.refreshToken)).rejects.toThrow(
      'Refresh token tidak valid atau telah kedaluwarsa',
    );
  });

  it('should retrieve authenticated user profile with organization', async () => {
    const adminUser = await prisma.user.findUnique({
      where: { email: 'admin@replate.id' },
    });

    const profile = await authService.getMe(adminUser!.id);
    expect(profile.email).toBe('admin@replate.id');
    expect(profile.organization.name).toContain('REPLATE');
  });

  describe('Self-Registration (Fase 10 - TASK-010)', () => {
    const testSupplierEmail = `supplier_${Date.now()}@replate.id`;
    const testMitraEmail = `mitra_${Date.now()}@replate.id`;

    it('should register a new SUPPLIER user and organization successfully', async () => {
      const result = await authService.register({
        username: 'test_supplier',
        email: testSupplierEmail,
        password: 'Password123!',
        name: 'Budi Santoso',
        organizationName: 'Katering Berkah Mandiri',
        role: 'SUPPLIER' as any,
      });

      expect(result).toBeDefined();
      expect(result.user.email).toBe(testSupplierEmail);
      expect(result.user.role).toBe('SUPPLIER');
      expect(result.user.organization.name).toBe('Katering Berkah Mandiri');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should register a new MITRA user and auto-provision RecipientProfile with daily capacity', async () => {
      const result = await authService.register({
        username: 'test_mitra',
        email: testMitraEmail,
        password: 'Password123!',
        name: 'Siti Rahmawati',
        organizationName: 'Dapur Dhuafa Peduli',
        role: 'MITRA' as any,
      });

      expect(result).toBeDefined();
      expect(result.user.role).toBe('MITRA');

      // Check auto-provisioned recipient profile & capacity
      const profile = await prisma.recipientProfile.findUnique({
        where: { organizationId: result.user.organization.id },
        include: { capacities: true },
      });

      expect(profile).toBeDefined();
      expect(Number(profile!.dailyMaxCapacityKg)).toBe(50.0);
      expect(profile!.capacities.length).toBeGreaterThanOrEqual(1);
      expect(Number(profile!.capacities[0].availableCapacityKg)).toBe(50.0);
    });

    it('should reject registration if email is already taken', async () => {
      await expect(
        authService.register({
          username: 'duplicate_user',
          email: testSupplierEmail,
          password: 'Password123!',
          name: 'Duplikat',
          organizationName: 'Org Duplikat',
          role: 'SUPPLIER' as any,
        }),
      ).rejects.toThrow('Email sudah terdaftar');
    });

    it('should reject registration if role is ADMIN', async () => {
      await expect(
        authService.register({
          username: 'fake_admin',
          email: 'fake_admin@replate.id',
          password: 'Password123!',
          name: 'Fake Admin',
          organizationName: 'Fake HQ',
          role: 'ADMIN' as any,
        }),
      ).rejects.toThrow('Pendaftaran role ADMIN tidak diizinkan melalui registrasi publik');
    });

    it('should save geocoordinates and address when provided during registration', async () => {
      const geoEmail = `geo_${Date.now()}@replate.id`;
      const result = await authService.register({
        username: 'geo_supplier',
        email: geoEmail,
        password: 'Password123!',
        name: 'Geo Owner',
        organizationName: 'Geo Resto',
        role: 'SUPPLIER' as any,
        address: 'Jl. Merdeka No. 45, Jakarta',
        latitude: -6.2150,
        longitude: 106.8200,
      });

      expect(result).toBeDefined();
      const org = await prisma.organization.findUnique({
        where: { id: result.user.organization.id },
      });
      expect(org!.address).toBe('Jl. Merdeka No. 45, Jakarta');
      expect(Number(org!.latitude)).toBeCloseTo(-6.2150, 4);
      expect(Number(org!.longitude)).toBeCloseTo(106.8200, 4);
    });
  });
});
