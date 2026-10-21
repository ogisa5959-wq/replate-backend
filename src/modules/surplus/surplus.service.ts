import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateSurplusDto } from './dto/create-surplus.dto';
import { UpdateSafetyParametersDto } from './dto/update-safety-parameters.dto';
import { AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { FoodSafetyGateEngine } from '../engines/food-safety-gate.engine';
import { RescueScoreEngine } from '../engines/rescue-score.engine';
import { RouteHierarchyEngine } from '../engines/route-hierarchy.engine';
import { MatchingEngine, RecipientCandidate } from '../engines/matching.engine';
import {
  ListingLifecycleStatus,
  UserRole,
  AuditAction,
  FoodCategory,
  RouteHierarchy,
} from '@prisma/client';

@Injectable()
export class SurplusService {
  private readonly logger = new Logger(SurplusService.name);

  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSurplusDto, user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPPLIER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Hanya donor/supplier atau admin yang berwenang melaporkan surplus makanan');
    }

    // 1. Resolve FoodType
    let foodType = null;
    if (dto.foodTypeCode) {
      foodType = await this.prisma.foodType.findUnique({
        where: { code: dto.foodTypeCode },
      });
    }

    // 2. Compute safe_until_timestamp
    const prepDate = new Date(dto.preparedAt);
    const maxSafeHours = foodType ? Number(foodType.maxSafeHours) : (
      dto.foodCategory === FoodCategory.COOKED_MEALS ? 4.0 :
      dto.foodCategory === FoodCategory.BAKERY_PASTRY ? 24.0 :
      dto.foodCategory === FoodCategory.DAIRY_EGGS ? 12.0 :
      dto.foodCategory === FoodCategory.FRESH_PRODUCE ? 48.0 : 168.0
    );

    const safeUntilTimestamp = new Date(prepDate.getTime() + maxSafeHours * 60 * 60 * 1000);

    // 3. Evaluate Food Safety Gate
    const safetyResult = FoodSafetyGateEngine.evaluate({
      foodTypeId: dto.foodTypeCode || dto.foodCategory,
      category: dto.foodCategory,
      safetyConditionId: dto.safetyConditionId,
      conditionId: dto.condition,
      storageHistoryId: dto.storageHistoryId,
      storageTempId: dto.storageTempId,
      preparedAt: dto.preparedAt,
      storageDurationHours: (Date.now() - prepDate.getTime()) / (1000 * 60 * 60),
      timeWindowId: dto.timeWindowId,
      packagingConditionId: dto.packagingConditionId,
      handlingIntegrityId: dto.handlingIntegrityId,
    });

    // 4. Calculate Rescue Score
    const scoreResult = RescueScoreEngine.calculate({
      foodTypeId: dto.foodTypeCode,
      category: dto.foodCategory,
      quantity: dto.quantityKg,
      unit: 'kg',
      conditionId: dto.condition,
      timeWindowId: dto.timeWindowId,
    });

    // 5. Determine Route Hierarchy
    const routeResult = RouteHierarchyEngine.determine({
      foodTypeId: dto.foodTypeCode,
      conditionId: dto.condition,
      timeWindowId: dto.timeWindowId,
      foodSafetyGate: safetyResult,
    });

    // 6. Save in Transaction
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.surplusListing.create({
        data: {
          donorOrganizationId: user.organizationId,
          reporterUserId: user.id,
          foodTypeId: foodType?.id || null,
          foodName: dto.foodName,
          foodCategory: dto.foodCategory,
          quantityKg: dto.quantityKg,
          portions: dto.portions,
          condition: dto.condition,
          storageTemperatureC: dto.storageTemperatureC,
          packagingStatus: dto.packagingStatus,
          hygieneScore: dto.hygieneScore,
          preparedAt: prepDate,
          safeUntilTimestamp,
          notes: dto.notes,
          currentLifecycleStatus: ListingLifecycleStatus.ASSESSED,
        },
      });

      // Food safety assessment record
      const safetyAssessment = await tx.foodSafetyAssessment.create({
        data: {
          listingId: listing.id,
          safetyStatus: safetyResult.status,
          gateReasons: safetyResult.reasons,
          storageHistoryKnown: dto.storageHistoryId !== 'unknown',
          isExpired: safetyResult.parametersChecked.timing?.status === 'reject',
          hasSpoilageSigns: dto.condition === 'SPOILED' || dto.safetyConditionId === 'clear_spoilage',
          packagingDamaged: dto.packagingStatus === 'DAMAGED' || dto.packagingConditionId === 'damaged_leaking_contaminated',
          hygieneAdequate: dto.hygieneScore >= 70,
          tempAbuseDetected: safetyResult.reasons.some((r) => r.toLowerCase().includes('suhu')),
        },
      });

      // Rescue score assessment record
      const recommendedRouteEnum = routeResult.route === 'PENDING_VERIFICATION'
        ? RouteHierarchy.REDISTRIBUTE
        : (routeResult.route as RouteHierarchy);

      const scoreAssessment = await tx.rescueScoreAssessment.create({
        data: {
          listingId: listing.id,
          totalScore: scoreResult.score,
          conditionSubscore: scoreResult.breakdown.condition.score,
          urgencySubscore: scoreResult.breakdown.urgency.score,
          quantitySubscore: scoreResult.breakdown.quantity.score,
          easeSubscore: scoreResult.breakdown.distributionEase.score,
          destinationFitSubscore: scoreResult.breakdown.destinationCompatibility.score,
          recommendedRoute: recommendedRouteEnum,
          scoreBreakdown: scoreResult.breakdown as any,
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          tableName: 'surplus_listings',
          recordId: listing.id,
          action: AuditAction.CREATE,
          actorUserId: user.id,
          newState: {
            foodName: listing.foodName,
            status: listing.currentLifecycleStatus,
            safetyStatus: safetyAssessment.safetyStatus,
            score: scoreAssessment.totalScore,
          },
          reason: 'Pelaporan surplus pangan baru via form donor',
        },
      });

      return {
        ...listing,
        safetyAssessment: {
          status: safetyAssessment.safetyStatus,
          eligibleForConsumption: safetyResult.eligibleForConsumptionRecommendation,
          headline: safetyResult.headline,
          summary: safetyResult.summary,
          reasons: safetyResult.reasons,
          missingInformation: safetyResult.missingInformation,
          alternativeRouteRecommendation: safetyResult.alternativeRouteRecommendation,
          citations: safetyResult.citations,
        },
        scoreAssessment: {
          totalScore: scoreAssessment.totalScore,
          priority: scoreResult.priority,
          recommendedRoute: routeResult.route,
          breakdown: scoreResult.breakdown,
          rationale: scoreResult.rationale,
        },
      };
    });
  }

  async findAll(params: {
    status?: ListingLifecycleStatus;
    category?: FoodCategory;
    donorId?: string;
  }) {
    const where: any = { isDeleted: false };
    if (params.status) where.currentLifecycleStatus = params.status;
    if (params.category) where.foodCategory = params.category;
    if (params.donorId) where.donorOrganizationId = params.donorId;

    return this.prisma.surplusListing.findMany({
      where,
      include: {
        donorOrganization: true,
        safetyAssessment: true,
        scoreAssessment: true,
        journeys: {
          include: {
            recipient: {
              include: {
                organization: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyDispatches(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPPLIER && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Akses khusus portal donor/supplier');
    }

    return this.prisma.surplusListing.findMany({
      where: {
        donorOrganizationId: user.organizationId,
        isDeleted: false,
      },
      include: {
        safetyAssessment: true,
        scoreAssessment: true,
        journeys: {
          include: {
            recipient: {
              include: {
                organization: true,
              },
            },
            timelineEvents: {
              orderBy: { timestamp: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const listing = await this.prisma.surplusListing.findUnique({
      where: { id },
      include: {
        donorOrganization: true,
        reporterUser: {
          select: { id: true, fullName: true, email: true },
        },
        safetyAssessment: true,
        scoreAssessment: true,
        journeys: {
          include: {
            recipient: {
              include: { organization: true },
            },
            timelineEvents: {
              orderBy: { timestamp: 'asc' },
            },
          },
        },
      },
    });

    if (!listing || listing.isDeleted) {
      throw new NotFoundException(`Surplus listing dengan ID ${id} tidak ditemukan`);
    }

    return listing;
  }

  async getAssessment(id: string) {
    const listing = await this.findOne(id);
    const safetyAssessment = listing.safetyAssessment;
    const scoreAssessment = listing.scoreAssessment;

    // Fetch candidate recipients
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const recipientProfiles = await this.prisma.recipientProfile.findMany({
      include: {
        organization: true,
        capacities: {
          where: { capacityDate: today },
        },
      },
    });

    const candidates: RecipientCandidate[] = recipientProfiles.map((p) => {
      const cap = p.capacities[0];
      const available = cap ? Number(cap.availableCapacityKg) : Number(p.dailyMaxCapacityKg);

      return {
        id: p.id,
        name: p.organization.name,
        organizationId: p.organizationId,
        recipientType: p.recipientType,
        acceptedFoodCategories: p.acceptedFoodCategories as FoodCategory[],
        dailyMaxCapacityKg: Number(p.dailyMaxCapacityKg),
        availableCapacityKg: available,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
      };
    });

    const fsgResult = FoodSafetyGateEngine.evaluate({
      foodTypeId: listing.foodTypeId || listing.foodCategory,
      category: listing.foodCategory,
      conditionId: listing.condition,
      storageTempId: listing.storageTemperatureC && Number(listing.storageTemperatureC) >= 60
        ? 'hot_holding_above_60'
        : 'ambient_room_temp',
    });

    const donorLat = listing.donorOrganization?.latitude
      ? Number(listing.donorOrganization.latitude)
      : null;
    const donorLon = listing.donorOrganization?.longitude
      ? Number(listing.donorOrganization.longitude)
      : null;

    const matches = MatchingEngine.match({
      foodCategory: listing.foodCategory,
      quantityKg: Number(listing.quantityKg),
      recommendedRoute: scoreAssessment?.recommendedRoute || RouteHierarchy.REDISTRIBUTE,
      foodSafetyGate: fsgResult,
      candidates,
      donorCoords: donorLat !== null && donorLon !== null ? { latitude: donorLat, longitude: donorLon } : null,
    });

    return {
      listingId: listing.id,
      foodName: listing.foodName,
      quantityKg: listing.quantityKg,
      portions: listing.portions,
      donorOrganization: {
        id: listing.donorOrganizationId,
        name: listing.donorOrganization?.name || 'Donatur',
        latitude: donorLat,
        longitude: donorLon,
      },
      safetyAssessment,
      scoreAssessment,
      matches,
    };
  }

  async getMatches(id: string) {
    const assessment = await this.getAssessment(id);
    return assessment.matches;
  }

  async updateSafetyParameters(
    id: string,
    dto: UpdateSafetyParametersDto,
    user: AuthenticatedUser,
  ) {
    const listing = await this.findOne(id);

    // Ownership check
    if (user.role !== UserRole.ADMIN && listing.donorOrganizationId !== user.organizationId) {
      throw new ForbiddenException('Anda tidak memiliki hak untuk mengubah data surplus milik organisasi lain');
    }

    const previousSafety = listing.safetyAssessment?.safetyStatus;

    // Re-evaluate FSG
    const updatedSafety = FoodSafetyGateEngine.evaluate({
      foodTypeId: listing.foodTypeId || listing.foodCategory,
      category: listing.foodCategory,
      safetyConditionId: dto.safetyConditionId,
      storageHistoryId: dto.storageHistoryId,
      storageTempId: dto.storageTempId,
      packagingConditionId: dto.packagingConditionId,
      handlingIntegrityId: dto.handlingIntegrityId,
      preparedAt: listing.preparedAt,
    });

    // Re-determine route
    const updatedRoute = RouteHierarchyEngine.determine({
      foodTypeId: listing.foodTypeId || listing.foodCategory,
      conditionId: listing.condition,
      foodSafetyGate: updatedSafety,
    });

    return this.prisma.$transaction(async (tx) => {
      if (listing.safetyAssessment) {
        await tx.foodSafetyAssessment.update({
          where: { listingId: id },
          data: {
            safetyStatus: updatedSafety.status,
            gateReasons: updatedSafety.reasons,
            storageHistoryKnown: dto.storageHistoryId ? dto.storageHistoryId !== 'unknown' : undefined,
            assessedAt: new Date(),
          },
        });
      }

      const recommendedRouteEnum = updatedRoute.route === 'PENDING_VERIFICATION'
        ? RouteHierarchy.REDISTRIBUTE
        : (updatedRoute.route as RouteHierarchy);

      if (listing.scoreAssessment) {
        await tx.rescueScoreAssessment.update({
          where: { listingId: id },
          data: {
            recommendedRoute: recommendedRouteEnum,
            calculatedAt: new Date(),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tableName: 'food_safety_assessments',
          recordId: id,
          action: AuditAction.UPDATE,
          actorUserId: user.id,
          previousState: { status: previousSafety },
          newState: { status: updatedSafety.status, route: updatedRoute.route },
          reason: dto.reVerificationNotes || 'Pembaruan parameter keselamatan makanan via Assessment modal',
        },
      });

      return {
        message: 'Parameter keselamatan berhasil diperbarui',
        safetyStatus: updatedSafety.status,
        route: updatedRoute.route,
        safetyDetails: updatedSafety,
      };
    });
  }

  async delete(id: string, user: AuthenticatedUser) {
    const listing = await this.prisma.surplusListing.findUnique({
      where: { id },
      include: { donorOrganization: true },
    });

    if (!listing || listing.isDeleted) {
      throw new NotFoundException(`Surplus listing dengan ID ${id} tidak ditemukan`);
    }

    if (user.role !== UserRole.ADMIN && listing.donorOrganizationId !== user.organizationId) {
      throw new ForbiddenException('Anda tidak memiliki hak akses untuk menghapus laporan surplus ini');
    }

    // State Machine Guard: only REPORTED or ASSESSED can be deleted
    if (
      listing.currentLifecycleStatus !== ListingLifecycleStatus.REPORTED &&
      listing.currentLifecycleStatus !== ListingLifecycleStatus.ASSESSED
    ) {
      throw new BadRequestException(
        `Laporan surplus berstatus ${listing.currentLifecycleStatus} sudah terikat mitra atau logistik dan tidak dapat dihapus. Gunakan pembatalan rute/journey.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.surplusListing.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          tableName: 'surplus_listings',
          recordId: id,
          action: AuditAction.DELETE,
          actorUserId: user.id,
          previousState: {
            currentLifecycleStatus: listing.currentLifecycleStatus,
            foodName: listing.foodName,
          },
          newState: {
            isDeleted: true,
            deletedAt: updated.deletedAt,
          },
          reason: 'Penghapusan laporan surplus makanan via soft delete (Tombstone)',
        },
      });

      return {
        success: true,
        statusCode: 200,
        message: 'Laporan surplus berhasil dihapus.',
      };
    });
  }
}
