import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { GlobalHttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

function getCookies(res: request.Response): string[] {
  const cookieHeader = res.headers['set-cookie'];
  if (!cookieHeader) return [];
  if (Array.isArray(cookieHeader)) return cookieHeader;
  return [cookieHeader as string];
}

describe('REPLATE Authentication & Authorization Pipeline (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let adminAccessToken: string;
  let supplierAccessToken: string;
  let mitraAccessToken: string;
  let adminRefreshTokenCookie: string;
  let supplierRefreshTokenCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalHttpExceptionFilter());

    prisma = app.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. LOGIN TESTS (POST /api/v1/auth/login)
  // =========================================================================
  describe('1. POST /api/v1/auth/login', () => {
    it('1.1 should login successfully as ADMIN with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@replate.id',
          password: 'admin123',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('admin@replate.id');
      expect(res.body.data.user.role).toBe('ADMIN');
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.expiresIn).toBe(900);

      // Verify Set-Cookie header for refreshToken
      const cookies = getCookies(res);
      expect(cookies.length).toBeGreaterThan(0);
      expect(cookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true);

      adminAccessToken = res.body.data.accessToken;
      adminRefreshTokenCookie = cookies.find((c: string) => c.startsWith('refreshToken=')) || '';
    });

    it('1.2 should login successfully as SUPPLIER with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'supplier@replate.id',
          password: 'supplier123',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('SUPPLIER');
      expect(res.body.data.user.email).toBe('supplier@replate.id');
      expect(res.body.data.accessToken).toBeDefined();

      supplierAccessToken = res.body.data.accessToken;
      const cookies = getCookies(res);
      supplierRefreshTokenCookie = cookies.find((c: string) => c.startsWith('refreshToken=')) || '';
    });

    it('1.3 should login successfully as MITRA with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'mitra@replate.id',
          password: 'mitra123',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('MITRA');
      expect(res.body.data.user.email).toBe('mitra@replate.id');
      expect(res.body.data.accessToken).toBeDefined();

      mitraAccessToken = res.body.data.accessToken;
    });

    it('1.4 should reject login with incorrect password (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@replate.id',
          password: 'wrongpassword',
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Email atau password tidak sesuai');
    });

    it('1.5 should reject login with non-existent email (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'ghost@replate.id',
          password: 'password123',
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Email atau password tidak sesuai');
    });

    it('1.6 should reject login with invalid email format (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'not-an-email',
          password: 'password123',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
    });

    it('1.7 should reject login with password shorter than 6 characters (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@replate.id',
          password: '123',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
    });

    it('1.8 should reject login with missing fields (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // 2. SELF-REGISTRATION TESTS (POST /api/v1/auth/register)
  // =========================================================================
  describe('2. POST /api/v1/auth/register', () => {
    const uniqueStamp = Date.now();
    const newSupplierEmail = `supplier_${uniqueStamp}@testdomain.com`;
    const newMitraEmail = `mitra_${uniqueStamp}@testdomain.com`;

    it('2.1 should register a new SUPPLIER and return access token + cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: `sup_${uniqueStamp}`,
          email: newSupplierEmail,
          password: 'Password123!',
          name: 'Budi Santoso Supplier',
          organizationName: 'PT Berkah Pangan Selaras',
          role: 'SUPPLIER',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.statusCode).toBe(201);
      expect(res.body.data.user.email).toBe(newSupplierEmail);
      expect(res.body.data.user.role).toBe('SUPPLIER');
      expect(res.body.data.user.organization.name).toBe('PT Berkah Pangan Selaras');
      expect(res.body.data.accessToken).toBeDefined();

      const cookies = getCookies(res);
      expect(cookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true);
    });

    it('2.2 should register a new MITRA and auto-provision RecipientProfile + RecipientCapacity (50kg)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: `mit_${uniqueStamp}`,
          email: newMitraEmail,
          password: 'Password123!',
          name: 'Siti Rahma Pengelola',
          organization: 'Yayasan Kasih Mandiri',
          role: 'mitra', // Test lowercase role
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(newMitraEmail);
      expect(res.body.data.user.role).toBe('MITRA');

      // Verify in DB that RecipientProfile and RecipientCapacity were automatically provisioned
      const orgId = res.body.data.user.organization.id;
      const recipientProfile = await prisma.recipientProfile.findUnique({
        where: { organizationId: orgId },
        include: { capacities: true },
      });

      expect(recipientProfile).toBeDefined();
      expect(Number(recipientProfile!.dailyMaxCapacityKg)).toBe(50.0);
      expect(recipientProfile!.capacities.length).toBeGreaterThanOrEqual(1);
      expect(Number(recipientProfile!.capacities[0].availableCapacityKg)).toBe(50.0);
      expect(Number(recipientProfile!.capacities[0].maxCapacityKg)).toBe(50.0);
    });

    it('2.3 should reject registration if email is already registered (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: `sup_dup_${uniqueStamp}`,
          email: newSupplierEmail, // Duplicate
          password: 'Password123!',
          name: 'Duplikat User',
          organizationName: 'Org Duplikat',
          role: 'SUPPLIER',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Email sudah terdaftar');
    });

    it('2.4 should reject registration for ADMIN role (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: `admin_${uniqueStamp}`,
          email: `admin_${uniqueStamp}@testdomain.com`,
          password: 'Password123!',
          name: 'Hacker Admin',
          organizationName: 'Fake Org',
          role: 'ADMIN',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Pendaftaran role ADMIN tidak diizinkan melalui registrasi publik');
    });

    it('2.5 should reject registration with username shorter than 3 characters (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: 'ab', // < 3
          email: `short_${uniqueStamp}@testdomain.com`,
          password: 'Password123!',
          name: 'Valid Name',
          organizationName: 'Valid Org',
          role: 'SUPPLIER',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
    });

    it('2.6 should reject registration with password shorter than 6 characters (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          username: `user_${uniqueStamp}`,
          email: `pass_short_${uniqueStamp}@testdomain.com`,
          password: '123', // < 6
          name: 'Valid Name',
          organizationName: 'Valid Org',
          role: 'SUPPLIER',
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // 3. GET CURRENT PROFILE (GET /api/v1/auth/me)
  // =========================================================================
  describe('3. GET /api/v1/auth/me', () => {
    it('3.1 should return user profile for authenticated ADMIN', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('admin@replate.id');
      expect(res.body.data.role).toBe('ADMIN');
      expect(res.body.data.organization).toBeDefined();
    });

    it('3.2 should return user profile for authenticated SUPPLIER', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${supplierAccessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('supplier@replate.id');
      expect(res.body.data.role).toBe('SUPPLIER');
      expect(res.body.data.organization.type).toBe('SUPPLIER');
    });

    it('3.3 should return user profile for authenticated MITRA with recipientProfile', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${mitraAccessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('mitra@replate.id');
      expect(res.body.data.role).toBe('MITRA');
      expect(res.body.data.organization.recipientProfile).toBeDefined();
    });

    it('3.4 should reject request without Authorization header (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(401);
    });

    it('3.5 should reject request with invalid / malformed token (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid.token.string')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 4. TOKEN REFRESH & ROTATION (POST /api/v1/auth/refresh)
  // =========================================================================
  describe('4. POST /api/v1/auth/refresh', () => {
    let newRefreshTokenCookie: string;
    let oldRawRefreshToken: string;

    it('4.1 should refresh token successfully using httpOnly Cookie', async () => {
      // First, extract the raw token from supplierRefreshTokenCookie
      const match = supplierRefreshTokenCookie.match(/refreshToken=([^;]+)/);
      oldRawRefreshToken = match ? match[1] : '';
      expect(oldRawRefreshToken).toBeTruthy();

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [supplierRefreshTokenCookie])
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.email).toBe('supplier@replate.id');

      // Verify new rotated cookie is issued
      const cookies = getCookies(res);
      expect(cookies.some((c: string) => c.startsWith('refreshToken='))).toBe(true);
      newRefreshTokenCookie = cookies.find((c: string) => c.startsWith('refreshToken=')) || '';
    });

    it('4.2 should reject reused / revoked refresh token (Anti-Replay / Revocation check)', async () => {
      // Trying to use the old raw token in request body
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRawRefreshToken })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Refresh token tidak valid atau telah kedaluwarsa');
    });

    it('4.3 should refresh token using request body with active token', async () => {
      const match = newRefreshTokenCookie.match(/refreshToken=([^;]+)/);
      const activeRawToken = match ? match[1] : '';

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: activeRawToken })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('4.4 should reject refresh request when no token is provided (400 Bad Request)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Refresh token wajib disertakan');
    });
  });

  // =========================================================================
  // 5. LOGOUT (POST /api/v1/auth/logout)
  // =========================================================================
  describe('5. POST /api/v1/auth/logout', () => {
    let logoutUserToken: string;
    let logoutRefreshToken: string;

    beforeAll(async () => {
      // Login fresh session for logout testing
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'admin@replate.id',
          password: 'admin123',
        });

      logoutUserToken = res.body.data.accessToken;
      const cookies = getCookies(res);
      const cookieStr = cookies.find((c: string) => c.startsWith('refreshToken=')) || '';
      const match = cookieStr.match(/refreshToken=([^;]+)/);
      logoutRefreshToken = match ? match[1] : '';
    });

    it('5.1 should logout successfully and clear refreshToken cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${logoutUserToken}`)
        .set('Cookie', [`refreshToken=${logoutRefreshToken}`])
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Sesi logout berhasil');

      // Verify cookie is cleared (Max-Age=0 or empty/expired)
      const cookies = getCookies(res);
      expect(cookies.some((c: string) => c.includes('refreshToken=;') || c.includes('Max-Age=0'))).toBe(true);
    });

    it('5.2 should verify that revoked refresh token cannot be used after logout', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: logoutRefreshToken })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Refresh token tidak valid atau telah kedaluwarsa');
    });

    it('5.3 should reject logout without authorization token (401 Unauthorized)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // 6. RBAC & ROLE-BASED ACCESS CONTROL MATRIX
  // =========================================================================
  describe('6. Role-Based Access Control (RBAC) Enforcement', () => {
    it('6.1 ADMIN endpoint (POST /admin/simulation/load-demo) - allowed for ADMIN, forbidden for SUPPLIER/MITRA', async () => {
      // 1. Supplier -> 403 Forbidden
      const supRes = await request(app.getHttpServer())
        .post('/api/v1/admin/simulation/load-demo')
        .set('Authorization', `Bearer ${supplierAccessToken}`)
        .expect(403);
      expect(supRes.body.success).toBe(false);

      // 2. Mitra -> 403 Forbidden
      const mitRes = await request(app.getHttpServer())
        .post('/api/v1/admin/simulation/load-demo')
        .set('Authorization', `Bearer ${mitraAccessToken}`)
        .expect(403);
      expect(mitRes.body.success).toBe(false);

      // 3. Unauthenticated -> 401 Unauthorized
      const unauthRes = await request(app.getHttpServer())
        .post('/api/v1/admin/simulation/load-demo')
        .expect(401);
      expect(unauthRes.body.success).toBe(false);

      // 4. Admin -> 200 OK
      const admRes = await request(app.getHttpServer())
        .post('/api/v1/admin/simulation/load-demo')
        .set('Authorization', `Bearer ${adminAccessToken}`)
        .expect(200);
      expect(admRes.body.success).toBe(true);

      // Clean up demo
      await request(app.getHttpServer())
        .delete('/api/v1/admin/simulation/clear-demo')
        .set('Authorization', `Bearer ${adminAccessToken}`);
    });

    it('6.2 SUPPLIER endpoint (GET /surplus-listings/my-dispatches) - allowed for SUPPLIER, forbidden for MITRA', async () => {
      // Mitra -> 403 Forbidden
      const mitRes = await request(app.getHttpServer())
        .get('/api/v1/surplus-listings/my-dispatches')
        .set('Authorization', `Bearer ${mitraAccessToken}`)
        .expect(403);
      expect(mitRes.body.success).toBe(false);

      // Supplier -> 200 OK
      const supRes = await request(app.getHttpServer())
        .get('/api/v1/surplus-listings/my-dispatches')
        .set('Authorization', `Bearer ${supplierAccessToken}`)
        .expect(200);
      expect(supRes.body.success).toBe(true);
      expect(Array.isArray(supRes.body.data)).toBe(true);
    });

    it('6.3 MITRA endpoint (GET /recipients/my-capacity) - allowed for MITRA, forbidden for SUPPLIER', async () => {
      // Supplier -> 403 Forbidden
      const supRes = await request(app.getHttpServer())
        .get('/api/v1/recipients/my-capacity')
        .set('Authorization', `Bearer ${supplierAccessToken}`)
        .expect(403);
      expect(supRes.body.success).toBe(false);

      // Mitra -> 200 OK
      const mitRes = await request(app.getHttpServer())
        .get('/api/v1/recipients/my-capacity')
        .set('Authorization', `Bearer ${mitraAccessToken}`)
        .expect(200);
      expect(mitRes.body.success).toBe(true);
      expect(mitRes.body.data.availableCapacityKg).toBeDefined();
    });
  });
});
