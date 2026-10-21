import { FoodSafetyGateEngine } from './food-safety-gate.engine';
import { RouteHierarchyEngine } from './route-hierarchy.engine';
import { MatchingEngine, RecipientCandidate } from './matching.engine';
import { RescueScoreEngine } from './rescue-score.engine';
import { FoodSafetyStatus, RouteHierarchy, RecipientType, FoodCategory } from '@prisma/client';

describe('REPLATE Food Safety Gate & Route Engine (13 Mandatory Scenarios)', () => {
  const dummyCandidateKitchen: RecipientCandidate = {
    id: 'rec-001',
    name: 'Dapur Sosial Matraman',
    organizationId: 'org-001',
    recipientType: RecipientType.COMMUNITY_KITCHEN,
    acceptedFoodCategories: [FoodCategory.COOKED_MEALS],
    dailyMaxCapacityKg: 100,
    availableCapacityKg: 50,
    latitude: -6.2088,
    longitude: 106.8456,
  };

  const dummyCandidateCompost: RecipientCandidate = {
    id: 'rec-002',
    name: 'Fasilitas Kompos Rawasari',
    organizationId: 'org-002',
    recipientType: RecipientType.COMPOST_FACILITY,
    acceptedFoodCategories: [FoodCategory.COOKED_MEALS, FoodCategory.FRESH_PRODUCE],
    dailyMaxCapacityKg: 500,
    availableCapacityKg: 300,
    latitude: -6.195,
    longitude: 106.87,
  };

  // Scenario 1
  it('Scenario 1: All relevant info complete & compliant -> PASS', () => {
    const result = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'known_compliant',
      storageTempId: 'hot_holding_above_60',
      storageDurationHours: 1.5,
      packagingConditionId: 'intact_proper',
      handlingIntegrityId: 'hygienic_separated',
      timeWindowId: '1_3h',
    });

    expect(result.status).toBe(FoodSafetyStatus.PASS);
    expect(result.eligibleForConsumptionRecommendation).toBe(true);
    expect(result.reasons.length).toBe(0);
    expect(result.missingInformation.length).toBe(0);
  });

  // Scenario 2
  it('Scenario 2: Storage history unknown -> REVIEW', () => {
    const result = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'unknown',
      storageTempId: 'unknown',
      packagingConditionId: 'intact_proper',
      handlingIntegrityId: 'hygienic_separated',
    });

    expect(result.status).toBe(FoodSafetyStatus.REVIEW);
    expect(result.eligibleForConsumptionRecommendation).toBe(false);
    expect(result.reasons.some((r) => r.toLowerCase().includes('riwayat suhu') || r.toLowerCase().includes('penyimpanan'))).toBe(true);
    expect(result.missingInformation.length).toBeGreaterThan(0);
  });

  // Scenario 3
  it('Scenario 3: Storage time incomplete / altered condition -> REVIEW', () => {
    const result = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'altered_needs_check',
      storageHistoryId: 'known_compliant',
      packagingConditionId: 'intact_proper',
    });

    expect(result.status).toBe(FoodSafetyStatus.REVIEW);
    expect(result.eligibleForConsumptionRecommendation).toBe(false);
    expect(result.missingInformation.length).toBeGreaterThan(0);
  });

  // Scenario 4
  it('Scenario 4: Clear signs of spoilage reported -> REJECT', () => {
    const result = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'clear_spoilage',
      storageHistoryId: 'known_compliant',
      packagingConditionId: 'intact_proper',
    });

    expect(result.status).toBe(FoodSafetyStatus.REJECT);
    expect(result.eligibleForConsumptionRecommendation).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.alternativeRouteRecommendation).not.toBeNull();
  });

  // Scenario 5
  it('Scenario 5: Expired product -> REJECT; Future prep -> REVIEW (with clock-skew tolerance)', () => {
    // 5a. Expired date
    const expiredResult = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'packaged-dry-goods',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'known_compliant',
      expiryDate: '2020-01-01',
    });
    expect(expiredResult.status).toBe(FoodSafetyStatus.REJECT);
    expect(expiredResult.reasons.some((r) => r.toLowerCase().includes('kedaluwarsa'))).toBe(true);

    // 5b. Future prep date (> 15 minutes in future)
    const futurePrep = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const futureResult = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'known_compliant',
      preparedAt: futurePrep,
    });
    expect(futureResult.status).toBe(FoodSafetyStatus.REVIEW);
    expect(futureResult.reasons.some((r) => r.toLowerCase().includes('masa depan'))).toBe(true);
  });

  // Scenario 6
  it('Scenario 6: Data re-evaluation dynamically updates status', () => {
    const initialBad = {
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'clear_spoilage',
      storageHistoryId: 'known_compliant',
    };
    const result1 = FoodSafetyGateEngine.evaluate(initialBad);
    expect(result1.status).toBe(FoodSafetyStatus.REJECT);

    const corrected = {
      ...initialBad,
      safetyConditionId: 'no_visible_damage',
      storageTempId: 'hot_holding_above_60',
      packagingConditionId: 'intact_proper',
      handlingIntegrityId: 'hygienic_separated',
    };
    const result2 = FoodSafetyGateEngine.evaluate(corrected);
    expect(result2.status).toBe(FoodSafetyStatus.PASS);
  });

  // Scenario 7
  it('Scenario 7: REVIEW status blocks human consumption routing', () => {
    const gateReview = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'not_checked',
      storageHistoryId: 'unknown',
    });
    expect(gateReview.status).toBe(FoodSafetyStatus.REVIEW);

    const routeResult = RouteHierarchyEngine.determine({
      foodTypeId: 'cooked-rice',
      foodSafetyGate: gateReview,
    });

    expect(routeResult.route).toBe('PENDING_VERIFICATION');
    expect(routeResult.route).not.toBe(RouteHierarchy.REDISTRIBUTE);
    expect(routeResult.route).not.toBe(RouteHierarchy.PROCESS);

    const matches = MatchingEngine.match({
      foodCategory: FoodCategory.COOKED_MEALS,
      quantityKg: 10,
      recommendedRoute: routeResult.route,
      foodSafetyGate: gateReview,
      candidates: [dummyCandidateKitchen],
    });

    expect(matches.every((m) => m.isLockedForReview === true && m.canAssign === false)).toBe(true);
  });

  // Scenario 8
  it('Scenario 8: REJECT status strictly blocks human consumption routing', () => {
    const gateReject = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'clear_spoilage',
      storageHistoryId: 'suspected_non_compliant',
    });
    expect(gateReject.status).toBe(FoodSafetyStatus.REJECT);

    const routeResult = RouteHierarchyEngine.determine({
      foodTypeId: 'cooked-rice',
      foodSafetyGate: gateReject,
    });

    expect(routeResult.route).not.toBe(RouteHierarchy.REDISTRIBUTE);
    expect(routeResult.route).not.toBe(RouteHierarchy.PROCESS);
    expect(routeResult.route).toBe(RouteHierarchy.ORGANIC);

    const matches = MatchingEngine.match({
      foodCategory: FoodCategory.COOKED_MEALS,
      quantityKg: 10,
      recommendedRoute: routeResult.route,
      foodSafetyGate: gateReject,
      candidates: [dummyCandidateKitchen, dummyCandidateCompost],
    });

    // Kitchen must NOT appear in matches
    const kitchenMatch = matches.find((m) => m.recipientType === RecipientType.COMMUNITY_KITCHEN);
    expect(kitchenMatch).toBeUndefined();
    // Only compost facility appears
    expect(matches.length).toBe(1);
    expect(matches[0].recipientType).toBe(RecipientType.COMPOST_FACILITY);
  });

  // Scenario 9
  it('Scenario 9: PASS status receives valid Rescue Score and proper route', () => {
    const gatePass = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'cooked-rice',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'known_compliant',
      storageTempId: 'hot_holding_above_60',
      packagingConditionId: 'intact_proper',
      handlingIntegrityId: 'hygienic_separated',
      timeWindowId: '1_3h',
    });
    expect(gatePass.status).toBe(FoodSafetyStatus.PASS);

    const scoreResult = RescueScoreEngine.calculate({
      foodTypeId: 'cooked-rice',
      quantity: 8,
      unit: 'kg',
      conditionId: 'suitable',
      timeWindowId: '1_3h',
    });

    expect(scoreResult.score).toBeGreaterThanOrEqual(70);
    expect(scoreResult.score).toBeLessThanOrEqual(100);

    const routeResult = RouteHierarchyEngine.determine({
      foodTypeId: 'cooked-rice',
      conditionId: 'suitable',
      timeWindowId: '1_3h',
      foodSafetyGate: gatePass,
    });

    expect(routeResult.route).toBe(RouteHierarchy.REDISTRIBUTE);
  });

  // Scenario 10
  it('Scenario 10: High Rescue Score cannot override REVIEW or REJECT', () => {
    const spoiledReport = {
      foodTypeId: 'cooked-rice',
      quantity: 10,
      unit: 'kg' as const,
      conditionId: 'not_suitable',
      safetyConditionId: 'clear_spoilage',
      storageHistoryId: 'suspected_non_compliant',
      timeWindowId: 'under_1h',
    };

    const gateResult = FoodSafetyGateEngine.evaluate(spoiledReport);
    expect(gateResult.status).toBe(FoodSafetyStatus.REJECT);

    const routeResult = RouteHierarchyEngine.determine({
      ...spoiledReport,
      foodSafetyGate: gateResult,
    });

    expect(routeResult.route).not.toBe(RouteHierarchy.REDISTRIBUTE);
    expect(routeResult.route).not.toBe(RouteHierarchy.PROCESS);
    expect(routeResult.route).toBe(RouteHierarchy.ORGANIC);
  });

  // Scenario 11
  it('Scenario 11: Gate results persist consistently and serialize properly', () => {
    const result = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'fresh-vegetables',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'known_compliant',
      storageTempId: 'cold_holding_below_4',
      packagingConditionId: 'not_applicable_fresh',
      handlingIntegrityId: 'hygienic_separated',
    });

    const jsonStr = JSON.stringify(result);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.status).toBe(FoodSafetyStatus.PASS);
    expect(parsed.ruleVersion).toBe('1.0');
    expect(parsed.evaluatedAt).toBeDefined();
    expect(parsed.citations.length).toBeGreaterThanOrEqual(3);
  });

  // Scenario 12
  it('Scenario 12: Legacy data lacking safety parameters defaults conservatively to REVIEW', () => {
    const legacyReport = {
      foodTypeId: 'cooked-rice',
      quantity: 5,
      // no safetyConditionId, storageHistoryId, etc.
    };

    const evaluated = FoodSafetyGateEngine.evaluate({
      ...legacyReport,
      safetyConditionId: 'not_checked',
      storageHistoryId: 'not_checked',
    });

    expect(evaluated.status).toBe(FoodSafetyStatus.REVIEW);
    expect(evaluated.eligibleForConsumptionRecommendation).toBe(false);
  });

  // Scenario 13
  it('Scenario 13: Packaging hazard (damaged/dented can) maps to SAFE_DISPOSAL', () => {
    const result = FoodSafetyGateEngine.evaluate({
      foodTypeId: 'packaged-dry-goods',
      safetyConditionId: 'no_visible_damage',
      storageHistoryId: 'known_compliant',
      packagingConditionId: 'damaged_leaking_contaminated',
    });

    expect(result.status).toBe(FoodSafetyStatus.REJECT);
    expect(result.alternativeRouteRecommendation?.route).toBe(RouteHierarchy.SAFE_DISPOSAL);
    expect(result.reasons.some((r) => r.toLowerCase().includes('kemasan'))).toBe(true);
  });

  // Scenario 14: MatchingEngine Geodesic Distance Calculation
  it('Scenario 14: MatchingEngine calculates distanceKm and estimatedTransitMinutes when donorCoords provided', () => {
    const donorCoords = { latitude: -6.208763, longitude: 106.818573 }; // Grand Sahid Sudirman
    const matches = MatchingEngine.match({
      foodCategory: FoodCategory.COOKED_MEALS,
      quantityKg: 20,
      recommendedRoute: RouteHierarchy.REDISTRIBUTE,
      candidates: [dummyCandidateKitchen],
      donorCoords,
    });

    expect(matches.length).toBe(1);
    expect(matches[0].distanceKm).toBeDefined();
    expect(matches[0].distanceKm).not.toBeNull();
    expect(matches[0].distanceKm).toBeCloseTo(3.0, 1);
    expect(matches[0].estimatedTransitMinutes).toBeDefined();
    expect(matches[0].estimatedTransitMinutes).toBeGreaterThanOrEqual(10);
    expect(matches[0].supplierLatitude).toBe(-6.208763);
    expect(matches[0].destinationLatitude).toBe(dummyCandidateKitchen.latitude);
    expect(matches[0].rationale.some((r) => r.includes('Jarak ke mitra:'))).toBe(true);
  });

  // Scenario 15: Proximity Prioritization
  it('Scenario 15: MatchingEngine prioritizes closer recipient when capacity and category are identical', () => {
    const donorCoords = { latitude: -6.2088, longitude: 106.8456 }; // At Matraman

    const closeKitchen: RecipientCandidate = {
      id: 'rec-close',
      name: 'Dapur Tetangga Dekat (1 km)',
      organizationId: 'org-close',
      recipientType: RecipientType.COMMUNITY_KITCHEN,
      acceptedFoodCategories: [FoodCategory.COOKED_MEALS],
      dailyMaxCapacityKg: 100,
      availableCapacityKg: 50,
      latitude: -6.215,
      longitude: 106.848, // ~0.7 km away
    };

    const farKitchen: RecipientCandidate = {
      id: 'rec-far',
      name: 'Dapur Jauh (20 km)',
      organizationId: 'org-far',
      recipientType: RecipientType.COMMUNITY_KITCHEN,
      acceptedFoodCategories: [FoodCategory.COOKED_MEALS],
      dailyMaxCapacityKg: 100,
      availableCapacityKg: 50,
      latitude: -6.38,
      longitude: 106.83, // ~19 km away
    };

    const matches = MatchingEngine.match({
      foodCategory: FoodCategory.COOKED_MEALS,
      quantityKg: 20,
      recommendedRoute: RouteHierarchy.REDISTRIBUTE,
      candidates: [farKitchen, closeKitchen], // Far listed first in input
      donorCoords,
    });

    expect(matches.length).toBe(2);
    // Closer kitchen must rank first due to proximityScore
    expect(matches[0].recipientId).toBe('rec-close');
    expect(matches[1].recipientId).toBe('rec-far');
    expect(matches[0].matchScore).toBeGreaterThan(matches[1].matchScore);
    expect(matches[0].distanceKm!).toBeLessThan(matches[1].distanceKm!);
  });

  // Scenario 16: Safe Fallback without Donor Coordinates
  it('Scenario 16: MatchingEngine operates safely with null donorCoords using neutral distance fallback', () => {
    const matches = MatchingEngine.match({
      foodCategory: FoodCategory.COOKED_MEALS,
      quantityKg: 20,
      recommendedRoute: RouteHierarchy.REDISTRIBUTE,
      candidates: [dummyCandidateKitchen],
      donorCoords: null,
    });

    expect(matches.length).toBe(1);
    expect(matches[0].distanceKm).toBeNull();
    expect(matches[0].estimatedTransitMinutes).toBeNull();
    expect(matches[0].matchScore).toBeGreaterThan(0);
  });
});
