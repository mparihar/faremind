// ═══════════════════════════════════════════════════════════════════════════════
// 🧬 DNA Traits Engine
// Converts low-level DNA preferences into high-level traveler traits.
// Pure helper — no API calls, no database access.
// ═══════════════════════════════════════════════════════════════════════════════

import type { TravelDnaPreferenceItem } from './travel-dna-service';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TravelerTrait {
  traitName: string;
  confidence: number;     // 0–100, internal only — never exposed to users
  evidence: string[];     // e.g. ["Nonstop flights 85%", "Morning departures 78%"]
}

// ── Trait Definitions ────────────────────────────────────────────────────────

interface TraitRule {
  traitName: string;
  /** Each matcher: { category, keys[] } — if ANY key in the category matches, it contributes */
  matchers: Array<{
    category: string;
    keys: string[];
    /** Optional weight multiplier (default 1.0) */
    weight?: number;
  }>;
  /** Minimum confidence threshold to include this trait (default 40) */
  minConfidence?: number;
}

const TRAIT_RULES: TraitRule[] = [
  // ─── Trait 1: Value Conscious Traveler ─────────────────────────────────────
  {
    traitName: 'Value Conscious Traveler',
    matchers: [
      { category: 'cabin', keys: ['economy'], weight: 1.2 },
      { category: 'fare_flexibility', keys: ['standard'], weight: 0.8 },
    ],
  },

  // ─── Trait 2: Convenience Seeker ───────────────────────────────────────────
  {
    traitName: 'Convenience Seeker',
    matchers: [
      { category: 'stops', keys: ['nonstop'], weight: 1.5 },
      { category: 'departure_time', keys: ['morning', 'afternoon'], weight: 1.0 },
    ],
  },

  // ─── Trait 3: Airline Loyalist ─────────────────────────────────────────────
  {
    traitName: 'Airline Loyalist',
    matchers: [
      { category: 'airline', keys: ['*'], weight: 1.0 },  // '*' = any airline with score ≥ 60
    ],
    minConfidence: 55,
  },

  // ─── Trait 4: Protected Traveler ───────────────────────────────────────────
  {
    traitName: 'Protected Traveler',
    matchers: [
      { category: 'insurance', keys: ['with_insurance'], weight: 1.2 },
      { category: 'price_protection', keys: ['with_protection'], weight: 1.2 },
    ],
  },

  // ─── Trait 5: Planner ─────────────────────────────────────────────────────
  {
    traitName: 'Planner',
    matchers: [
      { category: 'booking_window', keys: ['2_6_weeks', '6_plus_weeks'], weight: 1.3 },
    ],
  },

  // ─── Trait 6: Solo Explorer ───────────────────────────────────────────────
  {
    traitName: 'Solo Explorer',
    matchers: [
      { category: 'travel_party', keys: ['solo'], weight: 1.5 },
    ],
  },

  // ─── Trait 7: Family Traveler ─────────────────────────────────────────────
  {
    traitName: 'Family Traveler',
    matchers: [
      { category: 'travel_party', keys: ['family'], weight: 1.5 },
    ],
  },

  // ─── Trait 8: Comfort Seeker ──────────────────────────────────────────
  {
    traitName: 'Comfort Seeker',
    matchers: [
      { category: 'cabin', keys: ['premium_economy', 'business', 'first'], weight: 1.5 },
      { category: 'fare_value', keys: ['comfort_fare'], weight: 1.3 },
      { category: 'seat', keys: ['window', 'aisle', 'extra_legroom', 'pre_selected'], weight: 0.8 },
      { category: 'baggage', keys: ['extra_baggage'], weight: 0.7 },
    ],
  },

  // ─── Trait 9: Cultural Traveler ───────────────────────────────────────────
  {
    traitName: 'Cultural Traveler',
    matchers: [
      { category: 'meal', keys: ['*_special'], weight: 1.2 },  // any non-standard meal
    ],
    minConfidence: 35,
  },

  // ─── Trait 10: Flexible Traveler ──────────────────────────────────────────
  {
    traitName: 'Flexible Traveler',
    matchers: [
      { category: 'fare_flexibility', keys: ['flex', 'standard'], weight: 1.3 },
    ],
  },
];

// ── Helper: check if a preference key matches a matcher key ─────────────────

function keyMatches(prefKey: string, matcherKey: string): boolean {
  if (matcherKey === '*') return true;
  if (matcherKey === '*_special') {
    // Match any meal key that is NOT 'standard' or 'no_meal_selected'
    return prefKey !== 'standard' && prefKey !== 'no_meal_selected';
  }
  return prefKey === matcherKey;
}

// ── Main: Derive Traveler Traits ─────────────────────────────────────────────

/**
 * Converts raw DNA preferences into high-level traveler traits.
 * Each trait has a confidence score and evidence array.
 *
 * @param preferences  The user's DNA preferences (category → items[])
 * @returns            Sorted array of TravelerTrait (highest confidence first)
 */
export function deriveTravelerTraits(
  preferences: Record<string, TravelDnaPreferenceItem[]>,
): TravelerTrait[] {
  const traits: TravelerTrait[] = [];

  for (const rule of TRAIT_RULES) {
    const matchedEvidence: string[] = [];
    const matchedScores: { score: number; weight: number }[] = [];

    for (const matcher of rule.matchers) {
      const categoryItems = preferences[matcher.category];
      if (!categoryItems || categoryItems.length === 0) continue;

      for (const item of categoryItems) {
        // Skip rejected preferences
        if (item.rejectedByUser) continue;

        // Derive the key from the label for matching
        const itemKey = labelToKey(item.label);

        // Check if this item matches any of the matcher's keys
        const matches = matcher.keys.some(k => keyMatches(itemKey, k));
        if (!matches) continue;

        // For airline loyalist, require score ≥ 60
        if (matcher.category === 'airline' && matcher.keys.includes('*') && item.score < 60) {
          continue;
        }

        const weight = matcher.weight ?? 1.0;
        matchedScores.push({ score: item.score, weight });
        matchedEvidence.push(`${item.label} ${item.score}%`);
      }
    }

    // Skip traits with no matched evidence
    if (matchedScores.length === 0) continue;

    // Compute weighted confidence
    const totalWeight = matchedScores.reduce((sum, s) => sum + s.weight, 0);
    const weightedSum = matchedScores.reduce((sum, s) => sum + s.score * s.weight, 0);
    const confidence = Math.round(weightedSum / totalWeight);

    // Apply minimum confidence threshold
    const minConfidence = rule.minConfidence ?? 40;
    if (confidence < minConfidence) continue;

    traits.push({
      traitName: rule.traitName,
      confidence: Math.min(100, confidence),
      evidence: matchedEvidence,
    });
  }

  // Sort by confidence DESC
  traits.sort((a, b) => b.confidence - a.confidence);

  return traits;
}

// ── Helper: convert label to key ────────────────────────────────────────────
// Converts user-friendly labels back to internal keys for matching.

function labelToKey(label: string): string {
  const map: Record<string, string> = {
    // Cabin
    'Economy': 'economy',
    'Premium Economy': 'premium_economy',
    'Business': 'business',
    'First': 'first',
    // Stops
    'Nonstop': 'nonstop',
    'One Stop': 'one_stop',
    'Two+ Stops': 'two_plus_stops',
    // Departure Time
    'Morning Flight': 'morning',
    'Afternoon Flight': 'afternoon',
    'Evening Flight': 'evening',
    'Night Flight': 'night',
    // Seat
    'Window Seat': 'window',
    'Aisle Seat': 'aisle',
    'Middle Seat': 'middle',
    'Extra Legroom Seat': 'extra_legroom',
    'Pre-selected Seat': 'pre_selected',
    'No Seat Preference': 'no_seat_selected',
    'No Seat Pre-selected': 'no_seat_selected',
    // Baggage (positive only)
    'Extra Baggage': 'extra_baggage',
    // Fare Flexibility (positive only)
    'Flex / Refundable': 'flex',
    'Standard (Changeable)': 'standard',
    // Fare Value (positive only)
    'Comfort Fare': 'comfort_fare',
    // Insurance (positive only)
    'Travel Insurance Added': 'with_insurance',
    // Price Protection (positive only)
    'Price Drop Protection Added': 'with_protection',
    // Meal
    'Standard Meal': 'standard',
    'No Meal Pre-selected': 'no_meal_selected',
    // Travel Party
    'Solo': 'solo',
    'Couple': 'couple',
    'Family': 'family',
    'Group': 'group',
    // Booking Window
    'Last Minute (0-3 days)': 'last_minute',
    '1-2 Weeks Before': '1_2_weeks',
    '2-6 Weeks Before': '2_6_weeks',
    '6+ Weeks Before': '6_plus_weeks',
  };

  return map[label] || label.toLowerCase().replace(/\s+/g, '_');
}

// ── Serialize Traits for GPT ─────────────────────────────────────────────────

/**
 * Serializes traveler traits into a compact text format for GPT prompts.
 * Does NOT include confidence scores or evidence — only trait names.
 */
export function serializeTraitsForGpt(traits: TravelerTrait[]): string {
  if (traits.length === 0) return 'No strong traveler traits identified.';

  return traits.map(t => `• ${t.traitName}`).join('\n');
}
