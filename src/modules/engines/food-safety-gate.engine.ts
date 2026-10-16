import { FoodSafetyStatus, RouteHierarchy } from '@prisma/client';

export interface FoodSafetyInput {
  foodTypeId?: string;
  category?: string;
  safetyConditionId?: string;
  conditionId?: string;
  storageHistoryId?: string;
  storageTempId?: string;
  preparedAt?: string | Date;
  storageDurationHours?: number | string | null;
  expiryDate?: string | Date | null;
  timeWindowId?: string;
  packagingConditionId?: string;
  handlingIntegrityId?: string;
  sourceContextId?: string;
}

export interface FoodSafetyResult {
  status: FoodSafetyStatus;
  eligibleForConsumptionRecommendation: boolean;
  headline: string;
  summary: string;
  reasons: string[];
  missingInformation: string[];
  parametersChecked: Record<string, any>;
  alternativeRouteRecommendation: {
    route: RouteHierarchy;
    title: string;
    description: string;
    safeHandlingInstructions: string;
  } | null;
  citations: Array<{
    id: string;
    title: string;
    publisher: string;
    url: string;
  }>;
  evaluatedAt: string;
  ruleVersion: string;
}

export const OFFICIAL_SAFETY_SOURCES = [
  {
    id: 'who-food-safety',
    title: 'Food Safety Fact Sheet & 5 Keys to Safer Food',
    publisher: 'World Health Organization (WHO)',
    url: 'https://www.who.int/news-room/fact-sheets/detail/food-safety',
  },
  {
    id: 'who-summer-advice',
    title: 'Public Health Advice on Food Safety',
    publisher: 'World Health Organization (WHO)',
    url: 'https://www.who.int/news-room/fact-sheets/item/public-health-advice-on-food-safety-during-summer',
  },
  {
    id: 'kemenkes-jasaboga',
    title: 'Pedoman Higiene Sanitasi Pangan Siap Saji',
    publisher: 'Kementerian Kesehatan Republik Indonesia',
    url: 'https://kemkes.go.id/',
  },
  {
    id: 'bpom-pjas-klik',
    title: 'Prinsip Keamanan Pangan & Pedoman Cek KLIK',
    publisher: 'Badan Pengawas Obat dan Makanan (BPOM RI)',
    url: 'https://www.pom.go.id/berita/keamanan-pangan-jajanan-anak-sekolah-%28pjas%29',
  },
];

export class FoodSafetyGateEngine {
  static readonly RULE_VERSION = '1.0';

  static evaluate(input: FoodSafetyInput, lang: 'id' | 'en' = 'id'): FoodSafetyResult {
    const isId = lang === 'id';
    const category = input.category || (
      input.foodTypeId?.includes('dry') || input.foodTypeId === 'packaged-dry-goods' ? 'packaged' :
      input.foodTypeId?.includes('veg') || input.foodTypeId === 'fresh-vegetables' ? 'produce' :
      input.foodTypeId?.includes('dairy') ? 'dairy' :
      input.foodTypeId?.includes('meat') ? 'meat_fish' : 'prepared'
    );

    // Resolved values (mapping legacy condition if safety parameters not yet explicitly set)
    const resolvedCondition = input.safetyConditionId || (
      input.conditionId === 'fresh_excellent' || input.conditionId === 'FRESH' ? 'no_visible_damage' :
      input.conditionId === 'suitable' || input.conditionId === 'SLIGHTLY_WILTED' ? 'no_visible_damage' :
      input.conditionId === 'near_window' || input.conditionId === 'NEAR_EXPIRY' ? 'altered_needs_check' :
      input.conditionId === 'not_suitable' || input.conditionId === 'SPOILED' ? 'clear_spoilage' : 'not_checked'
    );

    const resolvedStorage = input.storageHistoryId || 'known_compliant';
    const resolvedPackaging = input.packagingConditionId || (
      category === 'produce' ? 'not_applicable_fresh' : 'intact_proper'
    );
    const resolvedHandling = input.handlingIntegrityId || 'hygienic_separated';
    const resolvedTemp = input.storageTempId || (
      category === 'prepared' || category === 'meat_fish' ? 'hot_holding_above_60' :
      category === 'dairy' ? 'cold_holding_below_4' : 'ambient_room_temp'
    );

    const rejectReasons: string[] = [];
    const reviewReasons: string[] = [];
    const missingInformation: string[] = [];
    const checkedParameters: Record<string, any> = {};

    // 1. Food Type Context
    checkedParameters.foodType = {
      id: input.foodTypeId,
      category,
      status: 'pass',
      note: isId
        ? `Kategori ${category.toUpperCase()}: parameter evaluasi disesuaikan spesifik.`
        : `Category ${category.toUpperCase()}: category-specific safety checks applied.`,
    };

    // 2. Timing & Dates Pre-Check
    let timingStatus: 'pass' | 'review' | 'reject' = 'pass';
    const now = new Date();

    if (input.expiryDate) {
      const exp = new Date(input.expiryDate);
      exp.setHours(23, 59, 59, 999);
      if (exp.getTime() < now.getTime()) {
        rejectReasons.push(
          isId
            ? `Produk telah melewati batas tanggal kedaluwarsa (${input.expiryDate}). Melanggar prinsip BPOM Cek KLIK & tidak boleh disalurkan untuk konsumsi.`
            : `Product has passed its expiration / use-by date (${input.expiryDate}). Prohibited from human consumption.`,
        );
        timingStatus = 'reject';
      }
    }

    if (input.preparedAt) {
      const prep = new Date(input.preparedAt);
      // 15-minute future tolerance buffer
      const futureTolerance = new Date(now.getTime() + 15 * 60 * 1000);
      if (prep.getTime() > futureTolerance.getTime()) {
        reviewReasons.push(
          isId
            ? 'Waktu penyiapan yang dimasukkan berada di masa depan (tidak logis). Periksa kembali tanggal & jam penyiapan.'
            : 'Preparation timestamp is set in the future (illogical). Please verify prep date and time.',
        );
        missingInformation.push(isId ? 'Koreksi tanggal/jam penyiapan' : 'Correct preparation datetime');
        if (timingStatus !== 'reject') timingStatus = 'review';
      }
    }

    if (input.storageDurationHours !== null && input.storageDurationHours !== undefined && input.storageDurationHours !== '') {
      const dur = Number(input.storageDurationHours);
      if (isNaN(dur) || dur < 0) {
        reviewReasons.push(
          isId
            ? 'Lama penyimpanan tidak valid (angka negatif). Masukkan durasi jam yang benar.'
            : 'Invalid storage duration (negative number). Enter valid hours.',
        );
        missingInformation.push(isId ? 'Durasi penyimpanan valid' : 'Valid storage duration');
        if (timingStatus !== 'reject') timingStatus = 'review';
      } else {
        if ((category === 'prepared' || category === 'meat_fish') && resolvedTemp === 'uncontrolled_fluctuating' && dur > 4) {
          rejectReasons.push(
            isId
              ? `Makanan matang/daging telah berada di suhu ruang selama ${dur} jam (>4 jam batas aman Kemenkes/WHO). Risiko proliferasi toksin bakteri tinggi.`
              : `Cooked food/meat held at ambient danger zone for ${dur} hours (>4-hour WHO/Kemenkes threshold). High bacterial risk.`,
          );
          timingStatus = 'reject';
        }
      }
    }

    if (input.timeWindowId === 'under_1h' && resolvedCondition === 'altered_needs_check') {
      reviewReasons.push(
        isId
          ? 'Sisa waktu aman kurang dari 1 jam dengan kondisi makanan memerlukan pemeriksaan. Verifikasi fisik diperlukan segera sebelum pengiriman.'
          : 'Safe window under 1 hour with altered food condition. On-site physical check required before dispatch.',
      );
      if (timingStatus !== 'reject') timingStatus = 'review';
    }

    checkedParameters.timing = {
      preparedAt: input.preparedAt,
      storageDurationHours: input.storageDurationHours,
      expiryDate: input.expiryDate,
      timeWindowId: input.timeWindowId,
      status: timingStatus,
    };

    // 3. Condition Parameter
    let conditionStatus: 'pass' | 'review' | 'reject' = 'pass';
    if (resolvedCondition === 'clear_spoilage' || resolvedCondition === 'SPOILED') {
      rejectReasons.push(
        isId
          ? 'Ditemukan tanda kerusakan atau pembusukan yang jelas (lendir, bau tidak sedap, jamur, atau perubahan tekstur abnormal). Dilarang untuk konsumsi manusia (Ref: BPOM & WHO).'
          : 'Clear signs of spoilage or decay detected. Human consumption prohibited (Ref: BPOM & WHO).',
      );
      conditionStatus = 'reject';
    } else if (resolvedCondition === 'altered_needs_check' || resolvedCondition === 'NEAR_EXPIRY') {
      reviewReasons.push(
        isId
          ? 'Kondisi makanan mengalami perubahan fisik yang memerlukan pemeriksaan sensoris lanjutan oleh staf dapur sebelum dapat direkomendasikan.'
          : 'Food condition shows physical alteration requiring secondary sensory inspection by kitchen staff before recommendation.',
      );
      missingInformation.push(isId ? 'Konfirmasi hasil pemeriksaan sensoris' : 'Secondary sensory inspection confirmation');
      conditionStatus = 'review';
    } else if (resolvedCondition === 'not_checked') {
      reviewReasons.push(
        isId
          ? 'Kondisi fisik makanan belum diperiksa secara visual. Pemeriksaan fisik wajib dilakukan untuk memastikan kelayakan konsumsi.'
          : 'Food physical condition has not been visually inspected. Physical verification is required before recommendation.',
      );
      missingInformation.push(isId ? 'Pemeriksaan visual fisik makanan' : 'Visual physical inspection');
      conditionStatus = 'review';
    }

    checkedParameters.condition = {
      value: resolvedCondition,
      status: conditionStatus,
    };

    // 4. Storage History & Temp Parameter
    let storageStatus: 'pass' | 'review' | 'reject' = 'pass';
    if (resolvedStorage === 'suspected_non_compliant') {
      rejectReasons.push(
        isId
          ? 'Riwayat penyimpanan diduga tidak sesuai persyaratan keamanan pangan (terpapar bahaya suhu atau rantai dingin terputus). Risiko mikrobiologis tidak dapat ditoleransi (Ref: WHO).'
          : 'Suspected improper holding storage (thermal abuse or broken cold chain). Microbial safety compromised (Ref: WHO).',
      );
      storageStatus = 'reject';
    } else if (resolvedStorage === 'unknown') {
      reviewReasons.push(
        isId
          ? 'Riwayat suhu dan cara penyimpanan makanan tidak diketahui. Makanan sensitif suhu tidak boleh dianggap aman tanpa kepastian riwayat penyimpanan.'
          : 'Storage temperature history is unknown. Perishable items cannot be presumed safe without verified holding history.',
      );
      missingInformation.push(isId ? 'Informasi riwayat suhu penyimpanan' : 'Storage holding temperature records');
      storageStatus = 'review';
    } else if (resolvedStorage === 'not_checked') {
      reviewReasons.push(
        isId
          ? 'Status penyimpanan belum diperiksa. Perlu memastikan metode penyimpanan yang telah diterapkan.'
          : 'Storage status unchecked. Storage holding verification required.',
      );
      missingInformation.push(isId ? 'Verifikasi riwayat penyimpanan' : 'Storage history verification');
      storageStatus = 'review';
    }

    if (category === 'prepared' || category === 'meat_fish') {
      if (resolvedTemp === 'uncontrolled_fluctuating' && storageStatus !== 'reject') {
        reviewReasons.push(
          isId
            ? 'Makanan matang / daging disimpan pada suhu yang tidak terkontrol (Danger Zone 5°C–60°C). Diperlukan konfirmasi batas waktu penyimpanan.'
            : 'Prepared meal / meat held at uncontrolled temperature (Danger Zone 5°C–60°C). Holding duration verification required.',
        );
        if (storageStatus === 'pass') storageStatus = 'review';
      } else if (resolvedTemp === 'unknown' && storageStatus === 'pass') {
        reviewReasons.push(
          isId
            ? 'Informasi suhu penyimpanan makanan matang / daging tidak diketahui. Wajib diketahui untuk mencegah pertumbuhan spora patogen.'
            : 'Storage holding temperature unknown for prepared food / meat. Required to prevent pathogen growth.',
        );
        storageStatus = 'review';
        missingInformation.push(isId ? 'Suhu penyimpanan aktual' : 'Actual storage temperature');
      }
    } else if (category === 'dairy') {
      if (resolvedTemp !== 'cold_holding_below_4' && storageStatus !== 'reject') {
        reviewReasons.push(
          isId
            ? 'Produk susu dan olahan dingin memerlukan rantai dingin konsisten (<4°C). Suhu saat ini perlu diverifikasi.'
            : 'Dairy and chilled items require continuous cold chain (<4°C). Current holding temperature requires verification.',
        );
        if (storageStatus === 'pass') storageStatus = 'review';
        missingInformation.push(isId ? 'Verifikasi rantai dingin susu (<4°C)' : 'Dairy cold chain verification (<4°C)');
      }
    }

    checkedParameters.storageHistory = {
      value: resolvedStorage,
      tempCondition: resolvedTemp,
      status: storageStatus,
    };

    // 5. Packaging Integrity
    let packagingStatus: 'pass' | 'review' | 'reject' = 'pass';
    if (resolvedPackaging === 'damaged_leaking_contaminated' || resolvedPackaging === 'DAMAGED') {
      rejectReasons.push(
        isId
          ? 'Wadah atau kemasan rusak, bocor, kaleng kembung/penyok parah, atau terpapar cemaran langsung. Bahaya kontaminasi bakteri/kimia (Ref: BPOM Cek KLIK).'
          : 'Packaging damaged, leaking, swollen/dented can, or directly contaminated. Bacterial/chemical hazard (Ref: BPOM Cek KLIK).',
      );
      packagingStatus = 'reject';
    } else if (resolvedPackaging === 'not_checked') {
      reviewReasons.push(
        isId
          ? 'Integritas kemasan atau wadah makanan belum diperiksa.'
          : 'Packaging or container integrity has not been inspected.',
      );
      missingInformation.push(isId ? 'Pemeriksaan integritas wadah/kemasan' : 'Container/packaging inspection');
      packagingStatus = 'review';
    }

    checkedParameters.packaging = {
      value: resolvedPackaging,
      status: packagingStatus,
    };

    // 6. Handling Integrity
    let handlingStatus: 'pass' | 'review' | 'reject' = 'pass';
    if (resolvedHandling === 'potential_cross_contamination') {
      reviewReasons.push(
        isId
          ? 'Terdapat potensi kontaminasi silang (misal kontak alat dengan bahan mentah atau penjamah makanan belum terverifikasi). Memerlukan inspeksi ulang sebelum konsumsi (Ref: Kemenkes & WHO).'
          : 'Potential cross-contamination identified. Secondary check required (Ref: Kemenkes & WHO).',
      );
      missingInformation.push(isId ? 'Verifikasi pemisahan dari bahan mentah' : 'Raw/cooked separation verification');
      handlingStatus = 'review';
    } else if (resolvedHandling === 'unknown') {
      reviewReasons.push(
        isId
          ? 'Riwayat kebersihan penanganan makanan tidak diketahui. Informasi tidak diketahui tidak boleh diperlakukan otomatis sebagai aman.'
          : 'Food handling history is undocumented. Unknown handling cannot be assumed safe.',
      );
      missingInformation.push(isId ? 'Informasi penanganan pangan' : 'Food handling information');
      handlingStatus = 'review';
    }

    checkedParameters.handlingSource = {
      value: resolvedHandling,
      status: handlingStatus,
    };

    // Synthesis: REJECT > REVIEW > PASS
    let finalStatus: FoodSafetyStatus = FoodSafetyStatus.PASS;
    let eligibleForConsumption = true;
    let headline = '';
    let summary = '';

    if (rejectReasons.length > 0) {
      finalStatus = FoodSafetyStatus.REJECT;
      eligibleForConsumption = false;
      headline = isId
        ? 'TIDAK LAYAK UNTUK DIREKOMENDASIKAN KONSUMSI MANUSIA'
        : 'NOT ELIGIBLE FOR HUMAN CONSUMPTION RECOMMENDATION';
      summary = isId
        ? 'Berdasarkan parameter yang dilaporkan, makanan ini melanggar kriteria keamanan pangan dasar dan berisiko membahayakan kesehatan penerima manfaat. Makanan TIDAK BOLEH disalurkan untuk konsumsi manusia.'
        : 'Based on reported parameters, this surplus breaches essential food safety criteria. Food MUST NOT be distributed for human consumption.';
    } else if (reviewReasons.length > 0 || missingInformation.length > 0) {
      finalStatus = FoodSafetyStatus.REVIEW;
      eligibleForConsumption = false;
      headline = isId
        ? 'MEMERLUKAN PEMERIKSAAN & VERIFIKASI LANJUTAN'
        : 'FURTHER SAFETY VERIFICATION REQUIRED';
      summary = isId
        ? 'Rekomendasi penyaluran untuk konsumsi DITAHAN sementara karena terdapat informasi penting yang belum lengkap atau membutuhkan verifikasi langsung di lokasi.'
        : 'Human consumption recommendations are HELD PENDING verification because critical safety data is missing or requires on-site inspection.';
    } else {
      finalStatus = FoodSafetyStatus.PASS;
      eligibleForConsumption = true;
      headline = isId
        ? 'LOLOS PEMERIKSAAN AWAL KEAMANAN PANGAN'
        : 'PASSED INITIAL FOOD SAFETY SCREENING';
      summary = isId
        ? 'Berdasarkan informasi yang dimasukkan pengguna, tidak ditemukan indikator bahaya yang melanggar aturan keamanan pangan dasar. Makanan memenuhi syarat untuk dilanjutkan ke penilaian prioritas Rescue Score.'
        : 'Based on user-provided information, no violation indicators were detected. Eligible to proceed to Rescue Score prioritization.';
    }

    // Alternative Route Recommendation (for REJECT)
    let alternativeRouteRecommendation: FoodSafetyResult['alternativeRouteRecommendation'] = null;

    if (finalStatus === FoodSafetyStatus.REJECT) {
      const hasChemicalOrPackagingHazard = (resolvedPackaging === 'damaged_leaking_contaminated' || resolvedPackaging === 'DAMAGED') && (
        category === 'packaged'
      );

      if (hasChemicalOrPackagingHazard) {
        alternativeRouteRecommendation = {
          route: RouteHierarchy.SAFE_DISPOSAL,
          title: isId ? 'Pembuangan Terkendali Khusus (Bukan Kompos)' : 'Safe Controlled Disposal (Not for Compost)',
          description: isId
            ? 'Kemasan berisiko toksin bakteri anaerobik (botulisme) atau pecahan kaleng/kemasan. Jangan dimasukkan ke dalam pakan ternak atau tumpukan kompos terbuka.'
            : 'High anaerobic toxin or packaging hazard. Do not mix into open composting or animal feed.',
          safeHandlingInstructions: isId
            ? 'Kemas ganda dalam kantong limbah tertutup rapat, beri label limbah non-konsumsi, dan buang melalui pengolahan limbah kota yang aman.'
            : 'Double-bag in heavy-duty sealed waste liner, label as non-consumable waste, and dispose via municipal sanitation.',
        };
      } else {
        alternativeRouteRecommendation = {
          route: RouteHierarchy.ORGANIC,
          title: isId ? 'Pengalihan Biologis: Daur Ulang Kompos / Bio-Energi' : 'Organic Recovery: Aerobic Composting / Bio-Energy',
          description: isId
            ? 'Bahan organik nabati atau sisa makanan yang rusak secara biologis masih dapat dialihkan ke fasilitas pengomposan industri guna mencegah timbulan gas metana.'
            : 'Biologically spoiled organic matter can be diverted to industrial composting or anaerobic digestion.',
          safeHandlingInstructions: isId
            ? 'Pisahkan dari kemasan plastik/anorganik. Kirim hanya ke fasilitas kompos berizin. DILARANG KERAS dijadikan pakan ternak tanpa perlakuan termal resmi.'
            : 'Separate strictly from plastics/inorganics. Send only to certified composting facilities.',
        };
      }
    }

    return {
      status: finalStatus,
      eligibleForConsumptionRecommendation: eligibleForConsumption,
      headline,
      summary,
      reasons: finalStatus === FoodSafetyStatus.REJECT ? rejectReasons : reviewReasons,
      missingInformation,
      parametersChecked: checkedParameters,
      alternativeRouteRecommendation,
      citations: OFFICIAL_SAFETY_SOURCES,
      evaluatedAt: new Date().toISOString(),
      ruleVersion: FoodSafetyGateEngine.RULE_VERSION,
    };
  }
}
