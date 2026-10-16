import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { GlobalHttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('REPLATE End-to-End API Pipeline (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let supplierToken: string;

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

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /api/v1/health -> Health Check Probe', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('replate-backend');
    expect(res.body.timestamp).toBeDefined();
  });

  it('2. POST /api/v1/auth/login -> Admin Login & Token Issuance', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'admin@replate.id',
        password: 'admin123',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(res.body.data.accessToken).toBeDefined();
    adminToken = res.body.data.accessToken;
  });

  it('3. POST /api/v1/auth/login -> Supplier Login & Token Issuance', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'supplier@replate.id',
        password: 'supplier123',
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('SUPPLIER');
    expect(res.body.data.accessToken).toBeDefined();
    supplierToken = res.body.data.accessToken;
  });

  it('4. GET /api/v1/surplus-listings/my-dispatches -> Supplier Dispatches List', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/surplus-listings/my-dispatches')
      .set('Authorization', `Bearer ${supplierToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('5. GET /api/v1/analytics/performance -> Public Rescue Performance KPIs', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/analytics/performance')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.kpis).toBeDefined();
    expect(res.body.data.funnel).toBeDefined();
    expect(res.body.data.environmentalSecondary).toBeDefined();
  });

  it('6. GET /api/v1/analytics/insights -> Upstream Prevention Insights', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/analytics/insights')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.topSurplusCategories).toBeDefined();
    expect(res.body.data.recommendations).toBeDefined();
  });

  it('7. POST /api/v1/admin/simulation/load-demo -> Forbidden for non-admin role (RBAC)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/simulation/load-demo')
      .set('Authorization', `Bearer ${supplierToken}`)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(403);
  });

  it('8. POST & DELETE /api/v1/admin/simulation/* -> Admin Simulation Lifecycle', async () => {
    // Load demo
    const loadRes = await request(app.getHttpServer())
      .post('/api/v1/admin/simulation/load-demo')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(loadRes.body.success).toBe(true);

    // Clear demo
    const clearRes = await request(app.getHttpServer())
      .delete('/api/v1/admin/simulation/clear-demo')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(clearRes.body.success).toBe(true);
    expect(clearRes.body.data.deletedCount).toBeGreaterThanOrEqual(1);
  });
});
