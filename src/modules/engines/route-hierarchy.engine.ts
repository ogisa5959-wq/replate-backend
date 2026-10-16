import { RouteHierarchy } from '@prisma/client';
import { FoodSafetyResult } from './food-safety-gate.engine';

export interface RouteDeterminationInput {
  foodTypeId?: string;
  conditionId?: string;
  timeWindowId?: string;
  foodSafetyGate?: FoodSafetyResult | null;
}

export interface RouteResult {
  route: RouteHierarchy | 'PENDING_VERIFICATION';
  title: string;
  description: string;
  why: string[];
  safetyNotice: string;
}

export class RouteHierarchyEngine {
  static determine(input: RouteDeterminationInput, lang: 'id' | 'en' = 'id'): RouteResult {
    const isId = lang === 'id';
    const fsg = input.foodSafetyGate;

    // GATE BOUNDARY 1: REJECT -> Blocks REDISTRIBUTE & PROCESS
    if (fsg && fsg.status === 'REJECT') {
      const altRoute = fsg.alternativeRouteRecommendation?.route || RouteHierarchy.ORGANIC;
      const isSafeDisposal = altRoute === RouteHierarchy.SAFE_DISPOSAL;

      if (isSafeDisposal) {
        return {
          route: RouteHierarchy.SAFE_DISPOSAL,
          title: isId ? 'Pembuangan Terkendali Khusus' : 'Controlled Safe Disposal',
          description: isId
            ? 'Bahan pangan mengalami kontaminasi fisik, kimia, atau patogen berbahaya. Tidak boleh untuk konsumsi maupun kompos.'
            : 'Physical or chemical contamination detected. Prohibited for human consumption or composting.',
          why: [
            isId
              ? 'DITOLAK OLEH FOOD SAFETY GATE: Makanan melanggar kriteria keamanan pangan dasar.'
              : 'REJECTED BY FOOD SAFETY GATE: Fails baseline safety criteria.',
            ...(fsg.reasons || []),
          ],
          safetyNotice: isId
            ? 'DILARANG UNTUK KONSUMSI MANUSIA & KOMPOS TERBUKA. Buang secara aman melalui pembuangan sampah berlabel.'
            : 'PROHIBITED FROM HUMAN CONSUMPTION & OPEN COMPOST.',
        };
      }

      return {
        route: RouteHierarchy.ORGANIC,
        title: isId ? 'Daur Ulang Kompos & Bio-Energi' : 'Organic Recovery (Compost)',
        description: isId
          ? 'Diperuntukkan bagi sisa makanan yang tidak lagi layak dikonsumsi manusia untuk mencegah timbulan metana di TPA.'
          : 'Diverted to organic composting or bio-energy.',
        why: [
          isId
            ? 'DITOLAK OLEH FOOD SAFETY GATE: Makanan tidak layak dikonsumsi manusia.'
            : 'REJECTED BY FOOD SAFETY GATE: Unfit for human consumption.',
          ...(fsg.reasons || []),
        ],
        safetyNotice: isId
          ? 'BAHAN DITANDAI KHUSUS PEMULIHAN BIOLOGIS/KOMPOS. Dilarang keras disalurkan sebagai makanan konsumsi manusia!'
          : 'RESTRICTED TO ORGANIC RECOVERY. Prohibited for human food!',
      };
    }

    // GATE BOUNDARY 2: REVIEW -> Holds consumption routing
    if (fsg && fsg.status === 'REVIEW') {
      return {
        route: 'PENDING_VERIFICATION',
        title: isId ? 'Rute Ditahan (Verifikasi Diperlukan)' : 'Route Held (Pending Verification)',
        description: isId
          ? 'Rekomendasi penyaluran konsumsi ditahan sementara hingga pemeriksaan keamanan pangan selesai.'
          : 'Human consumption routing held until critical safety parameters are verified.',
        why: [
          isId
            ? 'STATUS FOOD SAFETY GATE: REVIEW (Pemeriksaan Lanjutan Diperlukan).'
            : 'FOOD SAFETY GATE: REVIEW (Further Inspection Required).',
          ...(fsg.reasons || []),
        ],
        safetyNotice: isId
          ? 'Pemeriksaan keamanan pangan belum lengkap. Lengkapi data atau lakukan verifikasi fisik sebelum membuka rute konsumsi.'
          : 'Safety check incomplete. Complete verification to unlock consumption route.',
      };
    }

    // Default PASS: REDISTRIBUTE (or PROCESS if slightly wilted or culinary transformation)
    const condition = input.conditionId;
    if (condition === 'near_window' || condition === 'SLIGHTLY_WILTED') {
      return {
        route: RouteHierarchy.PROCESS,
        title: isId ? 'Pengolahan Kuliner Sekunder' : 'Secondary Culinary Processing',
        description: isId
          ? 'Transformasi kuliner menjadi sup, kaldu, atau makanan olahan yang dimasak kembali.'
          : 'Secondary culinary transformation into cooked meals or processed soup.',
        why: [isId ? 'Kondisi pangan layak dan aman untuk diolah kembali.' : 'Food safe for secondary cooking.'],
        safetyNotice: isId ? 'Pangan aman dan siap diolah di dapur sosial.' : 'Food safe for kitchen processing.',
      };
    }

    return {
      route: RouteHierarchy.REDISTRIBUTE,
      title: isId ? 'Distribusi Langsung' : 'Direct Redistribution',
      description: isId
        ? 'Surplus pangan bernutrisi langsung disalurkan ke program santap komunitas.'
        : 'Direct distribution to community kitchens and beneficiaries.',
      why: [isId ? 'Lolos pemeriksaan Food Safety Gate dan kondisi prima.' : 'Passed safety gate in prime condition.'],
      safetyNotice: isId ? 'Pangan aman dan siap disalurkan.' : 'Food safe for immediate distribution.',
    };
  }
}
