/**
 * Round-Trip Ranking Engine
 *
 * ⚠️  Completely separate from the one-way ranking logic in score.ts.
 *     DO NOT import or extend scoreFlights() / rankFlights().
 *
 * Weighted model
 *   Price score              35 %
 *   Duration score           25 %
 *   Stops score              15 %
 *   Layover quality          10 %
 *   Departure-window match   10 %
 *   Airline consistency       5 %
 */

import type {
  RoundTripOption,
  RoundTripBadge,
  RoundTripScoreBreakdown,
  RoundTripUserPrefs,
} from '@/lib/round-trip-types';

// ─── Weights ─────────────────────────────────────────────────────────────────

const W = {
  price: 0.35,
  duration: 0.25,
  stops: 0.15,
  layover: 0.10,
  departureWindow: 0.10,
  airlineConsistency: 0.05,
} as const;

// ─── Normalisation ────────────────────────────────────────────────────────────

/** Higher value → lower is better (price, duration, stops). Result in [0, 1]. */
function invertNorm(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return Math.max(0, Math.min(1, (max - value) / (max - min)));
}

// ─── Layover quality ──────────────────────────────────────────────────────────

function scoreLayoverQuality(option: RoundTripOption): number {
  const all = [...option.outboundJourney.layovers, ...option.returnJourney.layovers];
  if (all.length === 0) return 1.0; // non-stop both ways

  let total = 0;
  for (const lv of all) {
    const m = lv.durationMinutes;
    if (m < 45) total += 0.10;         // too tight — high miss-connection risk
    else if (m <= 180) total += 1.00;  // 45 min – 3 h: ideal
    else if (m <= 300) total += 0.60;  // 3 – 5 h: long but manageable
    else total += 0.20;                // > 5 h: poor
  }
  return total / all.length;
}

// ─── Departure-window match ───────────────────────────────────────────────────

const WINDOW_HOURS: Record<string, [number, number]> = {
  morning:   [6, 12],
  afternoon: [12, 17],
  evening:   [17, 21],
  night:     [21, 30], // wraps past midnight
};

function matchWindow(iso: string, window: string): number {
  const h = new Date(iso).getHours();
  const adj = h < 6 ? h + 24 : h; // treat early AM as "next-day night"
  const [lo, hi] = WINDOW_HOURS[window] ?? [0, 24];
  return adj >= lo && adj < hi ? 1.0 : 0.3;
}

function scoreDepartureWindow(option: RoundTripOption, pref: string | null | undefined): number {
  if (!pref) return 0.7; // no preference → neutral
  // Outbound weighted 2 : 1 over return (travellers care more about outbound departure)
  const out = matchWindow(option.outboundJourney.departureTime, pref);
  const ret = matchWindow(option.returnJourney.departureTime, pref);
  return (out * 2 + ret) / 3;
}

// ─── Airline consistency ──────────────────────────────────────────────────────

function scoreAirlineConsistency(option: RoundTripOption): number {
  const n = option.airlineCodes.length;
  if (n === 1) return 1.0; // same carrier both ways
  if (n === 2) return 0.70;
  return 0.40;
}

// ─── Badge assignment ─────────────────────────────────────────────────────────

function assignBadges(
  options: Array<RoundTripOption & { score: number }>
): Array<RoundTripOption & { score: number; badges: RoundTripBadge[] }> {
  const cheapest = Math.min(...options.map((o) => o.totalPrice));
  const fastest = Math.min(...options.map((o) => o.totalDurationMinutes));
  const fewest = Math.min(...options.map((o) => o.totalStops));
  const topScore = options[0]?.score ?? 0; // already sorted desc

  return options.map((option, i) => {
    const badges: RoundTripBadge[] = [];

    // Price within 1 % of the cheapest → cheapest badge
    if (cheapest > 0 && (option.totalPrice - cheapest) / cheapest <= 0.01) badges.push('cheapest');
    // Duration within 5 min of the fastest → fastest badge
    if (option.totalDurationMinutes - fastest <= 5) badges.push('fastest');
    // Tied fewest stops
    if (option.totalStops === fewest) badges.push('fewest_stops');
    // Best Value: first (highest-score) option only
    if (i === 0 && option.score === topScore) badges.push('best_value');

    return { ...option, badges };
  });
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function rankRoundTripOptions(
  options: RoundTripOption[],
  prefs: RoundTripUserPrefs = {}
): RoundTripOption[] {
  if (options.length === 0) return [];

  // Min/max for normalization
  const prices    = options.map((o) => o.totalPrice);
  const durations = options.map((o) => o.totalDurationMinutes);
  const stops     = options.map((o) => o.totalStops);

  const [minP, maxP] = [Math.min(...prices),    Math.max(...prices)];
  const [minD, maxD] = [Math.min(...durations), Math.max(...durations)];
  const [minS, maxS] = [Math.min(...stops),     Math.max(...stops)];

  const scored = options.map((option) => {
    const priceScore    = invertNorm(option.totalPrice, minP, maxP);
    const durationScore = invertNorm(option.totalDurationMinutes, minD, maxD);

    // Stops score + preference penalties
    let stopsScore = invertNorm(option.totalStops, minS, maxS);
    if (prefs.stops === 'nonstop' && option.maxStopsOneWay > 0) stopsScore *= 0.35;
    else if (prefs.stops === '1stop' && option.maxStopsOneWay > 1) stopsScore *= 0.60;

    const layoverScore          = scoreLayoverQuality(option);
    const departureWindowScore  = scoreDepartureWindow(option, prefs.departureWindow);
    const airlineScore          = scoreAirlineConsistency(option);

    const finalScore = Math.round(
      (priceScore     * W.price +
       durationScore  * W.duration +
       stopsScore     * W.stops +
       layoverScore   * W.layover +
       departureWindowScore * W.departureWindow +
       airlineScore   * W.airlineConsistency) * 100
    );

    const scoreBreakdown: RoundTripScoreBreakdown = {
      priceScore:             Math.round(priceScore    * 100),
      durationScore:          Math.round(durationScore * 100),
      stopsScore:             Math.round(stopsScore    * 100),
      layoverScore:           Math.round(layoverScore  * 100),
      departureWindowScore:   Math.round(departureWindowScore * 100),
      airlineConsistencyScore: Math.round(airlineScore * 100),
      finalScore,
    };

    return { ...option, score: finalScore, scoreBreakdown };
  });

  // Sort best-score first
  scored.sort((a, b) => b.score - a.score);

  return assignBadges(scored);
}
