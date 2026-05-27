// ─── Allowed weight keys — GPT may ONLY use these ────────────────────────────

export const ALLOWED_WEIGHT_KEYS = [
  'price',
  'stops',
  'total_duration',
  'layover_minutes',
  'walking_complexity',
  'airport_change',
  'terminal_change',
  'bags_included',
  'checked_bags',
  'overnight_layover',
  'arrival_time',
  'departure_time',
  'reliability_score',
  'delay_probability',
  'red_eye_penalty',
  'connection_complexity',
  'airport_stress_score',
  'seat_comfort_score',
  'same_terminal_bonus',
  'wheelchair_friendliness',
  'family_friendliness',
] as const;

export type AllowedWeightKey = typeof ALLOWED_WEIGHT_KEYS[number];

// ─── Dynamic Profile ─────────────────────────────────────────────────────────

export interface DynamicProfile {
  dynamic_profile_id: string;
  intent_summary: string;
  intent_categories: string[];
  weights: Partial<Record<AllowedWeightKey, number>>;
  reasoning_focus: string[];
  source: 'static_match' | 'dynamic_extraction';
}

// ─── Airline reliability lookup (IATA code → 0-100) ──────────────────────────

export const AIRLINE_RELIABILITY: Record<string, number> = {
  SQ: 95, QR: 93, NH: 93, EK: 91, JL: 91, LX: 90, CX: 90, QF: 89,
  LH: 88, OS: 88, AF: 86, KL: 85, DL: 85, AC: 83, BA: 83,
  UA: 82, AA: 80, TK: 79, IB: 78, AY: 84, SK: 83, AZ: 77,
  WN: 76, B6: 75, AS: 81, HA: 84, VS: 82, EI: 76,
};

export function getReliabilityScore(airlineCode: string): number {
  return AIRLINE_RELIABILITY[airlineCode.toUpperCase()] ?? 70;
}

// ─── Heuristic scores computed from normalized flight data ───────────────────

export interface FlightHeuristicScores {
  airline_reliability_score: number;     // 0–100, higher = more reliable
  delay_probability_score: number;       // 0–10, lower = less likely to delay
  walking_complexity_score: number;      // 0–10, lower = less walking
  airport_stress_score: number;          // 0–10, lower = less stressful
  seat_comfort_score: number;            // 0–10, higher = more comfortable
  family_friendliness_score: number;     // 0–10, higher = better for families
  wheelchair_friendliness_score: number; // 0–10, higher = more accessible
}

export function computeHeuristicScores(params: {
  airlineCode: string;
  stops: number;
  airportChange: boolean;
  overnightLayover: boolean;
  isRedEye: boolean;
  longestLayoverMinutes: number;
  checkedBags: number;
  carryOnBags: number;
  cabin: string;
}): FlightHeuristicScores {
  const { airlineCode, stops, airportChange, overnightLayover, isRedEye,
          longestLayoverMinutes, checkedBags, carryOnBags, cabin } = params;

  const reliability = getReliabilityScore(airlineCode);

  // Walking complexity: each stop adds complexity; airport/terminal change = high penalty
  const walking = Math.min(10, stops * 2.5 + (airportChange ? 3 : 0));

  // Airport stress: compound of stops, changes, overnight, tight connections
  const tightConnection = longestLayoverMinutes > 0 && longestLayoverMinutes < 60 && stops > 0;
  const stress = Math.min(10,
    stops * 2 +
    (airportChange ? 2.5 : 0) +
    (overnightLayover ? 2 : 0) +
    (tightConnection ? 2 : 0),
  );

  // Seat comfort by cabin class
  const comfortMap: Record<string, number> = {
    economy: 4, premium_economy: 6, business: 9, first: 10,
  };
  const comfort = comfortMap[cabin] ?? 4;

  // Family friendliness (0–10)
  let family = 10 - stops * 2 - (airportChange ? 2 : 0) - (overnightLayover ? 2 : 0) - (isRedEye ? 1 : 0);
  if (checkedBags > 0 || carryOnBags > 0) family += 1;
  family = Math.max(0, Math.min(10, family));

  // Wheelchair / accessibility friendliness (0–10)
  let wheelchair = stops === 0 ? 10 : stops === 1 && !airportChange ? 6 : 3;
  if (longestLayoverMinutes >= 120) wheelchair = Math.min(10, wheelchair + 1);
  wheelchair = Math.max(0, Math.min(10, wheelchair));

  return {
    airline_reliability_score: reliability,
    delay_probability_score: Math.round(((100 - reliability) / 10) * 10) / 10,
    walking_complexity_score: Math.round(walking * 10) / 10,
    airport_stress_score: Math.round(stress * 10) / 10,
    seat_comfort_score: comfort,
    family_friendliness_score: Math.round(family * 10) / 10,
    wheelchair_friendliness_score: wheelchair,
  };
}

// ─── Validate and constrain dynamic weights from GPT output ──────────────────

export function sanitizeWeights(
  raw: Record<string, number>,
): Partial<Record<AllowedWeightKey, number>> {
  const allowed = new Set<string>(ALLOWED_WEIGHT_KEYS);
  const out: Partial<Record<AllowedWeightKey, number>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (allowed.has(k) && typeof v === 'number' && isFinite(v)) {
      out[k as AllowedWeightKey] = Math.max(-1, Math.min(1, v));
    }
  }
  return out;
}
