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
  type DnaCardResult,
  type DnaSearchResult,
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
    console.log(`[DNA Search] Profile generated for ${userId}: status=${genResult.status}, bookings=${genResult.confirmedBookingCount}, profiles=`, Object.entries(genResult.profiles || {}).map(([k, v]: [string, any]) => `${k}:${v?.status}(${v?.confirmedBookingCount}/${v?.minBookingsRequired})`).join(', '));
  } catch (genErr) {
    console.warn('[DNA Search] Profile generation skipped:', genErr instanceof Error ? genErr.message : genErr);
  }

  // ── Load DNA profile (strict category match) ──────────────────────────────
  console.log(`[DNA Search] Loading ${tripCategory} DNA profile for user ${userId}`);
  const dnaContext = await getTravelDnaForRecommendation(userId, tripCategory);
  console.log(`[DNA Search] Profile result: active=${dnaContext.active}, prefCategories=${Object.keys(dnaContext.preferences || {}).length}`);

  if (!dnaContext.active || !dnaContext.preferences || Object.keys(dnaContext.preferences).length === 0) {
    console.log(`[DNA Search] ${tripCategory} DNA profile not active for user ${userId}`);
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

  // ── Derive Traveler Traits + Serialize for GPT ─────────────────────────
  const dnaConfig = await getTravelDnaConfig();
  const topN = dnaConfig.dnaSearchTopN ?? 30;

  // Derive high-level traveler traits from raw preferences
  const travelerTraits = deriveTravelerTraits(dnaContext.preferences);
  const traitsText = serializeTraitsForGpt(travelerTraits);
  console.log(`[DNA Search] Derived ${travelerTraits.length} traits:`, travelerTraits.map(t => `${t.traitName}(${t.confidence}%)`).join(', '));

  const topCards = flights.slice(0, topN);
  const cardLines = topCards.map((f, i) => serializeCardForDna(f, i));

  const userPrompt = `Traveler Traits:
${traitsText}

Flight Match Factors (already AI-ranked, top ${topCards.length}):
${cardLines.join('\n')}

For each flight card, assign a dnaScore (0-100) and provide exactly 3 concise, traveler-friendly matchReasons that explain why this flight matches the traveler's DNA traits. Do not use raw preference names.`;

  try {
    const provider = process.env.AI_PROVIDER || 'openai';
    const model = process.env.AI_DNA_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';
    let raw = '{}';

    if (provider === 'anthropic') {
      if (!anthropicClient) throw new Error('Anthropic client not configured');
      const response = await anthropicClient.messages.create({
        model,
        max_tokens: 4000,
        temperature: 0.2,
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
        temperature: 0.2,
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

    console.log(`[DNA Search] Evaluated ${topCards.length} cards for user ${userId}, top DNA score: ${rankedResults[0]?.dnaScore ?? 0}`);

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'DNA Search error';
    console.error('[ai/dna-search] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
