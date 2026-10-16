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
});
