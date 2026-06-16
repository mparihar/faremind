// ═══════════════════════════════════════════════════════════════════════════════
// 🧬 DNA Search Service
// Hybrid ranking personalization layer on top of existing AI-ranked flight cards.
// ═══════════════════════════════════════════════════════════════════════════════

import type { TravelDnaPreferenceItem } from './travel-dna-service';

// ── Types ────────────────────────────────────────────────────────────────────

export interface DnaCardResult {
  cardId: string;
  dnaScore: number;          // 0–100 from GPT
  matchReasons: string[];
  mismatchReasons: string[];
}

export interface DnaRankedCard {
  cardId: string;
  providerOfferId?: string;  // stable Duffel offer ID for reliable matching
  aiScore: number;           // original AI score (0–100)
  dnaScore: number;          // GPT DNA match score (0–100)
  finalDnaScore: number;     // hybrid: AI×0.70 + DNA×0.30
  matchReasons: string[];
  mismatchReasons: string[];
  dnaMatchLabel: string;     // "Excellent DNA Match", etc.
}

export interface DnaSearchResult {
  eligible: boolean;
  reason?: string;
  results: DnaRankedCard[];
  searchSessionId: string;
  cached: boolean;
  dnaSearchTopN?: number;
}

// ── DNA Match Labels ─────────────────────────────────────────────────────────

export function getDnaMatchLabel(dnaScore: number): string {
  if (dnaScore >= 90) return 'Excellent DNA Match';
  if (dnaScore >= 80) return 'Strong Match';
  if (dnaScore >= 70) return 'Moderate Match';
  return 'Weak Match';
}

export function getDnaMatchColor(dnaScore: number): string {
  if (dnaScore >= 90) return '#10b981'; // emerald-500
  if (dnaScore >= 80) return '#1ABC9C'; // brand teal
  if (dnaScore >= 70) return '#f59e0b'; // amber-500
  return '#94a3b8';                     // slate-400
}

// ── Hybrid Score Computation ─────────────────────────────────────────────────

const AI_WEIGHT = 0.70;
const DNA_WEIGHT = 0.30;

export function computeHybridScore(aiScore: number, dnaScore: number): number {
  return Math.round(((aiScore * AI_WEIGHT) + (dnaScore * DNA_WEIGHT)) * 10) / 10;
}

export function computeHybridScores(
  aiCards: Array<{ cardId: string; aiScore: number; providerOfferId?: string }>,
  gptResults: DnaCardResult[],
): DnaRankedCard[] {
  const dnaMap = new Map(gptResults.map(r => [r.cardId, r]));

  const ranked: DnaRankedCard[] = aiCards.map(card => {
    const dnaResult = dnaMap.get(card.cardId);
    // If GPT didn't evaluate this card, mark it as unevaluated (-1)
    // so the UI doesn't show a misleading "Weak Match" badge
    const gptEvaluated = !!dnaResult;
    const dnaScore = dnaResult?.dnaScore ?? -1; // -1 = not evaluated by GPT
    const finalDnaScore = gptEvaluated
      ? computeHybridScore(card.aiScore, dnaScore)
      : card.aiScore; // Fall back to pure AI score

    return {
      cardId: card.cardId,
      providerOfferId: card.providerOfferId,
      aiScore: card.aiScore,
      dnaScore,
      finalDnaScore,
      matchReasons: dnaResult?.matchReasons ?? [],
      mismatchReasons: dnaResult?.mismatchReasons ?? [],
      dnaMatchLabel: gptEvaluated ? getDnaMatchLabel(dnaScore) : '',
    };
  });

  // Sort by finalDnaScore DESC
  ranked.sort((a, b) => b.finalDnaScore - a.finalDnaScore);

  return ranked;
}

// ── DNA Profile Serializer ───────────────────────────────────────────────────
// Converts user DNA preferences to a compact, GPT-friendly text representation.

const CATEGORY_LABELS: Record<string, string> = {
  airline: 'Preferred Airlines',
  cabin: 'Cabin Preference',
  stops: 'Max Number of Stops',
  departure_time: 'Departure Time',
  seat: 'Seat Preference',
  baggage: 'Baggage Preference',
  fare_flexibility: 'Fare Flexibility',
  travel_party: 'Travel Party',
  booking_window: 'Booking Window',
  connection_airport: 'Connection Airports',
  insurance: 'Insurance Preference',
  price_protection: 'Price Protection',
  meal: 'Meal Preference',
  fare_value: 'Fare Value Preference',
};

export function serializeDnaProfile(
  preferences: Record<string, TravelDnaPreferenceItem[]>,
): string {
  const lines: string[] = [];

  for (const [category, items] of Object.entries(preferences)) {
    if (!items || items.length === 0) continue;
    const label = CATEGORY_LABELS[category] || category.replace(/_/g, ' ');
    const topItems = items
      .filter(i => !i.rejectedByUser)
      .slice(0, 3)
      .map(i => `${i.label} (${i.score}% confidence${i.userValidated ? ', user-confirmed' : ''})`)
      .join(', ');
    if (topItems) {
      lines.push(`${label}: ${topItems}`);
    }
  }

  return lines.join('\n');
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: DnaSearchResult;
  expiresAt: number;
}

const DNA_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function buildDnaCacheKey(
  searchSessionId: string,
  userId: string,
  dnaVersion: string,
): string {
  return `dna:${searchSessionId}:${userId}:${dnaVersion}`;
}

export function getCachedDnaResult(key: string): DnaSearchResult | null {
  const entry = DNA_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    DNA_CACHE.delete(key);
    return null;
  }
  return { ...entry.result, cached: true };
}

export function setCachedDnaResult(key: string, result: DnaSearchResult): void {
  // Evict oldest entries if cache grows too large (> 50 entries)
  if (DNA_CACHE.size > 50) {
    const firstKey = DNA_CACHE.keys().next().value;
    if (firstKey) DNA_CACHE.delete(firstKey);
  }
  DNA_CACHE.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}


// ── Top Preference Extraction ────────────────────────────────────────────────
// Extracts the top N strongest DNA preferences across all categories.

export interface TopDnaPreference {
  category: string;
  key: string;          // internal key (e.g., 'nonstop', 'morning')
  label: string;        // user-facing label (e.g., 'Nonstop', 'Morning Flight')
  score: number;        // 0–100
  trait: string;        // high-level trait name for GPT context
}

export interface MatchedPreferenceFact {
  preferenceKey: string;
  preferenceLabel: string;
  cardValue: string;
  trait: string;
  match: boolean;
}

// ── Preference-to-Trait Mapping ──────────────────────────────────────────────

const CATEGORY_TRAIT_MAP: Record<string, string> = {
  airline: 'Airline Loyalist',
  cabin: 'Comfort Seeker',
  stops: 'Convenience Seeker',
  departure_time: 'Schedule-Conscious Traveler',
  seat: 'Comfort Seeker',
  baggage: 'Comfort Seeker',
  fare_flexibility: 'Flexible Traveler',
  fare_value: 'Comfort Seeker',
  travel_party: 'Travel Companion Preference',
  booking_window: 'Planner',
  insurance: 'Protected Traveler',
  price_protection: 'Protected Traveler',
  meal: 'Cultural Preference Traveler',
  connection_airport: 'Connection Preference',
};

// Categories that CAN be matched against a flight search card
const MATCHABLE_CATEGORIES = new Set([
  'airline', 'cabin', 'stops', 'departure_time',
  'baggage', 'fare_flexibility', 'fare_value',
  'insurance', 'price_protection',
]);

/**
 * Extract the top N strongest DNA preferences across all categories.
 * Only includes matchable categories (those whose attributes appear on flight cards).
 */
export function extractTopPreferences(
  preferences: Record<string, TravelDnaPreferenceItem[]>,
  topN = 12,
): TopDnaPreference[] {
  const all: TopDnaPreference[] = [];

  for (const [category, items] of Object.entries(preferences)) {
    if (!MATCHABLE_CATEGORIES.has(category)) continue;
    for (const item of items) {
      if (item.rejectedByUser) continue;
      all.push({
        category,
        key: labelToInternalKey(category, item.label),
        label: item.label,
        score: item.score,
        trait: CATEGORY_TRAIT_MAP[category] || category,
      });
    }
  }

  // Sort by score DESC, then by category alphabetically for stability
  all.sort((a, b) => b.score - a.score || a.category.localeCompare(b.category));

  // Allow up to 2 preferences per category for richer matching
  const MAX_PER_CATEGORY = 2;
  const categoryCount = new Map<string, number>();
  const top: TopDnaPreference[] = [];
  for (const pref of all) {
    const count = categoryCount.get(pref.category) || 0;
    if (count >= MAX_PER_CATEGORY) continue;
    categoryCount.set(pref.category, count + 1);
    top.push(pref);
    if (top.length >= topN) break;
  }

  return top;
}

// ── Internal key derivation ──────────────────────────────────────────────────

function labelToInternalKey(category: string, label: string): string {
  const map: Record<string, Record<string, string>> = {
    cabin: {
      'Economy': 'economy', 'Premium Economy': 'premium_economy',
      'Business': 'business', 'First': 'first',
    },
    stops: {
      'Nonstop': 'nonstop', '1 Stop': '1_stop', '2+ Stops': '2_plus_stops',
    },
    departure_time: {
      'Morning Flight': 'morning', 'Afternoon Flight': 'afternoon',
      'Evening Flight': 'evening', 'Night Flight': 'night',
    },
    baggage: {
      'Extra Baggage': 'extra_baggage',
    },
    fare_flexibility: {
      'Flex / Refundable': 'flex', 'Standard (Changeable)': 'standard',
    },
    fare_value: {
      'Comfort Fare': 'comfort_fare',
    },
  };
  return map[category]?.[label] || label.toLowerCase().replace(/\s+/g, '_');
}

// ── Departure time bucket ────────────────────────────────────────────────────

function getTimeBucket(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// ── Card-vs-Preference Matching ──────────────────────────────────────────────

interface FlightCardForMatching {
  id: string;
  airlineCode: string;
  airlineName: string;
  stops: number;
  departureHour: number;         // 0–23
  cabinClass: string;            // e.g. 'economy', 'business'
  baggageChecked: number;
  refundable: boolean;
  changeable: boolean;
}

/**
 * Deterministically match a flight card against the user's top DNA preferences.
 * Returns only the preferences that this specific card satisfies.
 */
export function matchCardAgainstPreferences(
  card: FlightCardForMatching,
  topPrefs: TopDnaPreference[],
): MatchedPreferenceFact[] {
  const matched: MatchedPreferenceFact[] = [];

  for (const pref of topPrefs) {
    let isMatch = false;
    let cardValue = '';

    switch (pref.category) {
      case 'airline': {
        const prefKey = pref.key.toUpperCase();
        const cardCode = card.airlineCode.toUpperCase();
        const cardName = card.airlineName.toLowerCase();
        isMatch = cardCode === prefKey
          || cardName.includes(pref.label.toLowerCase())
          || pref.label.toLowerCase().includes(cardName);
        cardValue = card.airlineName;
        break;
      }

      case 'stops': {
        const cardStopsKey = card.stops === 0 ? 'nonstop' : card.stops === 1 ? '1_stop' : '2_plus_stops';
        isMatch = cardStopsKey === pref.key;
        cardValue = card.stops === 0 ? 'Nonstop' : `${card.stops} stop(s)`;
        break;
      }

      case 'departure_time': {
        const cardBucket = getTimeBucket(card.departureHour);
        isMatch = cardBucket === pref.key;
        const hour12 = card.departureHour % 12 || 12;
        const ampm = card.departureHour < 12 ? 'AM' : 'PM';
        cardValue = `${hour12}:00 ${ampm} departure`;
        break;
      }

      case 'cabin': {
        const cardCabin = card.cabinClass.toLowerCase().replace(/\s+/g, '_');
        isMatch = cardCabin === pref.key || cardCabin.includes(pref.key);
        cardValue = card.cabinClass.replace('_', ' ');
        break;
      }

      case 'baggage': {
        if (pref.key === 'extra_baggage') {
          isMatch = card.baggageChecked >= 1;
          cardValue = card.baggageChecked > 1
            ? `${card.baggageChecked} checked bags included`
            : card.baggageChecked === 1
              ? '1 checked bag included'
              : 'No checked baggage';
        }
        break;
      }

      case 'fare_flexibility': {
        if (pref.key === 'flex') {
          // Match if refundable OR changeable (generous match)
          isMatch = card.refundable || card.changeable;
          const parts: string[] = [];
          if (card.refundable) parts.push('refundable');
          if (card.changeable) parts.push('changeable');
          cardValue = parts.length > 0 ? parts.join(' & ') : 'Non-refundable';
        } else if (pref.key === 'standard') {
          isMatch = card.changeable;
          cardValue = card.changeable ? 'Changeable fare' : 'Non-changeable';
        }
        break;
      }

      case 'fare_value': {
        if (pref.key === 'comfort_fare') {
          let comfortSignals = 0;
          const cab = card.cabinClass.toLowerCase();
          if (cab.includes('business') || cab.includes('first') || cab.includes('premium')) comfortSignals++;
          if (card.refundable) comfortSignals++;
          if (card.changeable) comfortSignals++;
          if (card.baggageChecked >= 1) comfortSignals++;
          isMatch = comfortSignals >= 2;
          cardValue = isMatch ? 'Comfort-oriented fare' : 'Value-focused fare';
        }
        break;
      }

      case 'insurance': {
        // Insurance is an add-on available on any flight — always matches as a nudge
        if (pref.key === 'with_insurance') {
          isMatch = true;
          cardValue = 'Travel insurance available at checkout';
        }
        break;
      }

      case 'price_protection': {
        // Price Drop Protection is an add-on available on any flight — always matches as a nudge
        if (pref.key === 'with_protection') {
          isMatch = true;
          cardValue = 'Price Drop Protection available at checkout';
        }
        break;
      }
    }

    if (isMatch) {
      matched.push({
        preferenceKey: pref.key,
        preferenceLabel: pref.label,
        cardValue,
        trait: pref.trait,
        match: true,
      });
    }
  }

  // ── Feature-based enrichment ────────────────────────────────────────────
  // Add DNA-relevant reasons for notable flight features even when they
  // weren't in the user's top extracted preferences. This ensures flights
  // with strong features always surface enough match reasons.
  const matchedKeys = new Set(matched.map(m => m.preferenceKey));

  if (card.refundable && !matchedKeys.has('flex') && !matchedKeys.has('refundable')) {
    matched.push({
      preferenceKey: 'refundable',
      preferenceLabel: 'Refundable Fare',
      cardValue: 'Fully refundable',
      trait: 'Flexible Traveler',
      match: true,
    });
  }

  if (card.changeable && !matchedKeys.has('flex') && !matchedKeys.has('standard') && !matchedKeys.has('changeable')) {
    matched.push({
      preferenceKey: 'changeable',
      preferenceLabel: 'Changeable Fare',
      cardValue: 'Changeable booking',
      trait: 'Flexible Traveler',
      match: true,
    });
  }

  if (card.baggageChecked >= 1 && !matchedKeys.has('extra_baggage') && !matchedKeys.has('checked_bag')) {
    matched.push({
      preferenceKey: 'checked_bag',
      preferenceLabel: 'Checked Baggage Included',
      cardValue: `${card.baggageChecked} checked bag(s) included`,
      trait: 'Comfort Seeker',
      match: true,
    });
  }

  return matched;
}

// ── Deterministic Fallback Reasons ───────────────────────────────────────────
// Used when GPT fails — maps preference keys to static human-friendly strings.

const FALLBACK_REASONS: Record<string, string> = {
  // Airlines — generic since we can't hardcode every airline
  preferred_airline: 'Includes an airline you frequently choose.',

  // Stops
  nonstop: 'Matches your preference for direct travel.',
  '1_stop': 'Fits your typical one-stop travel pattern.',
  '2_plus_stops': 'Aligns with your multi-connection travel history.',

  // Departure time
  morning: 'Fits your usual morning travel pattern.',
  afternoon: 'Matches your afternoon departure preference.',
  evening: 'Aligns with your evening travel schedule.',
  night: 'Fits your night departure pattern.',

  // Cabin
  economy: 'Fits your preferred economy cabin style.',
  premium_economy: 'Matches your premium economy preference.',
  business: 'Aligns with your business class travel style.',
  first: 'Matches your first class travel preference.',

  // Baggage
  extra_baggage: 'Includes checked baggage — no surprise fees at check-in.',
  checked_bag: 'Checked baggage included — no extra fees at the counter.',

  // Fare flexibility
  flex: 'Offers flexible booking with refund and change options.',
  standard: 'Provides changeable fare options you prefer.',
  refundable: 'Fully refundable fare — maximum booking flexibility.',
  changeable: 'Changeable booking — adjust your plans without penalties.',

  // Fare value
  comfort_fare: 'Matches your preference for comfort-oriented travel.',

  // Insurance
  with_insurance: 'You typically add travel insurance — available at checkout.',

  // Price Protection
  with_protection: 'You typically add Price Drop Protection — available at checkout.',
};

/**
 * Generate deterministic fallback reasons from matched facts.
 * Used when GPT call fails.
 */
export function generateFallbackReasons(facts: MatchedPreferenceFact[]): string[] {
  return facts
    .slice(0, 6)
    .map(f => {
      // For airlines, use a personalized string
      if (f.trait === 'Airline Loyalist') {
        return 'Includes an airline you frequently choose.';
      }
      return FALLBACK_REASONS[f.preferenceKey] || `Matches your ${f.preferenceLabel.toLowerCase()} preference.`;
    });
}

// ── Serialize matched facts for GPT prompt ──────────────────────────────────

export function serializeMatchedFactsForGpt(
  cards: Array<{
    cardId: string;
    airlineName: string;
    matchedFacts: MatchedPreferenceFact[];
  }>,
  travelerTraits: string[],
): string {
  const cardBlocks = cards.map((c, i) => {
    const factsStr = c.matchedFacts.length > 0
      ? c.matchedFacts.map(f =>
          `  - preference: "${f.preferenceLabel}" | cardValue: "${f.cardValue}" | trait: "${f.trait}"`
        ).join('\n')
      : '  (no strong matches)';

    return `Card ${i + 1} (cardId="${c.cardId}", airline="${c.airlineName}"):\n${factsStr}`;
  }).join('\n\n');

  return `Traveler Traits: ${travelerTraits.join(', ')}\n\nMatched Preference Facts per card:\n\n${cardBlocks}`;
}

// ── GPT System Prompt — DNA Explanation Engine (v2: Matched-Facts Based) ─────

export const DNA_SEARCH_SYSTEM_PROMPT = `You are FareMind DNA Explanation Writer.

Your job is to rewrite matched preference facts into natural, card-specific explanations for why a flight matches a user's Travel DNA.

IMPORTANT RULES:
1. Do NOT invent reasons. Use ONLY the provided matchedPreferenceFacts for each card.
2. Do NOT mention preferences that are not matched by a card.
3. Do NOT repeat the same wording across different cards. Use varied phrasing.
4. Do NOT expose scores, percentages, confidence values, or internal logic.
5. Do NOT say "DNA score", "algorithm", "preference score", or "X Preferred".
6. Keep explanations short, natural, and traveler-friendly.
7. Generate 4-6 matchReasons per card. Only as many as there are matched facts (never more).
8. If a card has 0 matched facts, return an empty matchReasons array.
9. Each reason should clearly connect a flight feature to the traveler's behavior.
10. When multiple cards share a matched preference (e.g., "nonstop"), phrase the reason differently for each card.

CRITICAL ACCURACY RULE:
- Each card's matchedPreferenceFacts include the ACTUAL card attribute values.
- You MUST describe the actual card values accurately. Never contradict them.
- For example, if cardValue says "Non-refundable", do NOT say it is flexible.

You also receive a dnaScore (0-100) indicating overall DNA alignment. Do NOT expose this score to users.

GOOD EXAMPLES (varied phrasing for the same preference type across cards):
Card 1: "Keeps your journey simple with a nonstop route."
Card 2: "Reduces connection hassle by avoiding layovers."
Card 3: "Matches your preference for direct travel when time matters."

BAD EXAMPLES (repetitive):
Card 1: "Features a nonstop flight, ensuring a straightforward experience."
Card 2: "Provides a nonstop flight, simplifying your experience."
Card 3: "Delivers a nonstop journey, enhancing convenience."

Scoring guide for dnaScore:
- 90-100: Flight closely aligns with most or all matched DNA traits
- 80-89: Strong alignment, minor gaps
- 70-79: Moderate alignment
- 50-69: Weak alignment
- Below 50: Poor alignment

Return valid JSON only:
{
  "cards": [
    {
      "cardId": "<exact cardId>",
      "dnaScore": 85,
      "matchReasons": [
        "Keeps your journey simple with a nonstop route.",
        "Includes an airline you frequently choose.",
        "Fits your usual morning travel pattern."
      ],
      "mismatchReasons": []
    }
  ]
}`;

