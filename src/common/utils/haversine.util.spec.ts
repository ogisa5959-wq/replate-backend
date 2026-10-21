import {
  calculateHaversineDistanceKm,
  safeCalculateHaversineDistanceKm,
  estimateTransitMinutes,
  calculateProximityScore,
} from './haversine.util';

describe('Haversine Geodesic Distance Utility', () => {
  it('should calculate accurate distance between two Jakarta coordinates', () => {
    // Grand Sahid Jaya (Sudirman) to Dapur Sosial Barokah (Matraman)
    const lat1 = -6.208763;
    const lon1 = 106.818573;
    const lat2 = -6.2088;
    const lon2 = 106.8456;

    const distance = calculateHaversineDistanceKm(lat1, lon1, lat2, lon2);
    expect(distance).toBeGreaterThan(2.5);
    expect(distance).toBeLessThan(3.5);
    expect(distance).toBeCloseTo(3.0, 1);
  });

  it('should return 0 when coordinates are identical', () => {
    const distance = calculateHaversineDistanceKm(-6.2, 106.8, -6.2, 106.8);
    expect(distance).toBe(0);
  });

  it('should throw error on NaN input in calculateHaversineDistanceKm', () => {
    expect(() => calculateHaversineDistanceKm(NaN, 106.8, -6.2, 106.8)).toThrow();
  });

  describe('safeCalculateHaversineDistanceKm', () => {
    it('should calculate distance safely without throwing for valid coordinates', () => {
      const distance = safeCalculateHaversineDistanceKm(-6.2, 106.8, -6.3, 106.9);
      expect(distance).not.toBeNull();
      expect(distance).toBeGreaterThan(10);
    });

    it('should return null if any coordinate is null or undefined', () => {
      expect(safeCalculateHaversineDistanceKm(null, 106.8, -6.2, 106.8)).toBeNull();
      expect(safeCalculateHaversineDistanceKm(-6.2, undefined, -6.2, 106.8)).toBeNull();
      expect(safeCalculateHaversineDistanceKm(-6.2, 106.8, null, 106.8)).toBeNull();
      expect(safeCalculateHaversineDistanceKm(-6.2, 106.8, -6.2, undefined)).toBeNull();
    });

    it('should return null for out-of-range coordinates', () => {
      expect(safeCalculateHaversineDistanceKm(95, 106.8, -6.2, 106.8)).toBeNull();
      expect(safeCalculateHaversineDistanceKm(-6.2, 200, -6.2, 106.8)).toBeNull();
    });
  });

  describe('estimateTransitMinutes', () => {
    it('should estimate transit time with 20 km/h baseline plus 5 min buffer', () => {
      // 10 km at 20 km/h = 30 mins + 5 min buffer = 35 mins
      expect(estimateTransitMinutes(10)).toBe(35);
      // 2 km = 6 mins + 5 min buffer = 11 mins
      expect(estimateTransitMinutes(2)).toBe(11);
    });

    it('should enforce minimum 10 minutes transit buffer', () => {
      expect(estimateTransitMinutes(0.5)).toBe(10);
    });

    it('should return fallback 15 mins for null or zero distance', () => {
      expect(estimateTransitMinutes(null)).toBe(15);
      expect(estimateTransitMinutes(0)).toBe(15);
    });
  });

  describe('calculateProximityScore', () => {
    it('should assign 100 for very close distance (<= 3 km)', () => {
      expect(calculateProximityScore(1.5)).toBe(100);
      expect(calculateProximityScore(3.0)).toBe(100);
    });

    it('should assign 85 for close distance (3.1 - 7.0 km)', () => {
      expect(calculateProximityScore(5.0)).toBe(85);
      expect(calculateProximityScore(7.0)).toBe(85);
    });

    it('should assign 65 for medium distance (7.1 - 15.0 km)', () => {
      expect(calculateProximityScore(12.0)).toBe(65);
    });

    it('should assign 40 for long distance (15.1 - 25.0 km)', () => {
      expect(calculateProximityScore(20.0)).toBe(40);
    });

    it('should assign 20 for extreme distance (> 25 km)', () => {
      expect(calculateProximityScore(35.0)).toBe(20);
    });

    it('should assign 70 for null distance', () => {
      expect(calculateProximityScore(null)).toBe(70);
    });
  });
});
