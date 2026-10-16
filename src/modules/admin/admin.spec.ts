import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AdminController } from './admin.controller';
import { SimulationService } from './simulation.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { PrismaService } from '@/prisma/prisma.service';
import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import configuration from '@/config/configuration';

describe('AdminModule & SimulationService (Integration Test)', () => {
  let controller: AdminController;
  let service: SimulationService;
  let prisma: PrismaService;

  const mockAdminUser: AuthenticatedUser = {
    id: '10000000-0000-0000-0000-000000000001',
    email: 'admin@replate.id',
    fullName: 'Siti Administrator',
    role: 'ADMIN',
    organizationId: '00000000-0000-0000-0000-000000000001',
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
        PrismaModule,
      ],
      controllers: [AdminController],
      providers: [SimulationService],
    }).compile();

    controller = module.get<AdminController>(AdminController);
    service = module.get<SimulationService>(SimulationService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Ensure clean state
    await service.clearDemoData(mockAdminUser.id);
  });

  it('should load demo simulation data and verify listings created', async () => {
    // Clear any prior demo data first
    await service.clearDemoData(mockAdminUser.id);

    const result = await controller.loadDemo(mockAdminUser);
    expect(result.success).toBe(true);
    expect(result.data.createdListingsCount).toBe(2);

    const demoListings = await prisma.surplusListing.findMany({
      where: { foodName: { startsWith: '[DEMO]' } },
      include: {
        safetyAssessment: true,
        scoreAssessment: true,
        journeys: true,
      },
    });

    expect(demoListings.length).toBe(2);
    expect(demoListings[0].safetyAssessment).toBeDefined();
    expect(demoListings[0].scoreAssessment).toBeDefined();
    expect(demoListings[0].journeys.length).toBeGreaterThan(0);
  });

  it('should clear demo simulation data without touching real records', async () => {
    const result = await controller.clearDemo(mockAdminUser);
    expect(result.success).toBe(true);
    expect(result.data.deletedCount).toBeGreaterThanOrEqual(2);

    const remainingDemoListings = await prisma.surplusListing.findMany({
      where: { foodName: { startsWith: '[DEMO]' } },
    });
    expect(remainingDemoListings.length).toBe(0);

    // Verify master data still intact
    const orgs = await prisma.organization.count();
    expect(orgs).toBeGreaterThanOrEqual(3);
  });
});
