import { RecipientType, FoodCategory, RouteHierarchy } from '@prisma/client';
import { FoodSafetyResult } from './food-safety-gate.engine';
import {
  safeCalculateHaversineDistanceKm,
  estimateTransitMinutes,
  calculateProximityScore,
} from '../../common/utils/haversine.util';

export interface RecipientCandidate {
  id: string;
  name: string;
  organizationId: string;
  recipientType: RecipientType;
  acceptedFoodCategories: FoodCategory[];
  dailyMaxCapacityKg: number;
  availableCapacityKg: number;
  latitude: number;
  longitude: number;
}

export interface MatchingInput {
  foodCategory: FoodCategory;
  quantityKg: number;
  recommendedRoute: RouteHierarchy | 'PENDING_VERIFICATION';
  foodSafetyGate?: FoodSafetyResult | null;
  candidates: RecipientCandidate[];
  donorCoords?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
}

export interface MatchedRecipient {
  recipientId: string;
  organizationId: string;
  name: string;
  recipientType: RecipientType;
  matchScore: number;
  availableCapacityKg: number;
  isLockedForReview: boolean;
  canAssign: boolean;
  rationale: string[];
  distanceKm: number | null;
  estimatedTransitMinutes: number | null;
  destinationLatitude: number;
  destinationLongitude: number;
  supplierLatitude: number | null;
  supplierLongitude: number | null;
}

export class MatchingEngine {
  static match(input: MatchingInput, lang: 'id' | 'en' = 'id'): MatchedRecipient[] {
    const isId = lang === 'id';
    const fsg = input.foodSafetyGate;
    const isReject = fsg?.status === 'REJECT';
    const isReview = fsg?.status === 'REVIEW';

    const donorLat = input.donorCoords?.latitude ?? null;
    const donorLon = input.donorCoords?.longitude ?? null;

    // If REJECT: check alternative route
    if (isReject) {
      const altRoute = fsg.alternativeRouteRecommendation?.route;
      if (altRoute === RouteHierarchy.SAFE_DISPOSAL) {
        return []; // No recipients for dangerous waste
      }
      // Only COMPOST_FACILITY allowed
      const compostCandidates = input.candidates.filter(
        (c) => c.recipientType === RecipientType.COMPOST_FACILITY,
      );

      return compostCandidates.map((c) => {
        const distanceKm = safeCalculateHaversineDistanceKm(
          donorLat,
          donorLon,
          c.latitude,
          c.longitude,
        );
        const transitMinutes = distanceKm !== null ? estimateTransitMinutes(distanceKm) : null;

        const rationale: string[] = [
          isId
            ? 'Fasilitas daur ulang organik kompos berizin.'
            : 'Certified organic composting facility.',
        ];

        if (distanceKm !== null) {
          rationale.push(
            isId
              ? `Jarak ke fasilitas kompos: ${distanceKm} km (estimasi ~${transitMinutes} mnt)`
              : `Distance to compost facility: ${distanceKm} km (est. ~${transitMinutes} mins)`,
          );
        }

        return {
          recipientId: c.id,
          organizationId: c.organizationId,
          name: c.name,
          recipientType: c.recipientType,
          matchScore: 90,
          availableCapacityKg: c.availableCapacityKg,
          isLockedForReview: false,
          canAssign: true,
          rationale,
          distanceKm,
          estimatedTransitMinutes: transitMinutes,
          destinationLatitude: c.latitude,
          destinationLongitude: c.longitude,
          supplierLatitude: donorLat !== null ? Number(donorLat) : null,
          supplierLongitude: donorLon !== null ? Number(donorLon) : null,
        };
      });
    }

    // For human consumption routes (PASS or REVIEW):
    // Community kitchens, Food Banks, Orphanages
    const eligibleTypes: RecipientType[] = [
      RecipientType.COMMUNITY_KITCHEN,
      RecipientType.FOOD_BANK,
      RecipientType.ORPHANAGE,
    ];

    const humanCandidates = input.candidates.filter((c) =>
      eligibleTypes.includes(c.recipientType),
    );

    const scored = humanCandidates.map((c) => {
      // 1. Food Category compatibility (0-100)
      const acceptsCategory = c.acceptedFoodCategories.includes(input.foodCategory);
      const categoryScore = acceptsCategory ? 100 : 40;

      // 2. Capacity fit (0-100)
      let capacityScore = 80;
      if (c.availableCapacityKg >= input.quantityKg) {
        capacityScore = 95;
      } else if (c.availableCapacityKg >= input.quantityKg * 0.5) {
        capacityScore = 65;
      } else {
        capacityScore = 30;
      }

      // 3. Proximity / Distance Calculation
      const distanceKm = safeCalculateHaversineDistanceKm(
        donorLat,
        donorLon,
        c.latitude,
        c.longitude,
      );
      const transitMinutes = distanceKm !== null ? estimateTransitMinutes(distanceKm) : null;
      const proximityScore = calculateProximityScore(distanceKm);

      // Weighted score: 40% category + 35% capacity + 25% proximity (or 50/50 fallback if no donor coords)
      const rawScore = donorLat !== null && donorLon !== null
        ? Math.round(categoryScore * 0.40 + capacityScore * 0.35 + proximityScore * 0.25)
        : Math.round(categoryScore * 0.50 + capacityScore * 0.50);

      const isLocked = isReview || false;
      const canAssign = !isLocked && c.availableCapacityKg >= input.quantityKg;

      const rationale: string[] = [];
      if (acceptsCategory) {
        rationale.push(isId ? `Menerima kategori ${input.foodCategory}` : `Accepts category ${input.foodCategory}`);
      }
      if (c.availableCapacityKg >= input.quantityKg) {
        rationale.push(
          isId
            ? `Kapasitas sisa (${c.availableCapacityKg} kg) mencukupi kebutuhan (${input.quantityKg} kg)`
            : `Available capacity (${c.availableCapacityKg} kg) accommodates load (${input.quantityKg} kg)`,
        );
      } else {
        rationale.push(
          isId
            ? `Peringatan: Kapasitas sisa (${c.availableCapacityKg} kg) di bawah kuantitas surplus`
            : `Warning: Insufficient remaining capacity (${c.availableCapacityKg} kg)`,
        );
      }

      if (distanceKm !== null) {
        rationale.push(
          isId
            ? `Jarak ke mitra: ${distanceKm} km (estimasi penjemputan ~${transitMinutes} mnt)`
            : `Distance to partner: ${distanceKm} km (est. transit ~${transitMinutes} mins)`,
        );
      }

      if (isLocked) {
        rationale.push(
          isId
            ? 'TERKUNCI: Pemeriksaan Food Safety Gate berstatus REVIEW'
            : 'LOCKED: Food Safety Gate status is REVIEW',
        );
      }

      return {
        recipientId: c.id,
        organizationId: c.organizationId,
        name: c.name,
        recipientType: c.recipientType,
        matchScore: rawScore,
        availableCapacityKg: c.availableCapacityKg,
        isLockedForReview: isLocked,
        canAssign,
        rationale,
        distanceKm,
        estimatedTransitMinutes: transitMinutes,
        destinationLatitude: c.latitude,
        destinationLongitude: c.longitude,
        supplierLatitude: donorLat !== null ? Number(donorLat) : null,
        supplierLongitude: donorLon !== null ? Number(donorLon) : null,
      };
    });

    // Sort by matchScore descending; if tied, prioritize nearest distance
    return scored.sort((a, b) => {
      if (b.matchScore !== a.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });
  }
}
