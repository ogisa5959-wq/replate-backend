/**
 * Utilitas Perhitungan Jarak Geodetik Bola Bumi (Haversine Formula)
 * Digunakan untuk menghitung estimasi jarak antara dua pasang koordinat (lat, lon)
 * dalam satuan kilometer tanpa ketergantungan API eksternal (Google Maps, dll.).
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    Number.isNaN(lat1) ||
    Number.isNaN(lon1) ||
    Number.isNaN(lat2) ||
    Number.isNaN(lon2)
  ) {
    throw new Error('Koordinat tidak valid untuk perhitungan jarak Haversine');
  }

  const toRad = (degree: number) => (degree * Math.PI) / 180;
  const EARTH_RADIUS_KM = 6371; // Radius rata-rata bumi

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_KM * c;

  // Bulatkan ke 2 desimal presisi (contoh: 4.85 km)
  return Math.round(distance * 100) / 100;
}

/**
 * Versi aman dari calculateHaversineDistanceKm yang mengembalikan null
 * jika salah satu koordinat bernilai null, undefined, atau tidak valid,
 * tanpa melempar runtime exception.
 */
export function safeCalculateHaversineDistanceKm(
  lat1?: number | null,
  lon1?: number | null,
  lat2?: number | null,
  lon2?: number | null,
): number | null {
  if (
    lat1 === undefined || lat1 === null ||
    lon1 === undefined || lon1 === null ||
    lat2 === undefined || lat2 === null ||
    lon2 === undefined || lon2 === null
  ) {
    return null;
  }

  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (
    !Number.isFinite(nLat1) ||
    !Number.isFinite(nLon1) ||
    !Number.isFinite(nLat2) ||
    !Number.isFinite(nLon2)
  ) {
    return null;
  }

  if (nLat1 < -90 || nLat1 > 90 || nLat2 < -90 || nLat2 > 90) return null;
  if (nLon1 < -180 || nLon1 > 180 || nLon2 < -180 || nLon2 > 180) return null;

  try {
    return calculateHaversineDistanceKm(nLat1, nLon1, nLat2, nLon2);
  } catch {
    return null;
  }
}

/**
 * Estimasi durasi waktu transit logistik penjemputan dalam menit
 * berdasarkan jarak kilometer. Kecepatan rata-rata kurir urban 20 km/jam
 * ditambah buffer 5 menit serah terima awal (minimal 10 menit).
 */
export function estimateTransitMinutes(distanceKm: number | null): number {
  if (distanceKm === null || distanceKm === undefined || distanceKm <= 0) {
    return 15; // default fallback
  }

  const travelMinutes = (distanceKm / 20) * 60;
  return Math.max(10, Math.round(travelMinutes) + 5);
}

/**
 * Menghitung subskor kedekatan jarak (0 - 100 poin) untuk Matching Engine.
 * Surplus makanan sensitif suhu memerlukan penjemputan secepat mungkin.
 */
export function calculateProximityScore(distanceKm: number | null): number {
  if (distanceKm === null || distanceKm === undefined) {
    return 70; // Netral jika data koordinat tidak lengkap
  }

  if (distanceKm <= 3.0) return 100;
  if (distanceKm <= 7.0) return 85;
  if (distanceKm <= 15.0) return 65;
  if (distanceKm <= 25.0) return 40;
  return 20;
}
