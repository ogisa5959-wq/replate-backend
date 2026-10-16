import { RecipientType, FoodCategory, RouteHierarchy } from '@prisma/client';
import { FoodSafetyResult } from './food-safety-gate.engine';

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
}

export class MatchingEngine {
  static match(input: MatchingInput, lang: 'id' | 'en' = 'id'): MatchedRecipient[] {
    const isId = lang === 'id';
    const fsg = input.foodSafetyGate;
    const isReject = fsg?.status === 'REJECT';
    const isReview = fsg?.status === 'REVIEW';

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

      return compostCandidates.map((c) => ({
        recipientId: c.id,
        organizationId: c.organizationId,
        name: c.name,
        recipientType: c.recipientType,
        matchScore: 90,
        availableCapacityKg: c.availableCapacityKg,
        isLockedForReview: false,
        canAssign: true,
        rationale: [
          isId
            ? 'Fasilitas daur ulang organik kompos berizin.'
            : 'Certified organic composting facility.',
        ],
      }));
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

      const rawScore = Math.round(categoryScore * 0.5 + capacityScore * 0.5);
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
      };
    });

    // Sort by matchScore descending
    return scored.sort((a, b) => b.matchScore - a.matchScore);
  }
}
