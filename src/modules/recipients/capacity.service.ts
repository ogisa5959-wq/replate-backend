import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CapacityService {
  private readonly logger = new Logger(CapacityService.name);

  constructor(private prisma: PrismaService) {}

  private getTodayUtc(): Date {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return today;
  }

  async getOrCreateDailyCapacity(recipientId: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;
    const today = this.getTodayUtc();

    let capacity = await client.recipientCapacity.findFirst({
      where: {
        recipientId,
        capacityDate: today,
      },
    });

    if (!capacity) {
      const profile = await client.recipientProfile.findUnique({
        where: { id: recipientId },
      });

      if (!profile) {
        throw new NotFoundException(`Recipient profile ${recipientId} tidak ditemukan`);
      }

      const maxCap = profile.dailyMaxCapacityKg;
      capacity = await client.recipientCapacity.create({
        data: {
          recipientId,
          capacityDate: today,
          maxCapacityKg: maxCap,
          allocatedCapacityKg: 0,
          receivedCapacityKg: 0,
          availableCapacityKg: maxCap,
        },
      });
    }

    return capacity;
  }

  async getMyCapacity(organizationId: string) {
    const profile = await this.prisma.recipientProfile.findUnique({
      where: { organizationId },
      include: { organization: true },
    });

    if (!profile) {
      throw new NotFoundException('Profil mitra penerima tidak ditemukan untuk organisasi ini');
    }

    const capacity = await this.getOrCreateDailyCapacity(profile.id);

    return {
      recipientId: profile.id,
      organizationName: profile.organization.name,
      recipientType: profile.recipientType,
      capacityDate: capacity.capacityDate,
      maxCapacityKg: Number(capacity.maxCapacityKg),
      allocatedCapacityKg: Number(capacity.allocatedCapacityKg),
      receivedCapacityKg: Number(capacity.receivedCapacityKg),
      availableCapacityKg: Number(capacity.availableCapacityKg),
      utilizationRatePercentage: Math.round(
        ((Number(capacity.allocatedCapacityKg) + Number(capacity.receivedCapacityKg)) /
          Number(capacity.maxCapacityKg)) *
          100,
      ),
    };
  }

  async reserveCapacity(
    recipientId: string,
    quantityKg: number,
    tx: Prisma.TransactionClient,
  ) {
    const today = this.getTodayUtc();

    // 1. Lock the row using SELECT ... FOR UPDATE
    const lockedRows = await tx.$queryRaw<Array<{
      id: string;
      max_capacity_kg: any;
      allocated_capacity_kg: any;
      received_capacity_kg: any;
      available_capacity_kg: any;
    }>>`
      SELECT id, max_capacity_kg, allocated_capacity_kg, received_capacity_kg, available_capacity_kg
      FROM recipient_capacities
      WHERE recipient_id = ${recipientId}::uuid AND capacity_date = ${today}::date
      FOR UPDATE
    `;

    let capacityRecord = lockedRows[0];

    if (!capacityRecord) {
      // Create then lock
      await this.getOrCreateDailyCapacity(recipientId, tx);
      const reLocked = await tx.$queryRaw<Array<{
        id: string;
        max_capacity_kg: any;
        allocated_capacity_kg: any;
        received_capacity_kg: any;
        available_capacity_kg: any;
      }>>`
        SELECT id, max_capacity_kg, allocated_capacity_kg, received_capacity_kg, available_capacity_kg
        FROM recipient_capacities
        WHERE recipient_id = ${recipientId}::uuid AND capacity_date = ${today}::date
        FOR UPDATE
      `;
      capacityRecord = reLocked[0];
    }

    const currentAvailable = Number(capacityRecord.available_capacity_kg);

    if (currentAvailable < quantityKg) {
      throw new ConflictException(
        `Kapasitas tidak mencukupi. Tersedia: ${currentAvailable.toFixed(1)} kg, Diminta: ${quantityKg.toFixed(1)} kg`,
      );
    }

    // Atomically increment allocated and decrement available
    await tx.recipientCapacity.update({
      where: { id: capacityRecord.id },
      data: {
        allocatedCapacityKg: { increment: quantityKg },
        availableCapacityKg: { decrement: quantityKg },
      },
    });

    return {
      success: true,
      allocatedKg: quantityKg,
      remainingAvailableKg: currentAvailable - quantityKg,
    };
  }

  async releaseCapacity(
    recipientId: string,
    quantityKg: number,
    tx: Prisma.TransactionClient,
  ) {
    const today = this.getTodayUtc();

    const lockedRows = await tx.$queryRaw<Array<{ id: string; available_capacity_kg: any }>>`
      SELECT id, available_capacity_kg
      FROM recipient_capacities
      WHERE recipient_id = ${recipientId}::uuid AND capacity_date = ${today}::date
      FOR UPDATE
    `;

    if (lockedRows.length > 0) {
      await tx.recipientCapacity.update({
        where: { id: lockedRows[0].id },
        data: {
          allocatedCapacityKg: { decrement: quantityKg },
          availableCapacityKg: { increment: quantityKg },
        },
      });
    }
  }

  async confirmReceivedCapacity(
    recipientId: string,
    allocatedKg: number,
    actualReceivedKg: number,
    tx: Prisma.TransactionClient,
  ) {
    const today = this.getTodayUtc();

    const lockedRows = await tx.$queryRaw<Array<{
      id: string;
      max_capacity_kg: any;
      allocated_capacity_kg: any;
      received_capacity_kg: any;
      available_capacity_kg: any;
    }>>`
      SELECT id, max_capacity_kg, allocated_capacity_kg, received_capacity_kg, available_capacity_kg
      FROM recipient_capacities
      WHERE recipient_id = ${recipientId}::uuid AND capacity_date = ${today}::date
      FOR UPDATE
    `;

    if (lockedRows.length > 0) {
      const row = lockedRows[0];
      const maxCap = Number(row.max_capacity_kg);
      const newAllocated = Math.max(0, Number(row.allocated_capacity_kg) - allocatedKg);
      const newReceived = Number(row.received_capacity_kg) + actualReceivedKg;
      const newAvailable = Math.max(0, maxCap - (newAllocated + newReceived));

      await tx.recipientCapacity.update({
        where: { id: row.id },
        data: {
          allocatedCapacityKg: newAllocated,
          receivedCapacityKg: newReceived,
          availableCapacityKg: newAvailable,
        },
      });
    }
  }
}
