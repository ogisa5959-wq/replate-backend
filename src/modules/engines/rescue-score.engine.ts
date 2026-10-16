export interface RescueScoreInput {
  foodTypeId?: string;
  category?: string;
  quantity: number;
  unit?: 'kg' | 'portions';
  conditionId?: string;
  timeWindowId?: string;
}

export interface ScoreBreakdownItem {
  score: number;
  weight: number;
  contribution: number;
  label: string;
}

export interface RescueScoreResult {
  score: number;
  priority: string;
  breakdown: {
    condition: ScoreBreakdownItem;
    urgency: ScoreBreakdownItem;
    quantity: ScoreBreakdownItem;
    distributionEase: ScoreBreakdownItem;
    destinationCompatibility: ScoreBreakdownItem;
  };
  rationale: string[];
  timestamp: string;
}

export class RescueScoreEngine {
  static readonly WEIGHTS = {
    condition: 0.30,
    urgency: 0.25,
    quantity: 0.15,
    distributionEase: 0.15,
    destinationCompatibility: 0.15,
  };

  static calculate(input: RescueScoreInput, lang: 'id' | 'en' = 'id'): RescueScoreResult {
    const isId = lang === 'id';

    // 1. Condition score (0-100)
    let conditionScore = 80;
    if (input.conditionId === 'fresh_excellent' || input.conditionId === 'FRESH') {
      conditionScore = 100;
    } else if (input.conditionId === 'suitable' || input.conditionId === 'SLIGHTLY_WILTED') {
      conditionScore = 85;
    } else if (input.conditionId === 'near_window' || input.conditionId === 'NEAR_EXPIRY') {
      conditionScore = 65;
    } else if (input.conditionId === 'not_suitable' || input.conditionId === 'SPOILED') {
      conditionScore = 10;
    }

    // 2. Urgency score (0-100)
    let urgencyScore = 75;
    if (input.timeWindowId === 'under_1h') {
      urgencyScore = 98;
    } else if (input.timeWindowId === '1_3h') {
      urgencyScore = 88;
    } else if (input.timeWindowId === '3_6h') {
      urgencyScore = 70;
    } else if (input.timeWindowId === 'today') {
      urgencyScore = 55;
    }

    // 3. Quantity score (0-100)
    const qtyInKg = input.unit === 'portions'
      ? Math.max(0.5, input.quantity * 0.35)
      : Math.max(0.1, Number(input.quantity) || 1);

    let quantityScore = 80;
    if (qtyInKg < 2) {
      quantityScore = 75;
    } else if (qtyInKg >= 2 && qtyInKg <= 15) {
      quantityScore = 95; // Sweet spot
    } else if (qtyInKg > 15 && qtyInKg <= 40) {
      quantityScore = 90;
    } else if (qtyInKg > 40 && qtyInKg <= 100) {
      quantityScore = 82;
    } else {
      quantityScore = 70;
    }

    // 4. Distribution ease score (0-100)
    let distributionEaseScore = 80;
    const cat = input.category || (
      input.foodTypeId?.includes('dry') ? 'packaged' :
      input.foodTypeId?.includes('veg') ? 'produce' :
      input.foodTypeId?.includes('bakery') ? 'bakery' : 'prepared'
    );
    if (cat === 'packaged' || cat === 'bakery') {
      distributionEaseScore = 95;
    } else if (cat === 'prepared') {
      distributionEaseScore = 75;
    } else if (cat === 'produce') {
      distributionEaseScore = 85;
    }

    // 5. Destination compatibility factor (0-100)
    const destinationFitScore = 90; // Default compatibility with community kitchens

    // Weighted sum
    const rawScore =
      conditionScore * this.WEIGHTS.condition +
      urgencyScore * this.WEIGHTS.urgency +
      quantityScore * this.WEIGHTS.quantity +
      distributionEaseScore * this.WEIGHTS.distributionEase +
      destinationFitScore * this.WEIGHTS.destinationCompatibility;

    const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

    let priority = isId ? 'Prioritas Rendah' : 'Low Priority';
    if (finalScore >= 80) {
      priority = isId ? 'Prioritas Tinggi (Segera)' : 'High Priority (Urgent)';
    } else if (finalScore >= 55) {
      priority = isId ? 'Prioritas Menengah' : 'Medium Priority';
    }

    const rationale: string[] = [];
    if (conditionScore >= 85) {
      rationale.push(isId ? 'Kondisi pangan sangat baik untuk konsumsi langsung.' : 'Food condition optimal for direct consumption.');
    }
    if (urgencyScore >= 80) {
      rationale.push(isId ? 'Sisa jendela waktu aman memerlukan penjemputan segera.' : 'Safe time window warrants prompt logistics pickup.');
    }
    if (quantityScore >= 85) {
      rationale.push(isId ? 'Kuantitas ideal untuk alokasi porsi harian dapur sosial.' : 'Ideal quantity volume for community kitchen distribution.');
    }

    return {
      score: finalScore,
      priority,
      breakdown: {
        condition: {
          score: conditionScore,
          weight: this.WEIGHTS.condition,
          contribution: Math.round(conditionScore * this.WEIGHTS.condition * 10) / 10,
          label: isId ? 'Kondisi Makanan' : 'Condition Integrity',
        },
        urgency: {
          score: urgencyScore,
          weight: this.WEIGHTS.urgency,
          contribution: Math.round(urgencyScore * this.WEIGHTS.urgency * 10) / 10,
          label: isId ? 'Urgensi Waktu' : 'Rescue Urgency',
        },
        quantity: {
          score: quantityScore,
          weight: this.WEIGHTS.quantity,
          contribution: Math.round(quantityScore * this.WEIGHTS.quantity * 10) / 10,
          label: isId ? 'Kelayakan Volume' : 'Volume Viability',
        },
        distributionEase: {
          score: distributionEaseScore,
          weight: this.WEIGHTS.distributionEase,
          contribution: Math.round(distributionEaseScore * this.WEIGHTS.distributionEase * 10) / 10,
          label: isId ? 'Kemudahan Distribusi' : 'Distribution Ease',
        },
        destinationCompatibility: {
          score: destinationFitScore,
          weight: this.WEIGHTS.destinationCompatibility,
          contribution: Math.round(destinationFitScore * this.WEIGHTS.destinationCompatibility * 10) / 10,
          label: isId ? 'Kecocokan Tujuan' : 'Destination Compatibility',
        },
      },
      rationale,
      timestamp: new Date().toISOString(),
    };
  }
}
