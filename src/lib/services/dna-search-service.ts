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
  stops: 'Stop Preference',
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

// ── GPT System Prompt — DNA Explanation Engine ──────────────────────────────

export const DNA_SEARCH_SYSTEM_PROMPT = `You are FareMind DNA Explanation Engine.

You are NOT calculating DNA scores.
You are NOT ranking flights.
DNA scoring has already been completed.

Your sole responsibility is to:
1. Assign a dnaScore (0-100) indicating how well each flight matches the traveler's DNA traits.
2. Explain WHY each flight matches the traveler's DNA using natural, traveler-friendly language.

RULES FOR EXPLANATIONS:
- Frame explanations around the Traveler Traits provided.
- Reference Flight Match Factors (airline, stops, timing, etc.) as supporting detail.
- NEVER expose raw preference percentages or scores.
- NEVER expose confidence values.
- NEVER use phrases like "X Preferred" or "matches preference".
- NEVER expose ranking logic or internal mechanics.
- Return EXACTLY 3 concise, human-friendly matchReasons per card.
- Each reason should feel like premium travel intelligence, not a rule checklist.

CRITICAL ACCURACY RULE:
- Each flight card includes fare policy data (e.g., "refundable, changeable" or "non-refundable, non-changeable").
- You MUST use the EXACT fare policy from the card data. NEVER contradict it.
- If a card says "non-refundable, non-changeable", do NOT say it is changeable.
- If a card says "refundable, changeable", do NOT say it is non-refundable.
- When mentioning flexibility or planning traits, describe the ACTUAL fare policy accurately.

PRIORITY ORDER for reasons:
1. Travel Style Traits (Value Conscious, Comfort, etc.)
2. Convenience Traits (nonstop, timing, duration)
3. Airline Loyalty
4. Family / Solo / Party Traits
5. Protection & Planning Traits
6. Cultural Traits

GOOD EXAMPLES:
✓ "Minimizes travel complexity with a convenient nonstop itinerary"
✓ "Includes one of your frequently chosen airlines"
✓ "Aligns with your value-conscious travel style"
✓ "Matches your typical morning departure pattern"
✓ "Fits your preference for streamlined, no-frills travel"

BAD EXAMPLES:
✗ "American Airlines Preferred"
✗ "Economy Preferred"
✗ "Nonstop Preferred"
✗ "Confidence 92%"
✗ "Matches 3 of 5 preferences"

Scoring guide:
- 90-100: The flight closely aligns with most or all DNA traits
- 80-89: Strong alignment with most traits, minor mismatches
- 70-79: Moderate alignment, some key traits unmet
- 50-69: Weak alignment, several key traits unmet
- Below 50: Poor alignment with traveler DNA

Return valid JSON only:
{
  "cards": [
    {
      "cardId": "<exact flight_id>",
      "dnaScore": 78,
      "matchReasons": [
        "Minimizes travel complexity with a convenient nonstop itinerary",
        "Includes one of your frequently chosen airlines",
        "Aligns with your value-conscious travel style"
      ],
      "mismatchReasons": []
    }
  ]
}`;
