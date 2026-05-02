/**
 * AI Fare Scoring Service
 *
 * Mathematically normalized, explainable scoring model.
 * All scores are computed relative to the fare group for the same flight offer.
 * Deterministic and reproducible — no randomness.
 *
 * Weights:
 *   price       30%
 *   duration    15%  (same for all fares on same flight → 1.0)
 *   stops       10%  (same for all fares on same flight)
 *   baggage     10%
 *   refund      10%
 *   change      10%
 *   seat         5%
 *   layover      5%  (same for all fares on same flight)
 *   prediction   5%
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FareInput {
  id: string;
  totalPrice: number;
  checked: number;
  refundable: boolean;
  refundFeeUsd: number | null;
  changeable: boolean;
  changeFeeUsd: number | null;
  seatSelection: 'free' | 'fee' | 'not_available';
  cabin: string;
  name: string;
}

export interface FlightContext {
  durationMinutes: number;
  stops: number;
  layoverMinutes: number[];
}

export interface AiScoreBreakdown {
  priceScore: number;
  durationScore: number;
  stopsScore: number;
  baggageScore: number;
  refundScore: number;
  changeScore: number;
  seatScore: number;
  layoverScore: number;
  predictionScore: number;
  finalScore: number;
}

export type AiBadge = 'cheapest' | 'best_value' | 'most_flexible' | 'premium_upgrade' | 'ai_pick';

export interface ScoredFare {
  id: string;
  breakdown: AiScoreBreakdown;
  badges: AiBadge[];
  explanation: string;
}

// ─── Step 1: Normalize each feature ──────────────────────────────────────────

function normPrice(farePrice: number, minPrice: number, maxPrice: number): number {
  if (maxPrice === minPrice) return 1.0;
  return 1 - (farePrice - minPrice) / (maxPrice - minPrice);
}

function normDuration(dur: number, minDur: number, maxDur: number): number {
  if (maxDur === minDur) return 1.0;
  return 1 - (dur - minDur) / (maxDur - minDur);
}

function normStops(stops: number): number {
  return 1 / (1 + stops);
}

function normBaggage(checked: number): number {
  if (checked >= 2) return 1.0;
  if (checked === 1) return 0.7;
  return 0.3;
}

function normRefund(refundable: boolean, refundFeeUsd: number | null): number {
  if (!refundable) return 0.0;
  return refundFeeUsd === 0 ? 1.0 : 0.5;
}

function normChange(changeable: boolean, changeFeeUsd: number | null): number {
  if (!changeable) return 0.0;
  return changeFeeUsd === 0 ? 1.0 : 0.5;
}

function normSeat(seatSelection: 'free' | 'fee' | 'not_available'): number {
  if (seatSelection === 'free') return 1.0;
  if (seatSelection === 'fee') return 0.5;
  return 0.0;
}

function normLayover(layoverMinutes: number[], stops: number): number {
  if (stops === 0 || layoverMinutes.length === 0) return 1.0;
  const scores = layoverMinutes.map(m => {
    if (m >= 60 && m <= 180) return 1.0;  // 1–3 hours: ideal
    if (m < 60)  return 0.7;              // < 1 hour: short
    if (m > 480) return 0.3;              // > 8 hours: very long
    return 0.5;                           // 3–8 hours: long
  });
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}

// Deterministic prediction: cheapest fares face most demand → prices rise → buy now.
function normPrediction(ps: number): number {
  if (ps >= 0.75) return 1.0; // near-cheapest → price expected to increase
  if (ps <= 0.25) return 0.3; // most expensive → price may drop
  return 0.6;                 // neutral
}

// ─── Step 2: Weighted combination ────────────────────────────────────────────

function computeBreakdown(
  fare: FareInput,
  ctx: FlightContext,
  minPrice: number,
  maxPrice: number,
): AiScoreBreakdown {
  const ps   = normPrice(fare.totalPrice, minPrice, maxPrice);
  const ds   = normDuration(ctx.durationMinutes, ctx.durationMinutes, ctx.durationMinutes); // same flight → 1.0
  const ss   = normStops(ctx.stops);
  const bs   = normBaggage(fare.checked);
  const rs   = normRefund(fare.refundable, fare.refundFeeUsd);
  const cs   = normChange(fare.changeable, fare.changeFeeUsd);
  const seat = normSeat(fare.seatSelection);
  const ls   = normLayover(ctx.layoverMinutes, ctx.stops);
  const pred = normPrediction(ps);

  const raw =
    0.30 * ps   +
    0.15 * ds   +
    0.10 * ss   +
    0.10 * bs   +
    0.10 * rs   +
    0.10 * cs   +
    0.05 * seat +
    0.05 * ls   +
    0.05 * pred;

  return {
    priceScore:      ps,
    durationScore:   ds,
    stopsScore:      ss,
    baggageScore:    bs,
    refundScore:     rs,
    changeScore:     cs,
    seatScore:       seat,
    layoverScore:    ls,
    predictionScore: pred,
    finalScore:      Math.round(raw * 10000) / 100,
  };
}

// ─── Step 3: Badge classification ────────────────────────────────────────────

function classifyBadges(
  fares: Array<{ id: string; totalPrice: number; breakdown: AiScoreBreakdown; cabin: string }>,
): Record<string, AiBadge[]> {
  // CHEAPEST: min price
  const cheapestId = [...fares].sort((a, b) => a.totalPrice - b.totalPrice)[0].id;

  // AI BEST CHOICE: max AI score
  const bestId = [...fares].sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore)[0].id;

  // MOST FLEXIBLE: highest (refund + change + baggage) composite
  const mostFlexId = [...fares].sort((a, b) => {
    const fa = a.breakdown.refundScore + a.breakdown.changeScore + a.breakdown.baggageScore;
    const fb = b.breakdown.refundScore + b.breakdown.changeScore + b.breakdown.baggageScore;
    return fb !== fa ? fb - fa : a.totalPrice - b.totalPrice;
  })[0].id;

  // PREMIUM UPGRADE: best-scoring non-economy cabin
  const premiumCandidates = fares.filter(f => f.cabin !== 'economy');
  const premiumId = premiumCandidates.length > 0
    ? [...premiumCandidates].sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore)[0].id
    : null;

  const map: Record<string, AiBadge[]> = {};
  for (const f of fares) {
    const badges: AiBadge[] = [];
    if (f.id === cheapestId) badges.push('cheapest');
    if (f.id === bestId) {
      badges.push('best_value');
      badges.push('ai_pick');
    }
    if (f.id === mostFlexId && !badges.includes('best_value')) badges.push('most_flexible');
    if (f.id === premiumId && f.cabin !== 'economy') badges.push('premium_upgrade');
    map[f.id] = badges;
  }
  return map;
}

// ─── Step 4: Explanation generation ──────────────────────────────────────────

function generateExplanation(fare: FareInput, bd: AiScoreBreakdown, badges: AiBadge[]): string {
  if (badges.includes('cheapest') && badges.includes('best_value')) {
    return 'Best of both worlds — lowest price with the highest AI score across all factors.';
  }
  if (badges.includes('ai_pick') || badges.includes('best_value')) {
    const top: string[] = [];
    if (bd.priceScore > 0.6) top.push('competitive price');
    if (bd.baggageScore >= 0.7) top.push(fare.checked >= 2 ? '2 checked bags' : '1 checked bag');
    if (bd.refundScore === 1.0) top.push('free refunds');
    else if (bd.changeScore === 1.0) top.push('free changes');
    if (bd.seatScore === 1.0) top.push('free seat selection');
    const chosen = top.slice(0, 3);
    return chosen.length >= 2
      ? `AI top pick: best balance of ${chosen.join(', ')}.`
      : 'AI top pick: highest overall score across all fare factors.';
  }
  if (badges.includes('cheapest')) {
    return 'Lowest price — ideal if you travel light and your plans are fixed.';
  }
  if (badges.includes('most_flexible')) {
    const parts: string[] = [];
    if (bd.refundScore === 1.0) parts.push('fully refundable');
    if (bd.changeScore === 1.0) parts.push('free changes');
    if (fare.checked >= 1) parts.push(`${fare.checked} checked bag${fare.checked > 1 ? 's' : ''}`);
    return parts.length > 0
      ? `Most flexible: ${parts.join(', ')}.`
      : 'Best flexibility score — fully refundable and changeable with no fees.';
  }
  if (badges.includes('premium_upgrade')) {
    const perks: string[] = [];
    if (fare.cabin === 'business') perks.push('lie-flat seat', 'lounge access');
    if (fare.checked >= 2) perks.push(`${fare.checked} checked bags`);
    return perks.length > 0
      ? `Premium upgrade: ${perks.join(', ')} included.`
      : 'Premium cabin — extra comfort and priority boarding.';
  }

  // Generic: top 3 high-scoring factors
  const factors = [
    { score: bd.priceScore,   label: 'competitive price' },
    { score: bd.baggageScore, label: fare.checked >= 2 ? '2 checked bags' : fare.checked === 1 ? '1 checked bag' : 'carry-on only' },
    { score: bd.refundScore,  label: 'refund flexibility' },
    { score: bd.changeScore,  label: 'change flexibility' },
    { score: bd.seatScore,    label: 'free seat selection' },
    { score: bd.stopsScore,   label: bd.stopsScore === 1.0 ? 'nonstop flight' : 'convenient connections' },
  ].filter(f => f.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 3);

  if (factors.length >= 2) {
    return `Good combination of ${factors.map(f => f.label).join(', ')}.`;
  }
  const bags   = fare.checked > 0 ? `${fare.checked} checked bag${fare.checked > 1 ? 's' : ''} included` : 'carry-on only';
  const change = fare.changeable ? 'changes allowed' : 'no changes permitted';
  return `${bags}; ${change}.`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute AI scores for a group of fare options for the same flight.
 * Normalization is done within this group.
 */
export function computeAiScores(fares: FareInput[], ctx: FlightContext): ScoredFare[] {
  if (fares.length === 0) return [];

  const prices   = fares.map(f => f.totalPrice);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  const withBreakdowns = fares.map(fare => ({
    fare,
    breakdown: computeBreakdown(fare, ctx, minPrice, maxPrice),
  }));

  const badgeMap = classifyBadges(
    withBreakdowns.map(({ fare, breakdown }) => ({
      id: fare.id, totalPrice: fare.totalPrice, breakdown, cabin: fare.cabin,
    })),
  );

  return withBreakdowns.map(({ fare, breakdown }) => {
    const badges = badgeMap[fare.id] ?? [];
    return { id: fare.id, breakdown, badges, explanation: generateExplanation(fare, breakdown, badges) };
  });
}
