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
    const dnaScore = dnaResult?.dnaScore ?? 50; // default 50 if GPT missed the card
    const finalDnaScore = computeHybridScore(card.aiScore, dnaScore);

    return {
      cardId: card.cardId,
      providerOfferId: card.providerOfferId,
      aiScore: card.aiScore,
      dnaScore,
      finalDnaScore,
      matchReasons: dnaResult?.matchReasons ?? [],
      mismatchReasons: dnaResult?.mismatchReasons ?? [],
      dnaMatchLabel: getDnaMatchLabel(dnaScore),
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

// ── GPT System Prompt ────────────────────────────────────────────────────────

export const DNA_SEARCH_SYSTEM_PROMPT = `You are FareMind DNA Matching Engine.

The flight options provided have already been ranked and scored by FareMind's core ranking engine.

Do NOT evaluate:
- Price competitiveness
- Overall flight quality
- Provider quality
- Airline quality
- General ranking

These have already been evaluated.

Your sole responsibility is to determine how closely each flight option matches the traveler's DNA profile.

For each flight card, return:
- dnaScore: 0-100 (100 = perfect DNA match)
- matchReasons: array of 1-3 short reasons why this flight matches the DNA (e.g. "Preferred airline", "Direct flight matches nonstop preference")
- mismatchReasons: array of 0-2 short reasons for any DNA mismatch (e.g. "Evening departure, traveler prefers morning")

Scoring guide:
- 90-100: The flight closely aligns with most or all DNA preferences
- 80-89: Strong alignment with most preferences, minor mismatches
- 70-79: Moderate alignment, some key preferences unmet
- 50-69: Weak alignment, several key preferences unmet
- Below 50: Poor alignment with traveler DNA

Return valid JSON only:
{
  "cards": [
    {
      "cardId": "<exact flight_id>",
      "dnaScore": 94,
      "matchReasons": ["Preferred airline", "Direct flight"],
      "mismatchReasons": ["Slightly above preferred budget"]
    }
  ]
}`;
