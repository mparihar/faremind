import type { AiTag } from './types';

export interface OverrideInput {
  price:              number;
  durationMinutes:    number;
  stops:              number;
  score:              number;
  budget?:            number | null;
  avgDurationMinutes: number;
  minPrice:           number;
}

export interface OverrideResult {
  tag?:       AiTag;
  scoreBonus: number; // additive bonus on 0-100 scale (can be negative)
}

export function applyOverride(input: OverrideInput): OverrideResult {
  const { price, durationMinutes, stops, budget, avgDurationMinutes, minPrice } = input;

  // Smart Value: within budget (+10%) AND meaningfully faster than average
  if (budget && price <= budget * 1.1 && durationMinutes < avgDurationMinutes * 0.7) {
    return { tag: 'Smart Value', scoreBonus: 5 };
  }

  // Fast & Reasonable: faster than 75% of avg, price within 30% of cheapest
  if (durationMinutes < avgDurationMinutes * 0.75 && price <= minPrice * 1.3) {
    return { tag: 'Fast & Reasonable', scoreBonus: 3 };
  }

  // Avoid: 2+ stops AND not meaningfully cheaper than cheapest
  if (stops >= 2 && price > minPrice * 1.05) {
    return { tag: 'Avoid', scoreBonus: -10 };
  }

  return { scoreBonus: 0 };
}
