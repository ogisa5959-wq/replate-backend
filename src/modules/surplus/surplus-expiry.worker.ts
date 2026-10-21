import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { ListingLifecycleStatus, JourneyStatus, AuditAction, BroadcastStatus } from '@prisma/client';

@Injectable()
export class SurplusExpiryWorker {
  private readonly logger = new Logger(SurplusExpiryWorker.name);

  constructor(private prisma: PrismaService) {}

  // Cron schedule: Every 5 minutes
  @Cron('*/5 * * * *')
  async handleSurplusExpiry(): Promise<{
    expiredCount: number;
    cancelledMatchedCount: number;
    flaggedInTransitCount: number;
    expiredBroadcastCount?: number;
  }> {
    this.logger.log('⏰ Running scheduled surplus expiry worker...');
    const now = new Date();

    let expiredCount = 0;
    let cancelledMatchedCount = 0;
    let flaggedInTransitCount = 0;

    // 1. Process REPORTED listings that passed safe_until_timestamp
    const expiredListings = await this.prisma.surplusListing.findMany({
      where: {
        currentLifecycleStatus: { in: [ListingLifecycleStatus.REPORTED, ListingLifecycleStatus.ASSESSED] },
        safeUntilTimestamp: { lte: now },
      },
    });

    for (const listing of expiredListings) {
      await this.prisma.$transaction(async (tx) => {
        await tx.surplusListing.update({
          where: { id: listing.id },
          data: { currentLifecycleStatus: ListingLifecycleStatus.EXPIRED },
        });

        await tx.auditLog.create({
          data: {
            tableName: 'surplus_listings',
            recordId: listing.id,
            action: AuditAction.STATUS_CHANGE,
            previousState: { status: listing.currentLifecycleStatus },
            newState: { status: ListingLifecycleStatus.EXPIRED },
            reason: 'Otomatis ditandai kedaluwarsa oleh Expiry Worker (safe_until_timestamp terlampaui)',
          },
        });
      });
      expiredCount++;
    }

    // 2. Process MATCHED listings that expired before rescue was initiated
    const expiredMatchedListings = await this.prisma.surplusListing.findMany({
      where: {
        currentLifecycleStatus: ListingLifecycleStatus.MATCHED,
        safeUntilTimestamp: { lte: now },
      },
      include: {
        journeys: {
          where: { currentStatus: JourneyStatus.MATCHED },
        },
      },
    });

    for (const listing of expiredMatchedListings) {
      for (const journey of listing.journeys) {
        await this.prisma.$transaction(async (tx) => {
          // Cancel journey & listing
          await tx.rescueJourney.update({
            where: { id: journey.id },
            data: {
              currentStatus: JourneyStatus.CANCELLED,
              cancelledAt: now,
              cancellationReason: 'Dibatalkan otomatis oleh Expiry Worker: melewati batas aman sebelum diambil kurir',
            },
          });

          await tx.surplusListing.update({
            where: { id: listing.id },
            data: { currentLifecycleStatus: ListingLifecycleStatus.CANCELLED },
          });

          // Restore reserved capacity for recipient
          const today = new Date();
          today.setUTCHours(0, 0, 0, 0);

          const capacityRecord = await tx.recipientCapacity.findFirst({
            where: {
              recipientId: journey.recipientId,
              capacityDate: today,
            },
          });

          if (capacityRecord) {
            const qty = Number(listing.quantityKg);
            const currentAllocated = Number(capacityRecord.allocatedCapacityKg);
            const maxCap = Number(capacityRecord.maxCapacityKg);
            const decr = Math.min(qty, currentAllocated);
            const newAllocated = Math.max(0, currentAllocated - decr);
            const newAvailable = Math.min(maxCap, Number(capacityRecord.availableCapacityKg) + decr);

            await tx.recipientCapacity.update({
              where: { id: capacityRecord.id },
              data: {
                allocatedCapacityKg: newAllocated,
                availableCapacityKg: newAvailable,
              },
            });
          }

          // Record timeline event
          await tx.journeyTimelineEvent.create({
            data: {
              journeyId: journey.id,
              status: JourneyStatus.CANCELLED,
              note: 'Kedaluwarsa otomatis sebelum penjemputan. Kapasitas mitra telah dipulihkan.',
            },
          });

          // Audit log
          await tx.auditLog.create({
            data: {
              tableName: 'rescue_journeys',
              recordId: journey.id,
              action: AuditAction.CANCEL,
              previousState: { status: JourneyStatus.MATCHED },
              newState: { status: JourneyStatus.CANCELLED },
              reason: 'Otomatis dibatalkan karena waktu simpan aman habis sebelum penjemputan',
            },
          });
        });
        cancelledMatchedCount++;
      }
    }

    // 3. Process RESCUE_INITIATED transactions (in transit)
    // Do NOT cancel abruptly in transit! Flag with overdue warning
    const inTransitOverdue = await this.prisma.rescueJourney.findMany({
      where: {
        currentStatus: JourneyStatus.RESCUE_INITIATED,
        listing: {
          safeUntilTimestamp: { lte: now },
        },
      },
      include: {
        timelineEvents: true,
      },
    });

    for (const journey of inTransitOverdue) {
      const alreadyFlagged = journey.timelineEvents.some((e) =>
        e.note?.includes('Peringatan: Keterlambatan Waktu Simpan'),
      );

      if (!alreadyFlagged) {
        await this.prisma.$transaction(async (tx) => {
          await tx.journeyTimelineEvent.create({
            data: {
              journeyId: journey.id,
              status: JourneyStatus.RESCUE_INITIATED,
              note: 'Peringatan: Keterlambatan Waktu Simpan Aman Terdeteksi. Wajib pemeriksaan sensoris ketat saat serah terima.',
            },
          });

          await tx.auditLog.create({
            data: {
              tableName: 'rescue_journeys',
              recordId: journey.id,
              action: AuditAction.STATUS_CHANGE,
              reason: 'Flag peringatan keterlambatan waktu simpan aman (in-transit delay alert)',
            },
          });
        });
        flaggedInTransitCount++;
      }
    }

    // 4. Process ACTIVE emergency broadcasts that passed expires_at
    const expiredBroadcasts = await this.prisma.emergencyBroadcast.updateMany({
      where: {
        status: BroadcastStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      data: {
        status: BroadcastStatus.EXPIRED,
      },
    });
    const expiredBroadcastCount = expiredBroadcasts.count;

    this.logger.log(
      `✅ Expiry worker completed. Expired: ${expiredCount}, Cancelled Matched: ${cancelledMatchedCount}, Flagged In-Transit: ${flaggedInTransitCount}, Expired Broadcasts: ${expiredBroadcastCount}`,
    );

    return {
      expiredCount,
      cancelledMatchedCount,
      flaggedInTransitCount,
      expiredBroadcastCount,
    };
  }
}
