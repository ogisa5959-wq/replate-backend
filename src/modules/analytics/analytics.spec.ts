import {
  AnalyticsService,
  formatRupiah,
  formatDuration,
} from './analytics.service';
import { PrismaService } from '@/prisma/prisma.service';

describe('AnalyticsService (8 Rescue Performance Verification Scenarios)', () => {
  let analyticsService: AnalyticsService;

  beforeAll(() => {
    // AnalyticsService can be instantiated with mock prisma since calculatePerformance is a pure deterministic engine
    analyticsService = new AnalyticsService({} as PrismaService);
  });

  // SCENARIO 1: Empty State
  it('Scenario 1: Empty state safely handles zero-division and returns "Belum ada data"', () => {
    const perf = analyticsService.calculatePerformance([], 'id');
    expect(perf.hasData).toBe(false);
    expect(perf.totalReports).toBe(0);
    expect(perf.kpis.totalReportedKg).toBe(0);
    expect(perf.kpis.totalRescuedKg).toBe(0);
    expect(perf.kpis.avgRescueTimeHours).toBeNull();
    expect(perf.kpis.avgRescueTimeString).toBe('Belum ada data');
    expect(perf.kpis.successRate).toBeNull();
    expect(perf.kpis.successRateString).toBe('Belum ada data');
    expect(perf.funnel.isSufficient).toBe(false);
    expect(perf.environmentalSecondary.co2eAvoidedKg).toBeNull();
  });

  // SCENARIO 2: Active reports only
  it('Scenario 2: Active reports never falsely claimed as rescued or failed', () => {
    const reports = [
      {
        id: 'rep-1',
        quantityKg: 10,
        foodCategory: 'COOKED_MEALS',
        currentLifecycleStatus: 'REPORTED',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'rep-2',
        quantityKg: 15,
        foodCategory: 'FRESH_PRODUCE',
        currentLifecycleStatus: 'MATCHED',
        createdAt: new Date().toISOString(),
      },
    ];

    const perf = analyticsService.calculatePerformance(reports, 'id');
    expect(perf.kpis.totalReportedKg).toBe(25);
    expect(perf.kpis.totalRescuedKg).toBe(0);
    expect(perf.kpis.completedTransactions).toBe(0);
    expect(perf.kpis.activeTransactions).toBe(2);
    expect(perf.kpis.dueTransactions).toBe(0);
    expect(perf.kpis.successRate).toBeNull();
    expect(perf.environmentalSecondary.co2eAvoidedKg).toBeNull();
  });

  // SCENARIO 3: Completed reports with valid latency and CO2e
  it('Scenario 3: Completed reports calculate 100% success rate, latency, and CO2e correctly', () => {
    const t0 = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
    const t1 = new Date().toISOString();

    const reports = [
      {
        id: 'rep-comp-1',
        quantityKg: 20,
        foodCategory: 'COOKED_MEALS',
        currentLifecycleStatus: 'RECEIVED',
        createdAt: t0,
        receivedAt: t1,
        journeyEvents: [
          { status: 'REPORTED', timestamp: t0 },
          { status: 'RECEIVED', timestamp: t1 },
        ],
      },
    ];

    const perf = analyticsService.calculatePerformance(reports, 'id');
    expect(perf.kpis.totalReportedKg).toBe(20);
    expect(perf.kpis.totalRescuedKg).toBe(20);
    expect(perf.kpis.completedTransactions).toBe(1);
    expect(perf.kpis.dueTransactions).toBe(1);
    expect(perf.kpis.successRate).toBe(100);
    expect(perf.kpis.successRateString).toBe('100,0%');
    expect(perf.kpis.avgRescueTimeHours).toBeGreaterThanOrEqual(1.9);
    expect(perf.kpis.avgRescueTimeHours).toBeLessThanOrEqual(2.1);
    expect(perf.environmentalSecondary.hasData).toBe(true);
    expect(perf.environmentalSecondary.co2eAvoidedKg).toBe(42.0); // 20 * 2.1 = 42.0
  });

  // SCENARIO 4: Actual received weight differs from initial weight
  it('Scenario 4: Confirmed actual received weight prioritized over reported weight', () => {
    const reports = [
      {
        id: 'rep-actual-weight',
        quantityKg: 50,
        actualReceivedKg: 42.5,
        foodCategory: 'FRESH_PRODUCE',
        currentLifecycleStatus: 'RECEIVED',
        createdAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      },
    ];

    const perf = analyticsService.calculatePerformance(reports, 'id');
    expect(perf.kpis.totalReportedKg).toBe(50);
    expect(perf.kpis.totalRescuedKg).toBe(42.5);
  });

  // SCENARIO 5: Portions conversion to kg
  it('Scenario 5: Portions standardized via 0.35 kg/portion benchmark', () => {
    const reports = [
      {
        id: 'rep-portions',
        quantityKg: 40,
        unit: 'portions', // 40 * 0.35 = 14 kg
        foodCategory: 'COOKED_MEALS',
        currentLifecycleStatus: 'REPORTED',
        createdAt: new Date().toISOString(),
      },
    ];

    const perf = analyticsService.calculatePerformance(reports, 'id');
    expect(perf.kpis.totalReportedKg).toBe(14);
  });

  // SCENARIO 6: Success rate denominator correctly includes only due transactions
  it('Scenario 6: Success rate denominator correctly includes only due transactions', () => {
    const reports = [
      {
        id: 'rep-a',
        quantityKg: 10,
        currentLifecycleStatus: 'RECEIVED',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        receivedAt: new Date().toISOString(),
      },
      {
        id: 'rep-b',
        quantityKg: 10,
        currentLifecycleStatus: 'RECEIVED',
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        receivedAt: new Date().toISOString(),
      },
      {
        id: 'rep-c',
        quantityKg: 10,
        currentLifecycleStatus: 'CANCELLED',
        cancellationReason: 'Kapasitas penerima penuh',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'rep-d',
        quantityKg: 10,
        currentLifecycleStatus: 'MATCHED',
        createdAt: new Date().toISOString(),
      },
    ];

    const perf = analyticsService.calculatePerformance(reports, 'id');
    expect(perf.kpis.completedTransactions).toBe(2);
    expect(perf.kpis.cancelledTransactions).toBe(1);
    expect(perf.kpis.activeTransactions).toBe(1);
    expect(perf.kpis.dueTransactions).toBe(3); // 2 completed + 1 cancelled
    expect(perf.kpis.successRate).toBe(66.7); // (2 / 3) * 100 = 66.7%
    expect(perf.kpis.successRateString).toBe('66,7%');
    expect(perf.bottlenecks.length).toBe(1);
    expect(perf.bottlenecks[0].reason).toBe('Kapasitas penerima penuh');
  });

  // SCENARIO 7: Surplus Value Exchange
  it('Scenario 7: Surplus Value Exchange differentiates donation savings from commercial sales', () => {
    const reports = [
      {
        id: 'rep-donated',
        quantityKg: 10,
        foodCategory: 'COOKED_MEALS', // benchmark Rp 25.000
        currentLifecycleStatus: 'RECEIVED',
        isCommercial: false,
      },
      {
        id: 'rep-commercial',
        quantityKg: 5,
        foodCategory: 'BAKERY_PASTRY', // benchmark Rp 35.000
        currentLifecycleStatus: 'RECEIVED',
        isCommercial: true,
        actualPriceIdr: 15000,
      },
    ];

    const perf = analyticsService.calculatePerformance(reports, 'id');
    // Offered: 10*25000 + 5*35000 = 250000 + 175000 = 425000
    expect(perf.economics.offeredValueIdr).toBe(425000);
    // Commercial Completed: 5 * 15000 = 75000
    expect(perf.economics.completedCommercialValueIdr).toBe(75000);
    // Recipient Savings: 10*25000 + 5*(35000 - 15000) = 250000 + 100000 = 350000
    expect(perf.economics.recipientSavingsIdr).toBe(350000);
    expect(perf.economics.donatedCompletedCount).toBe(1);
    expect(perf.economics.commercialCompletedCount).toBe(1);
  });

  // SCENARIO 8: Formatters validation
  it('Scenario 8: Formatters format Indonesian currency and durations reliably', () => {
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatDuration(null, 'id')).toBe('Belum ada data');
    expect(formatDuration(null, 'en')).toBe('No data available');
    expect(formatDuration(0.5, 'id')).toBe('30 menit');
    expect(formatDuration(2.4, 'id')).toBe('2,4 jam');
  });
});
