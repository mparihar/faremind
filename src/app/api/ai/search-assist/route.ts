import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropicClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  if (!openaiClient && !anthropicClient) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  const body = await req.json();
  const { query, flights, context } = body as {
    query: string;
    flights: Array<{
      id: string;
      airline: { name: string; code: string };
      segments: Array<{
        departure: { airport: string; time: string };
        arrival: { airport: string; time: string };
        flightNumber: string;
      }>;
      totalPrice: number;
      currency: string;
      totalDuration: number;
      stops: number;
      cabinClass: string;
      baggage: { carryOn: number; checked: number };
      fareRules: { refundable: boolean; changeable: boolean };
      tags?: string[];
    }>;
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

  const topFlights = flights.slice(0, 10);

  const flightSummaries = topFlights.map((f, i) => {
    const dep = f.segments[0]?.departure;
    const arr = f.segments[f.segments.length - 1]?.arrival;
    const depTime = dep?.time ? new Date(dep.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';
    const arrTime = arr?.time ? new Date(arr.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';
    const hrs = Math.floor(f.totalDuration / 60);
    const mins = f.totalDuration % 60;
    return `${i + 1}. ID:${f.id} | ${f.airline.name} | ${depTime}→${arrTime} | ${hrs}h${mins}m | ${f.stops === 0 ? 'Nonstop' : `${f.stops} stop(s)`} | $${f.totalPrice} | ${f.cabinClass} | carry-on:${f.baggage.carryOn > 0 ? 'yes' : 'no'} checked:${f.baggage.checked} | refundable:${f.fareRules.refundable ? 'yes' : 'no'}`;
  });

  const systemPrompt = `You are FAREMIND AI, a premium aviation travel intelligence assistant. You give expert, conversational flight recommendations like a luxury travel concierge — not a support bot.

Analyze the provided flights and respond to the traveler's request with:
1. A warm, intelligent 1–2 sentence recommendation explaining the best choice
2. Reordering of the flight IDs by best match to the query
3. A short reason (≤10 words) for each flight — specific, factual, not generic
4. A concise AI badge label (≤4 words) for the top 3–4 flights
5. Top 3–5 bullet reasons WHY the #1 recommendation is best

Badge examples: "AI Family Pick", "Best Comfort Option", "Fewest Stops", "Top Baggage Value", "Easiest Connection", "Reliable Airline", "Best Overall", "Great Value Pick"

Return valid JSON exactly:
{
  "message": "1-2 sentence warm conversational recommendation",
  "rankedIds": ["id1", "id2", ...],
  "reasoning": { "id1": "≤10 word reason", ... },
  "badges": { "id1": "badge label", "id2": "badge label" },
  "topReasons": ["reason1", "reason2", "reason3"]
}

Rules:
- Only reorder existing flights — never invent prices or availability
- Be specific about WHY (e.g. "nonstop morning departure", "2h layover in Frankfurt")
- Keep badge labels short and exciting, not robotic
- topReasons are about the #1 pick only`;

  const userPrompt = `Route: ${context.origin} → ${context.destination} | ${context.tripType.replace('_', ' ')} | ${context.passengers} pax | ${context.departureDate}

Traveler request: "${query}"

Available flights (top 10, already deterministically ranked):
${flightSummaries.join('\n')}`;

  try {
    const provider = process.env.AI_PROVIDER || 'openai';
    const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    let raw = '{}';

    if (provider === 'anthropic') {
      if (!anthropicClient) throw new Error('Anthropic client not configured');
      const response = await anthropicClient.messages.create({
        model: model,
        max_tokens: 1000,
        temperature: 0.4,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });
      const textBlock = response.content.find(c => c.type === 'text');
      raw = textBlock?.type === 'text' ? textBlock.text : '{}';
      
      raw = raw.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    } else {
      if (!openaiClient) throw new Error('OpenAI client not configured');
      const completion = await openaiClient.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 1000,
      });
      raw = completion.choices[0]?.message?.content ?? '{}';
    }

    const result = JSON.parse(raw);

    return NextResponse.json({
      message:    result.message ?? '',
      rankedIds:  result.rankedIds ?? [],
      reasoning:  result.reasoning ?? {},
      badges:     result.badges ?? {},
      topReasons: result.topReasons ?? [],
    });
  } catch (err: any) {
    console.error('[ai/search-assist] error:', err);
    return NextResponse.json({ error: err.message ?? 'AI error' }, { status: 500 });
  }
}
