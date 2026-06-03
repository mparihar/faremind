import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';
import { matchProfile } from '@/lib/intent-profiles';
import { normalizeFlightCards, type FareMindFlightCard } from '@/lib/normalize-flights';
import { ALLOWED_WEIGHT_KEYS, sanitizeWeights, type DynamicProfile } from '@/lib/dynamic-profile';
import type { UnifiedFlight } from '@/lib/types';

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropicClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── Card serializer (compact, semantically rich) ──────────────────────────────

function serializeCard(c: FareMindFlightCard, i: number): string {
  const dep = new Date(c.departure_time_local);
  const arr = new Date(c.arrival_time_local);
  const depStr = isNaN(dep.getTime()) ? 'N/A'
    : dep.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const arrStr = isNaN(arr.getTime()) ? 'N/A'
    : arr.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const dur = `${Math.floor(c.total_duration_minutes / 60)}h${c.total_duration_minutes % 60}m`;
  const bags = c.checked_bags > 0 ? `checked:${c.checked_bags}` : c.carry_on_bags > 0 ? 'carry-on only' : 'no bags';
  const stops = c.stops === 0 ? 'nonstop'
    : `${c.stops} stop(s) max-per-leg${c.connection_airports.length ? ` via ${c.connection_airports.join(',')}` : ''}`;
  const flags: string[] = [];
  if (c.overnight_layover) flags.push('overnight-layover');
  if (c.airport_change)    flags.push('airport-change');
  if (c.is_red_eye)        flags.push('red-eye');
  if (c.refundable)        flags.push('refundable');
  if (c.layover_minutes > 0) flags.push(`layover:${c.layover_minutes}min`);
  const scores = [
    `walk:${c.walking_complexity_score}`,
    `stress:${c.airport_stress_score}`,
    `family:${c.family_friendliness_score}`,
    `access:${c.wheelchair_friendliness_score}`,
    `rely:${c.airline_reliability_score}`,
  ].join(' ');
  const providerLabel = c.provider === 'duffel' ? 'provider:duffel-NDC' : `provider:${c.provider}`;
  // flight_id is quoted so GPT cannot confuse it with the sequence number
  return `[${i + 1}] flight_id="${c.card_id}" | ${c.airline} (${c.airline_code}) | ${providerLabel} | ${depStr}→${arrStr} | ${dur} | ${stops} | $${c.price} ${c.currency} | ${c.cabin} | ${bags}${flags.length ? ' | ' + flags.join(' ') : ''} | ${scores} | score:${c.ai_score}`;
}

// ── Build system prompt ───────────────────────────────────────────────────────

function buildSystemPrompt(hasDynamicExtraction: boolean): string {
  const extractionBlock = hasDynamicExtraction ? `
STAGE 1 — Dynamic Intent Extraction:
Analyze the user prompt and extract structured travel preference semantics.
Generate a dynamic_profile with intent categories and preference weights.

Allowed weight keys (ONLY use these — never invent new keys):
${ALLOWED_WEIGHT_KEYS.join(', ')}

Weight convention: positive = prioritize, negative = penalize (range: -1.0 to +1.0)

Allowed intent_categories examples:
mobility_assistance, family_travel, stress_reduction, comfort_priority,
budget_priority, minimal_transfers, elderly_travel, business_efficiency,
sleep_optimization, baggage_priority, airport_simplicity, tight_schedule, premium_comfort

` : `
STAGE 1 — Profile already matched from static library. Skip extraction.
`;

  return `You are FAREMIND AI, an intelligent aviation travel assistant.
${extractionBlock}
STAGE 2 — Card Filtering & Ranking:
Using the extracted (or provided) preference profile, filter and rank the provided flight cards.
Your job is to find the BEST 5 flights that suit the traveler's SPECIFIC preference.

CRITICAL RULE — EXACTLY 5 PREFERENCE-SPECIFIC PICKS:
- You MUST ALWAYS include EXACTLY 5 cards in recommended_order, ranked from best fit (#1) to 5th best fit (#5) for the SPECIFIC preference the traveler asked about.
- Each card MUST have 2–4 bullet reasons that DIRECTLY explain why THIS flight suits THIS specific preference. Generic reasons like "good price" are NOT enough — tie every reason to the preference.
- Example for "Best for Family": "Nonstop flight eliminates stressful connections with young children", "Checked baggage included — no need to carry kids' gear through terminals"
- Example for "Reliable Airline": "British Airways has 87% on-time record on this route", "Full-service carrier with dedicated customer support"
- Example for "Short Connections": "Only 1h 15min layover at LAX — quick and stress-free", "Same terminal connection, no bus transfer needed"
- NEVER return fewer than 5 cards. If fewer than 5 qualify strongly, include the NEXT BEST options and note trade-offs.
- NEVER say "no suitable flights found". There are ALWAYS options to recommend.

PREFERENCE-SPECIFIC RANKING RULES:
- "Best for Family" / "Children" / "Kids": Rank by: fewest stops > checked bags included > no red-eye > shorter duration > family score > no airport change
- "Elderly Parents" / "Mobility": Rank by: fewest stops > shortest walking > generous layover (2h+) > no airport change > wheelchair score > daytime departure
- "Cheapest Nonstop + Bags": Rank by: nonstop FIRST > lowest price > checked bags included > carry-on included
- "Comfortable Overnight": Rank by: evening departure > morning arrival > no midnight layovers > longer uninterrupted segments > reliable airline
- "Better Baggage": Rank by: most checked bags > carry-on included > full-service airline > not basic economy
- "Reliable Airline": Rank by: airline reliability score > on-time performance > full-service carrier > fewer stops
- "Short Connections": Rank by: shortest layover time > same terminal > fewest stops > no airport change
- "No Overnight Layovers": Rank by: no overnight layover flag > daytime connections only > shortest total duration
- "Avoid Stressful Layovers": Rank by: fewest stops > shortest layover > no airport change > stress score > major hub airports

For each preference, the #1 pick should be the absolute BEST match. The summary should explicitly mention the preference (e.g., "Here are the 5 best family-friendly options for your route").

FAMILY & COMFORT QUERIES (soft preferences, NOT hard filters):
When the traveler asks about "family", "children", "kids", "elderly", "comfort", "easy travel":
- These are SOFT PREFERENCES — rank by suitability, do NOT exclude flights
- Prefer: nonstop or fewest stops, shorter total duration, checked baggage included, reasonable departure times (not red-eye), higher family/comfort scores
- Penalize but do NOT exclude: airport changes, overnight layovers, very long layovers, red-eye flights

HARD FILTERS (apply these strictly ONLY when explicitly stated):
- AIRLINE (hard filter — absolute): if the traveler names a specific airline (e.g. "Lufthansa", "Qatar"), EVERY card whose airline field does not exactly match MUST be excluded
- STOPS (hard filter): "N stops" means AT MOST N stops — nonstop always qualifies; cards exceeding N stops must be excluded
- PROVIDER (hard filter): "duffel" means include only cards tagged provider:duffel-NDC; all others excluded
- PRICE (soft sort only): "cheapest" ranks matching cards by lowest price — it does NOT override hard filters

GENERAL RULES:
- NEVER invent flights, prices, baggage policies, or airline facts
- Be specific (e.g. "nonstop morning flight", "2h layover via YYZ")
- Badge labels ≤ 4 words (e.g. "Best for Family", "Easiest Journey", "Most Comfortable")
- All hard filters combine with AND logic — a card must satisfy every hard filter to appear in recommended_order
- Give each of the 5 cards a UNIQUE badge that describes why it's good for this preference (e.g. "#1 Family Pick", "Easiest Journey", "Best Baggage Value")

IMPORTANT: Each card line starts with [N] flight_id="<value>" — use EXACTLY the quoted <value> string as the id in recommended_order, reasoning, and badges. Never use the sequence number [N].

Return valid JSON only:
{
  "dynamic_profile": {
    "intent_summary": "brief description of what the traveler needs",
    "intent_categories": ["category1", "category2"],
    "weights": { "walking_complexity": -1.0, "stops": -0.9 },
    "reasoning_focus": ["key factor 1", "key factor 2"]
  },
  "preference_label": "Best for Family",
  "recommended_order": ["<flight_id value>", "<flight_id value>", "<flight_id value>", "<flight_id value>", "<flight_id value>"],
  "reasoning": {
    "<flight_id value>": ["preference-specific reason 1", "preference-specific reason 2", "preference-specific reason 3"]
  },
  "summary": "Here are the 5 best [preference] options for your route. [1-2 sentence warm summary]",
  "badges": { "<flight_id value>": "unique badge for this preference" }
}`;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!openaiClient && !anthropicClient) return NextResponse.json({ error: 'AI not configured' }, { status: 503 });

  const body = await req.json();
  const { query, flights, context } = body as {
    query: string;
    flights: UnifiedFlight[];
    context: {
      origin: string;
      destination: string;
      tripType: string;
      passengers: number;
      departureDate: string;
    };
  };

  if (!query?.trim() || !flights?.length) {
    return NextResponse.json({ error: 'Missing query or flights' }, { status: 400 });
  }

  const poolSize    = parseInt(process.env.NEXT_PUBLIC_AI_CHATBOT_POOL_SIZE ?? '30', 10);
  const cardPool    = flights.slice(0, poolSize);
  const staticMatch = matchProfile(query);
  const cards       = normalizeFlightCards(cardPool);
  const cardLines   = cards.map((c, i) => serializeCard(c, i));

  // When static profile matched, embed it as context; otherwise let GPT extract dynamically
  const hasDynamicExtraction = !staticMatch;

  const profileContext = staticMatch
    ? `\nMatched static profile: "${staticMatch.label}"\nGuidance: ${staticMatch.gpt_guidance}\nProfile weights: ${Object.entries(staticMatch.weights).map(([k, v]) => `${k}=${v}`).join(', ')}`
    : '\nNo static profile matched — extract dynamic profile from user intent.';

  const systemPrompt = buildSystemPrompt(hasDynamicExtraction);

  const userPrompt = `Route: ${context.origin} → ${context.destination} | ${context.tripType.replace('_', ' ')} | ${context.passengers} pax | ${context.departureDate}

Traveler request: "${query}"
${profileContext}

Flight cards (deterministically pre-ranked, up to ${poolSize}):
${cardLines.join('\n')}`;

  try {
    const provider = process.env.AI_PROVIDER || 'openai';
    const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    let raw = '{}';

    if (provider === 'anthropic') {
      if (!anthropicClient) throw new Error('Anthropic client not configured');
      const response = await anthropicClient.messages.create({
        model: model,
        max_tokens: Math.max(1600, poolSize * 80),
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });
      const textBlock = response.content.find(c => c.type === 'text');
      raw = textBlock?.type === 'text' ? textBlock.text : '{}';
      
      // Sometimes Claude wraps JSON in markdown block, clean it up
      raw = raw.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    } else {
      if (!openaiClient) throw new Error('OpenAI client not configured');
      const completion = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: Math.max(1600, poolSize * 80),
      });
      raw = completion.choices[0]?.message?.content ?? '{}';
    }

    const result = JSON.parse(raw);

    // Validate recommended_order: only keep IDs that actually exist in the card pool
    const validIdSet = new Set(cards.map(c => c.card_id));
    const rawOrder: string[] = result.recommended_order ?? [];
    let validatedOrder = rawOrder.filter((id: string) => validIdSet.has(id));

    // Hard airline filter: if the query mentions a known airline name, enforce it server-side
    // so GPT slippage can never surface a wrong airline
    const cardById = new Map(cards.map(c => [c.card_id, c]));
    const queryLower = query.toLowerCase();
    const KNOWN_AIRLINES = ['lufthansa', 'emirates', 'qatar', 'air india', 'british airways',
      'air canada', 'american', 'united', 'delta', 'iberia', 'klm', 'air france',
      'swiss', 'turkish', 'singapore', 'cathay', 'etihad', 'virgin', 'jetblue'];
    const mentionedAirline = KNOWN_AIRLINES.find(a => queryLower.includes(a));
    if (mentionedAirline) {
      const airlineFiltered = validatedOrder.filter(id => {
        const card = cardById.get(id);
        return card && card.airline.toLowerCase().includes(mentionedAirline);
      });
      if (airlineFiltered.length > 0) validatedOrder = airlineFiltered;
    }

    // If GPT returned 0 valid IDs (bad parse / hallucinated IDs), fall back to full card order
    const finalOrder = validatedOrder.length > 0 ? validatedOrder : cards.map(c => c.card_id);

    // Normalize reasoning: GPT may return string or string[] per card
    const reasoning: Record<string, string[]> = {};
    for (const [id, val] of Object.entries(result.reasoning ?? {})) {
      reasoning[id] = Array.isArray(val) ? (val as string[]) : [val as string];
    }

    // Build and sanitize the dynamic profile
    const rawDynamic = result.dynamic_profile ?? {};
    const dynamicProfile: DynamicProfile = {
      dynamic_profile_id: rawDynamic.intent_summary
        ? `dyn_${Date.now()}`
        : (staticMatch?.id ?? 'unknown'),
      intent_summary: rawDynamic.intent_summary ?? staticMatch?.label ?? query,
      intent_categories: Array.isArray(rawDynamic.intent_categories)
        ? rawDynamic.intent_categories
        : [],
      weights: sanitizeWeights(rawDynamic.weights ?? staticMatch?.weights ?? {}),
      reasoning_focus: Array.isArray(rawDynamic.reasoning_focus)
        ? rawDynamic.reasoning_focus
        : [],
      source: staticMatch ? 'static_match' : 'dynamic_extraction',
    };

    // Fire-and-forget logging (non-blocking)
    logDynamicProfile({
      userPrompt: query,
      profileId: staticMatch?.id ?? null,
      dynamicProfile,
      rankedIds: finalOrder,
    }).catch(() => { /* observability only */ });

    // Safety: override negative AI messages
    let message = result.summary ?? result.message ?? '';
    const negativePhrases = ['no suitable', 'no options', 'not available', 'no flights', 'none of the', 'unfortunately'];
    if (negativePhrases.some(p => message.toLowerCase().includes(p)) && finalOrder.length > 0) {
      message = `Here are the best options for your needs on this route. I've ranked them by suitability based on your preferences.`;
    }

    // Ensure every recommended card has reasoning
    for (const id of finalOrder) {
      if (!reasoning[id] || reasoning[id].length === 0) {
        const card = cardById.get(id);
        if (card) {
          reasoning[id] = [];
          if (card.stops === 0) reasoning[id].push('Nonstop flight — no connections needed');
          else reasoning[id].push(`${card.stops} stop(s) — ${card.connection_airports.length ? 'via ' + card.connection_airports.join(', ') : 'connecting flight'}`);
          if (card.checked_bags > 0) reasoning[id].push('Includes checked baggage');
          if (card.family_friendliness_score >= 7) reasoning[id].push('High family-friendliness score');
          reasoning[id].push(`${Math.floor(card.total_duration_minutes / 60)}h ${card.total_duration_minutes % 60}m total travel time`);
        }
      }
    }

    return NextResponse.json({
      message,
      rankedIds:        finalOrder,
      reasoning,
      badges:           result.badges ?? {},
      preferenceLabel:  result.preference_label ?? staticMatch?.label ?? null,
      profileId:        staticMatch?.id ?? null,
      intentSummary:    dynamicProfile.intent_summary,
      intentCategories: dynamicProfile.intent_categories,
      reasoningFocus:   dynamicProfile.reasoning_focus,
      source:           dynamicProfile.source,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'AI error';
    console.error('[ai/intent-engine] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Async observability logger ────────────────────────────────────────────────

async function logDynamicProfile(data: {
  userPrompt: string;
  profileId: string | null;
  dynamicProfile: DynamicProfile;
  rankedIds: string[];
}) {
  try {
    await (prisma as any).aiDynamicProfile.create({
      data: {
        userPrompt:        data.userPrompt,
        profileId:         data.profileId,
        intentSummary:     data.dynamicProfile.intent_summary,
        intentCategories:  data.dynamicProfile.intent_categories,
        weightsJson:       data.dynamicProfile.weights as object,
        reasoningFocus:    data.dynamicProfile.reasoning_focus,
        rankedIdsJson:     data.rankedIds as unknown as object,
        source:            data.dynamicProfile.source,
      },
    });
  } catch {
    // Logging failure must never break the main response
  }
}
