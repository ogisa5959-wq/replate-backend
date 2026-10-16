import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ListingLifecycleStatus, JourneyStatus } from '@prisma/client';

export const METRIC_ASSUMPTIONS = {
  AVERAGE_SERVING_KG: 0.35,
  CO2E_FACTOR_PER_KG: 2.1,
  WATER_LITERS_PER_KG: 250,
};

export const CATEGORY_BENCHMARK_PRICE_IDR: Record<string, number> = {
  COOKED_MEALS: 25000,
  BAKERY_PASTRY: 35000,
  DAIRY_EGGS: 40000,
  FRESH_PRODUCE: 20000,
  PACKAGED_DRY: 30000,
  BEVERAGES: 15000,
  other: 25000,
};

export function formatRupiah(amount: number): string {
  if (amount === 0) return 'Rp 0';
  const formatted = Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Rp ${formatted}`;
}

export function formatDuration(hours: number | null | undefined, lang: 'id' | 'en' = 'id'): string {
  const isId = lang === 'id';
  if (hours === null || hours === undefined || isNaN(hours)) {
    return isId ? 'Belum ada data' : 'No data available';
  }
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} ${isId ? 'menit' : 'mins'}`;
  }
  const h = Math.round(hours * 10) / 10;
  return `${h.toLocaleString(isId ? 'id-ID' : 'en-US')} ${isId ? 'jam' : 'hours'}`;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  async getPerformance(lang: 'id' | 'en' = 'id') {
    const isId = lang === 'id';

    const listings = await this.prisma.surplusListing.findMany({
      include: {
        journeys: {
          include: {
            timelineEvents: true,
          },
        },
      },
    });

    return this.calculatePerformance(listings, lang);
  }

  calculatePerformance(listings: any[], lang: 'id' | 'en' = 'id') {
    const isId = lang === 'id';

    if (!listings || listings.length === 0) {
      return {
        hasData: false,
        totalReports: 0,
        kpis: {
          totalReportedKg: 0,
          totalReportedTransactions: 0,
          totalRescuedKg: 0,
          humanRescuedKg: 0,
          organicRescuedKg: 0,
          completedTransactions: 0,
          avgRescueTimeHours: null,
          avgRescueTimeString: isId ? 'Belum ada data' : 'No data available',
          successRate: null,
          successRateString: isId ? 'Belum ada data' : 'No data available',
          dueTransactions: 0,
          activeTransactions: 0,
          cancelledTransactions: 0,
        },
        bottlenecks: [],
        funnel: {
          isSufficient: false,
          stages: [],
        },
        economics: {
          hasEconomics: false,
          offeredValueIdr: 0,
          completedCommercialValueIdr: 0,
          recipientSavingsIdr: null,
          commercialCompletedCount: 0,
          donatedCompletedCount: 0,
        },
        environmentalSecondary: {
          hasData: false,
          co2eAvoidedKg: null,
          waterSavedLiters: null,
          mealsEquivalent: null,
          methodologyNote: isId
            ? 'Metrik sekunder berdasarkan pemodelan US EPA WARM (2.1 kg CO₂e/kg) dan FAO (250 L/kg). Hanya dihitung setelah transaksi fisik dikonfirmasi diterima.'
            : 'Secondary modeling estimates based on US EPA WARM (2.1 kg CO2e/kg) and FAO (250 L/kg).',
        },
      };
    }

    let totalReportedKg = 0;
    let totalRescuedKg = 0;
    let humanRescuedKg = 0;
    let organicRescuedKg = 0;

    let completedTransactions = 0;
    let activeTransactions = 0;
    let cancelledTransactions = 0;
    let expiredTransactions = 0;

    let commercialCompletedCount = 0;
    let donatedCompletedCount = 0;

    let offeredValueIdr = 0;
    let completedCommercialValueIdr = 0;
    let recipientSavingsIdr = 0;

    const validDurationsMs: number[] = [];
    const detectedBottlenecks: any[] = [];

    listings.forEach((listing) => {
      // Weight
      const rawQty = Number(listing.quantityKg) || 0;
      const reportedKg = listing.unit === 'portions'
        ? rawQty * METRIC_ASSUMPTIONS.AVERAGE_SERVING_KG
        : rawQty;

      totalReportedKg += reportedKg;

      const journey = listing.journeys?.[0];
      const status = journey?.currentStatus || listing.currentLifecycleStatus || 'REPORTED';

      // Benchmark Price
      const catKey = listing.foodCategory || 'COOKED_MEALS';
      const benchmarkPrice = CATEGORY_BENCHMARK_PRICE_IDR[catKey] || CATEGORY_BENCHMARK_PRICE_IDR.other;
      offeredValueIdr += reportedKg * benchmarkPrice;

      if (status === 'RECEIVED') {
        completedTransactions += 1;
        const confirmedWeight = journey?.actualReceivedKg !== undefined && journey?.actualReceivedKg !== null
          ? Math.max(0, Number(journey.actualReceivedKg))
          : (listing.actualReceivedKg !== undefined && listing.actualReceivedKg !== null
            ? Math.max(0, Number(listing.actualReceivedKg))
            : reportedKg);

        totalRescuedKg += confirmedWeight;
        if (listing.recommendedRoute === 'ORGANIC') {
          organicRescuedKg += confirmedWeight;
        } else {
          humanRescuedKg += confirmedWeight;
        }

        // Duration calculation
        const tCreated = new Date(listing.createdAt).getTime();
        let tReceived: number | null = null;
        if (journey?.receivedAt) {
          tReceived = new Date(journey.receivedAt).getTime();
        } else if (listing.receivedAt) {
          tReceived = new Date(listing.receivedAt).getTime();
        } else if (journey?.timelineEvents) {
          const ev = journey.timelineEvents.find((e: any) => e.status === 'RECEIVED');
          if (ev) tReceived = new Date(ev.timestamp).getTime();
        } else if (listing.journeyEvents) {
          const ev = listing.journeyEvents.find((e: any) => e.status === 'RECEIVED');
          if (ev) tReceived = new Date(ev.timestamp).getTime();
        }

        if (tCreated && tReceived && !isNaN(tCreated) && !isNaN(tReceived) && tReceived >= tCreated) {
          validDurationsMs.push(tReceived - tCreated);
        }

        // Economics
        if (listing.isCommercial || (listing.actualPriceIdr && listing.actualPriceIdr > 0)) {
          commercialCompletedCount += 1;
          const actualPrice = Number(listing.actualPriceIdr) || 0;
          completedCommercialValueIdr += confirmedWeight * actualPrice;
          if (benchmarkPrice > actualPrice) {
            recipientSavingsIdr += (benchmarkPrice - actualPrice) * confirmedWeight;
          }
        } else {
          donatedCompletedCount += 1;
          recipientSavingsIdr += confirmedWeight * benchmarkPrice;
        }
      } else if (status === 'CANCELLED') {
        cancelledTransactions += 1;
        const reason = journey?.cancellationReason || listing.cancellationReason || listing.failureReason;
        if (reason) {
          detectedBottlenecks.push({
            type: 'CANCELLED',
            id: listing.id,
            foodName: listing.foodName || 'Surplus',
            reason,
          });
        }
      } else if (status === 'EXPIRED') {
        expiredTransactions += 1;
        detectedBottlenecks.push({
          type: 'EXPIRED',
          id: listing.id,
          foodName: listing.foodName || 'Surplus',
          reason: isId ? 'Batas waktu aman terlampaui sebelum serah terima selesai' : 'Safe window elapsed',
        });
      } else {
        // Active ongoing
        activeTransactions += 1;
      }
    });

    // 3. Average Rescue Latency
    let avgRescueTimeHours: number | null = null;
    let avgRescueTimeString = isId ? 'Belum ada data' : 'No data available';
    if (validDurationsMs.length > 0) {
      const totalMs = validDurationsMs.reduce((acc, v) => acc + v, 0);
      avgRescueTimeHours = totalMs / validDurationsMs.length / (1000 * 3600);
      avgRescueTimeString = formatDuration(avgRescueTimeHours, lang);
    }

    // 4. Success Rate: completed / (completed + cancelled + expired)
    const dueTransactions = completedTransactions + cancelledTransactions + expiredTransactions;
    let successRate: number | null = null;
    let successRateString = isId ? 'Belum ada data' : 'No data available';
    if (dueTransactions > 0) {
      successRate = Math.round((completedTransactions / dueTransactions) * 1000) / 10;
      successRateString = `${successRate.toLocaleString(isId ? 'id-ID' : 'en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    }

    // 5. Environmental Secondary
    const hasEnvironmentalData = totalRescuedKg > 0;
    const co2eAvoidedKg = hasEnvironmentalData
      ? Math.round(totalRescuedKg * METRIC_ASSUMPTIONS.CO2E_FACTOR_PER_KG * 10) / 10
      : null;
    const waterSavedLiters = hasEnvironmentalData
      ? Math.round(totalRescuedKg * METRIC_ASSUMPTIONS.WATER_LITERS_PER_KG)
      : null;
    const mealsEquivalent = hasEnvironmentalData
      ? Math.round(totalRescuedKg / METRIC_ASSUMPTIONS.AVERAGE_SERVING_KG)
      : null;

    return {
      hasData: true,
      totalReports: listings.length,
      kpis: {
        totalReportedKg: Math.round(totalReportedKg * 10) / 10,
        totalReportedTransactions: listings.length,
        totalRescuedKg: Math.round(totalRescuedKg * 10) / 10,
        humanRescuedKg: Math.round(humanRescuedKg * 10) / 10,
        organicRescuedKg: Math.round(organicRescuedKg * 10) / 10,
        completedTransactions,
        avgRescueTimeHours,
        avgRescueTimeString,
        successRate,
        successRateString,
        dueTransactions,
        activeTransactions,
        cancelledTransactions,
      },
      bottlenecks: detectedBottlenecks,
      funnel: {
        isSufficient: listings.length > 0,
        stages: [
          { name: isId ? 'Laporan Diterima' : 'Intake Reported', count: listings.length, conversionRate: 100 },
          { name: isId ? 'Selesai Diterima' : 'Rescued & Received', count: completedTransactions, conversionRate: listings.length > 0 ? Math.round((completedTransactions / listings.length) * 1000) / 10 : 0 },
        ],
      },
      economics: {
        hasEconomics: offeredValueIdr > 0,
        offeredValueIdr,
        completedCommercialValueIdr,
        recipientSavingsIdr: completedTransactions > 0 ? recipientSavingsIdr : null,
        commercialCompletedCount,
        donatedCompletedCount,
      },
      environmentalSecondary: {
        hasData: hasEnvironmentalData,
        co2eAvoidedKg,
        waterSavedLiters,
        mealsEquivalent,
        methodologyNote: isId
          ? 'Metrik sekunder berdasarkan pemodelan US EPA WARM (2.1 kg CO₂e/kg) dan FAO (250 L/kg). Hanya dihitung setelah transaksi fisik dikonfirmasi diterima.'
          : 'Secondary modeling estimates based on US EPA WARM (2.1 kg CO2e/kg) and FAO (250 L/kg).',
      },
    };
  }

  async getInsights(lang: 'id' | 'en' = 'id') {
    const isId = lang === 'id';

    const categoryStats = await this.prisma.surplusListing.groupBy({
      by: ['foodCategory'],
      _count: { id: true },
      _sum: { quantityKg: true },
    });

    const topCategories = categoryStats.map((c) => ({
      category: c.foodCategory,
      count: c._count.id,
      totalKg: Number(c._sum.quantityKg || 0),
    }));

    return {
      topSurplusCategories: topCategories,
      recommendations: [
        {
          title: isId ? 'Optimasi Porsi Prasmanan' : 'Buffet Portion Optimization',
          description: isId
            ? 'Data menunjukkan surplus makanan matang paling tinggi terjadi pada akhir pekan. Disarankan penyesuaian batch masak bertahap.'
            : 'Cooked meal surplus peaks on weekends. Recommend continuous batch cooking adjustments.',
        },
        {
          title: isId ? 'Penyimpanan Suhu Dingin untuk Roti & Pastry' : 'Cold Holding for Bakery',
          description: isId
            ? 'Menjaga kelembapan dan penyimpanan tertutup memperpanjang masa layak pastry hingga 24 jam.'
            : 'Sealed storage extends bakery shelf-life up to 24 hours.',
        },
      ],
    };
  }
}
