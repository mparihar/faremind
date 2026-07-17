import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getTravelDnaForRecommendation, generateTravelDnaProfile, getTravelDnaConfig } from '@/lib/services/travel-dna-service';
import {
  DNA_SEARCH_SYSTEM_PROMPT,
  serializeDnaProfile,
  computeHybridScores,
  buildDnaCacheKey,
  getCachedDnaResult,
  setCachedDnaResult,
  extractTopPreferences,
  matchCardAgainstPreferences,
  generateFallbackReasons,
  serializeMatchedFactsForGpt,
  type DnaCardResult,
  type DnaSearchResult,
  type MatchedPreferenceFact,
} from '@/lib/services/dna-search-service';
import { deriveTravelerTraits, serializeTraitsForGpt } from '@/lib/services/dna-traits-service';
import type { UnifiedFlight } from '@/lib/types';

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropicClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Compact card serializer for DNA evaluation ──────────────────────────────

function serializeCardForDna(flight: UnifiedFlight, index: number): string {
  const first = flight.segments[0];
  const last = flight.segments[flight.segments.length - 1];
  const dep = first ? new Date(first.departure.time) : null;
  const arr = last ? new Date(last.arrival.time) : null;
  const depStr = dep && !isNaN(dep.getTime())
    ? dep.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : 'N/A';
  const arrStr = arr && !isNaN(arr.getTime())
    ? arr.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    : 'N/A';
  const dur = `${Math.floor(flight.totalDuration / 60)}h${flight.totalDuration % 60}m`;
  const stops = flight.stops === 0 ? 'nonstop' : `${flight.stops} stop(s)`;
  const bags = flight.baggage.checked > 0
    ? `checked:${flight.baggage.checked}`
    : flight.baggage.carryOn > 0 ? 'carry-on only' : 'no bags';
  const flex = [
    flight.fareRules.refundable ? 'refundable' : 'non-refundable',
    flight.fareRules.changeable ? 'changeable' : 'non-changeable',
  ].join(', ');

  return `[${index + 1}] flight_id="${flight.id}" | ${flight.airline.name} (${flight.airline.code}) | ${depStr}→${arrStr} | ${dur} | ${stops} | $${flight.totalPrice} ${flight.currency} | ${flight.cabinClass} | ${bags} | ${flex} | ai_score:${flight.valueScore}`;
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!openaiClient && !anthropicClient) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const body = await req.json();
  const {
    flights,
    userId,
    searchSessionId,
    tripCategory = 'DOMESTIC',
  } = body as {
    flights: UnifiedFlight[];
    userId?: string;
    searchSessionId?: string;
    tripCategory?: 'DOMESTIC' | 'INTERNATIONAL';
  };

  if (!flights?.length) {
    return NextResponse.json({ error: 'No flights provided' }, { status: 400 });
  }

  if (!userId) {
    return NextResponse.json(
      { eligible: false, reason: 'Sign in to use DNA Search', results: [], searchSessionId: '', cached: false } satisfies DnaSearchResult,
    );
  }

  // ── Generate DNA profile on-demand (creates/updates if not yet generated) ──
  try {
    const genResult = await generateTravelDnaProfile(userId);
  } catch (genErr) {
    console.warn('[DNA Search] Profile generation skipped:', genErr instanceof Error ? genErr.message : genErr);
  }

  // ── Load DNA profile (strict category match) ──────────────────────────────
  const dnaContext = await getTravelDnaForRecommendation(userId, tripCategory);

  if (!dnaContext.active || !dnaContext.preferences || Object.keys(dnaContext.preferences).length === 0) {
    return NextResponse.json({
      eligible: false,
      reason: `Your ${tripCategory.toLowerCase()} FareMind DNA profile is still learning. Complete more ${tripCategory.toLowerCase()} bookings to unlock DNA Search.`,
      results: [],
      searchSessionId: searchSessionId || '',
      cached: false,
    } satisfies DnaSearchResult);
  }

  // ── Check cache ─────────────────────────────────────────────────────────
  const sessionId = searchSessionId || `sess_${Date.now()}`;
  const dnaVersion = `v_${Object.keys(dnaContext.preferences).length}`;
  const cacheKey = buildDnaCacheKey(sessionId, userId, dnaVersion);
  const cached = getCachedDnaResult(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  // ── Derive Traveler Traits + Extract Top Preferences ────────────────────
  const dnaConfig = await getTravelDnaConfig();
  const topN = dnaConfig.dnaSearchTopN ?? 30;

  // Derive high-level traveler traits from raw preferences
  const travelerTraits = deriveTravelerTraits(dnaContext.preferences);
  const traitsText = serializeTraitsForGpt(travelerTraits);

  // ── Step 1: Extract top 12 strongest DNA preferences ─────────────────────
  const topPrefs = extractTopPreferences(dnaContext.preferences, 12);

  const topCards = flights.slice(0, topN);

  // ── Step 2: Match each card against top preferences deterministically ────
  const cardMatchData: Array<{
    cardId: string;
    airlineName: string;
    matchedFacts: MatchedPreferenceFact[];
  }> = topCards.map(f => {
    const first = f.segments[0];
    const dep = first ? new Date(first.departure.time) : null;
    const depHour = dep && !isNaN(dep.getTime()) ? dep.getHours() : 8;

    const matched = matchCardAgainstPreferences({
      id: f.id,
      airlineCode: f.airline.code,
      airlineName: f.airline.name,
      stops: f.stops,
      departureHour: depHour,
      cabinClass: f.cabinClass,
      baggageChecked: f.baggage.checked,
      refundable: f.fareRules.refundable,
      changeable: f.fareRules.changeable,
    }, topPrefs);

    return {
      cardId: f.id,
      airlineName: f.airline.name,
      matchedFacts: matched,
    };
  });

  // Log match summary
  const matchSummary = cardMatchData.slice(0, 5).map(c =>
    `${c.cardId.slice(0, 8)}...(${c.matchedFacts.length} matches: ${c.matchedFacts.map(f => f.preferenceKey).join(',')})`
  );

  // ── Step 3: Build GPT prompt with matched facts ──────────────────────────
  const traitNames = travelerTraits.map(t => t.traitName);
  const matchedFactsPrompt = serializeMatchedFactsForGpt(cardMatchData, traitNames);

  // Also include card flight details for dnaScore calculation
  const cardLines = topCards.map((f, i) => serializeCardForDna(f, i));

  const userPrompt = `${matchedFactsPrompt}

Flight card details (for dnaScore calculation, already AI-ranked, top ${topCards.length}):
${cardLines.join('\n')}

For each card:
1. Assign a dnaScore (0-100) based on overall DNA alignment with the traveler traits.
2. Rewrite ONLY the matchedPreferenceFacts for that card into natural, varied, traveler-friendly matchReasons.
3. Do NOT invent reasons beyond the matched facts. If a card has 0 facts, return an empty matchReasons array.
4. Ensure reasons use different wording across cards even when the same preference type matches.`;

  try {
    const provider = process.env.AI_PROVIDER || 'openai';
    const model = process.env.AI_DNA_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';
    let raw = '{}';

    if (provider === 'anthropic') {
      if (!anthropicClient) throw new Error('Anthropic client not configured');
      const response = await anthropicClient.messages.create({
        model,
        max_tokens: 4000,
        temperature: 0.3,
        system: DNA_SEARCH_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      const textBlock = response.content.find(c => c.type === 'text');
      raw = textBlock?.type === 'text' ? textBlock.text : '{}';
      raw = raw.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    } else {
      if (!openaiClient) throw new Error('OpenAI client not configured');
      const completion = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: DNA_SEARCH_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 4000,
      });
      raw = completion.choices[0]?.message?.content ?? '{}';
    }

    const parsed = JSON.parse(raw);
    const gptCards: DnaCardResult[] = (parsed.cards ?? []).map((c: any) => ({
      cardId: c.cardId ?? c.card_id ?? '',
      dnaScore: typeof c.dnaScore === 'number' ? Math.min(100, Math.max(0, c.dnaScore)) : 50,
      matchReasons: Array.isArray(c.matchReasons) ? c.matchReasons : [],
      mismatchReasons: Array.isArray(c.mismatchReasons) ? c.mismatchReasons : [],
    }));

    // Validate — only keep results for cards that actually exist
    const validIds = new Set(topCards.map(f => f.id));
    const validGptCards = gptCards.filter(c => validIds.has(c.cardId));

    // ── Fallback: For cards GPT missed, use deterministic reasons ──────────
    const gptCardIds = new Set(validGptCards.map(c => c.cardId));
    const matchDataMap = new Map(cardMatchData.map(c => [c.cardId, c]));

    for (const card of topCards) {
      if (gptCardIds.has(card.id)) continue;
      const matchData = matchDataMap.get(card.id);
      if (matchData && matchData.matchedFacts.length > 0) {
        validGptCards.push({
          cardId: card.id,
          dnaScore: 50, // conservative score for GPT-missed cards
          matchReasons: generateFallbackReasons(matchData.matchedFacts),
          mismatchReasons: [],
        });
      }
    }

    // Build AI score map from the cards
    const aiCards = topCards.map(f => ({
      cardId: f.id,
      aiScore: f.valueScore,
      providerOfferId: (f as any).providerOfferId,
    }));

    // Compute hybrid scores
    const rankedResults = computeHybridScores(aiCards, validGptCards);

    const result: DnaSearchResult = {
      eligible: true,
      results: rankedResults,
      searchSessionId: sessionId,
      cached: false,
      dnaSearchTopN: topN,
    };

    // Cache the result
    setCachedDnaResult(cacheKey, result);

    return NextResponse.json(result);
  } catch (err: unknown) {
    // ── Complete GPT failure — use deterministic fallback for all cards ────
    const msg = err instanceof Error ? err.message : 'DNA Search error';
    console.error('[ai/dna-search] GPT error, using deterministic fallback:', msg);

    const fallbackCards: DnaCardResult[] = cardMatchData.map(c => ({
      cardId: c.cardId,
      dnaScore: Math.min(100, Math.max(0, c.matchedFacts.length * 15 + 25)),
      matchReasons: generateFallbackReasons(c.matchedFacts),
      mismatchReasons: [],
    }));

    const aiCards = topCards.map(f => ({
      cardId: f.id,
      aiScore: f.valueScore,
      providerOfferId: (f as any).providerOfferId,
    }));

    const rankedResults = computeHybridScores(aiCards, fallbackCards);

    const result: DnaSearchResult = {
      eligible: true,
      results: rankedResults,
      searchSessionId: sessionId,
      cached: false,
      dnaSearchTopN: topN,
    };

    setCachedDnaResult(cacheKey, result);

    return NextResponse.json(result);
  }
}
