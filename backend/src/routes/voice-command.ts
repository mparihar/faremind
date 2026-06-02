/**
 * FareMind Travel Assistant — Fastify Voice Command Route
 *
 * POST /api/voice/parse-command
 *
 * Accepts a speech-to-text transcript + page context and uses GPT-4o Mini
 * to parse it into a structured action command.
 *
 * Phase 1: HOME_SEARCH context with SEARCH_FLIGHTS action.
 * Phase 2: PASSENGER_DETAILS context with FILL_PASSENGER_DETAILS / FILL_PRIMARY_CONTACT.
 */

import { FastifyPluginAsync } from 'fastify';
import OpenAI from 'openai';

// ─── OpenAI client (lazy init) ──────────────────────────────────────────────

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

// ─── Page contexts and their supported actions ──────────────────────────────

const PAGE_ACTIONS: Record<string, string[]> = {
  HOME_SEARCH: ['SEARCH_FLIGHTS'],
  PASSENGER_DETAILS: ['FILL_PASSENGER_DETAILS', 'FILL_PRIMARY_CONTACT', 'CLARIFY'],
};

// ─── System prompts ─────────────────────────────────────────────────────────

function buildSearchSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  return `You are FareMind Travel Assistant.

Convert travel voice commands into structured JSON actions.

Return JSON only.

Today's date is ${today}. Use this to resolve relative dates like "next Friday", "tomorrow", "next week", etc.

Supported Phase 1 Action:
SEARCH_FLIGHTS

Supported Fields:
origin — 3-letter IATA airport code (e.g. DFW, JFK, LAX, LHR, BKK, DEL)
destination — 3-letter IATA airport code
departureDate — YYYY-MM-DD format
returnDate — YYYY-MM-DD format (null if one-way or not mentioned)
tripType — "ROUND_TRIP" or "ONE_WAY"
adults — integer, default 1
children — integer, default 0
infants — integer, default 0
cabinClass — "ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", or "FIRST"

Rules:
- If the user mentions both a departure and return date, set tripType to "ROUND_TRIP"
- If the user only mentions a departure date or says "one way", set tripType to "ONE_WAY"
- If a city name is given instead of an airport code, convert it to the most common IATA code for that city (e.g. "Dallas" → "DFW", "Bangkok" → "BKK", "London" → "LHR", "New York" → "JFK", "Delhi" → "DEL", "San Jose" → "SJC", "Paris" → "CDG", "Tokyo" → "NRT", "Dubai" → "DXB", "Singapore" → "SIN", "Mumbai" → "BOM", "Los Angeles" → "LAX", "Chicago" → "ORD", "San Francisco" → "SFO", "Miami" → "MIA")
- If information is missing, return null values for those fields
- Default cabinClass is "ECONOMY" if not specified
- Default adults is 1 if not specified

Output format:
{
  "action": "SEARCH_FLIGHTS",
  "params": {
    "origin": "DFW",
    "destination": "DEL",
    "departureDate": "2026-06-02",
    "returnDate": "2026-06-08",
    "tripType": "ROUND_TRIP",
    "adults": 2,
    "children": 0,
    "infants": 0,
    "cabinClass": "ECONOMY"
  }
}`;
}

interface TravelerInfo {
  travelerIndex: number;
  passengerType: string;
}

function buildPassengerSystemPrompt(travelers: TravelerInfo[]): string {
  const today = new Date().toISOString().split('T')[0];
  const travelerList = travelers.map(t =>
    `  - Traveler ${t.travelerIndex}: ${t.passengerType}`
  ).join('\n');

  return `You are FareMind Travel Assistant.

Convert passenger detail voice commands into structured JSON.

Return JSON only.

Today's date is ${today}.

Current page context: PASSENGER_DETAILS

Available travelers on this booking:
${travelerList}

Supported actions:
- FILL_PRIMARY_CONTACT — for updating the primary contact info (email, phone, name)
- FILL_PASSENGER_DETAILS — for filling a specific traveler's details (name, DOB, passport, etc.)
- CLARIFY — when the target traveler is ambiguous

Rules:
- Do NOT invent missing values. If a field is not spoken, return null or omit it.
- Normalize dates into YYYY-MM-DD format. Interpret relative dates (e.g. "August 15 2005") correctly.
- Normalize gender into: "male", "female", or "other".
- Preserve passport number exactly as spoken (e.g. "P12345678").
- For passport expiry and DOB, always use YYYY-MM-DD.
- Map traveler references:
  - "traveler one" / "traveler 1" / "first traveler" → travelerIndex 1
  - "traveler two" / "traveler 2" / "second traveler" → travelerIndex 2
  - "traveler three" / "traveler 3" / "third traveler" → travelerIndex 3
  - "child traveler" → match the child traveler if only one child exists
  - "infant traveler" → match the infant traveler if only one infant exists
  - If multiple children/infants exist and reference is ambiguous, return CLARIFY
- For "primary contact" or "contact details", use FILL_PRIMARY_CONTACT
- For phone numbers, extract country code (e.g. "+1") and local number separately
- If the user says "update" or "change", they intend to overwrite existing values

If traveler target is unclear, return:
{
  "action": "CLARIFY",
  "message": "Which traveler should I update?"
}

Output format for FILL_PASSENGER_DETAILS:
{
  "action": "FILL_PASSENGER_DETAILS",
  "target": "TRAVELER",
  "travelerIndex": 1,
  "params": {
    "firstName": "Rishi",
    "middleName": null,
    "lastName": "Parihar",
    "gender": "male",
    "dateOfBirth": "2005-08-15",
    "nationality": "India",
    "passportCountry": "India",
    "passportNumber": "P12345678",
    "passportExpiry": "2031-09-28"
  }
}

Output format for FILL_PRIMARY_CONTACT:
{
  "action": "FILL_PRIMARY_CONTACT",
  "target": "PRIMARY_CONTACT",
  "params": {
    "firstName": "Rishi",
    "lastName": "Parihar",
    "email": "rishi@example.com",
    "phoneCountryCode": "+1",
    "phoneNumber": "9725551234"
  }
}`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface PassengerContext {
  totalTravelers: number;
  travelers: TravelerInfo[];
}

interface VoiceCommandRequest {
  pageContext: string;
  transcript: string;
  passengerContext?: PassengerContext;
}

// ─── Validation helpers ─────────────────────────────────────────────────────

function normalizeIATA(code: unknown): string | null {
  if (typeof code !== 'string' || !code) return null;
  const upper = code.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

function normalizeDate(date: unknown): string | null {
  if (typeof date !== 'string' || !date) return null;
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : date;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? Math.round(val) : parseInt(String(val));
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function maskPassport(pp: unknown): string {
  if (typeof pp !== 'string' || pp.length < 3) return '***';
  return pp.slice(0, 1) + '•'.repeat(pp.length - 3) + pp.slice(-2);
}

const VALID_CABIN = new Set(['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST']);
const VALID_TRIP = new Set(['ROUND_TRIP', 'ONE_WAY']);
const VALID_GENDER = new Set(['male', 'female', 'other']);

// ─── Plugin ─────────────────────────────────────────────────────────────────

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/parse-command', async (request, reply) => {
    const body = request.body as VoiceCommandRequest;
    const transcript = body?.transcript?.trim();
    const pageContext = body?.pageContext?.trim() || 'HOME_SEARCH';

    if (!transcript) {
      return reply.code(400).send({ error: 'Missing transcript' });
    }

    if (transcript.length > 1000) {
      return reply.code(400).send({ error: 'Transcript too long (max 1000 characters)' });
    }

    // Validate page context
    const supportedActions = PAGE_ACTIONS[pageContext];
    if (!supportedActions) {
      return reply.code(400).send({
        error: `Unsupported page context: ${pageContext}`,
        supportedContexts: Object.keys(PAGE_ACTIONS),
      });
    }

    try {
      const client = getOpenAI();
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

      fastify.log.info({ transcript, pageContext }, '[Voice] Parsing command');

      // ── Branch by page context ─────────────────────────────────────────

      if (pageContext === 'PASSENGER_DETAILS') {
        return await handlePassengerParse(fastify, client, model, transcript, body.passengerContext, reply);
      }

      // ── Default: HOME_SEARCH (flight search) ──────────────────────────

      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: buildSearchSystemPrompt() },
          { role: 'user', content: transcript },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 400,
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      let parsed: any;

      try {
        parsed = JSON.parse(raw);
      } catch {
        fastify.log.error({ raw }, '[Voice] Failed to parse GPT response as JSON');
        return reply.code(500).send({ error: 'Failed to parse voice command' });
      }

      // Normalize and validate the parsed output
      const params = parsed.params ?? parsed;
      const action = parsed.action ?? 'SEARCH_FLIGHTS';

      // Validate action is supported in this page context
      if (!supportedActions.includes(action)) {
        fastify.log.warn({ action, pageContext, supportedActions }, '[Voice] Unsupported action for context');
        return reply.code(400).send({
          error: `Action "${action}" is not supported on this page. Try navigating to the search page first.`,
          action,
          pageContext,
        });
      }

      const result = {
        action,
        params: {
          origin: normalizeIATA(params.origin),
          destination: normalizeIATA(params.destination),
          departureDate: normalizeDate(params.departureDate),
          returnDate: normalizeDate(params.returnDate),
          tripType: VALID_TRIP.has(params.tripType) ? params.tripType : (params.returnDate ? 'ROUND_TRIP' : 'ONE_WAY'),
          adults: clampInt(params.adults, 1, 9, 1),
          children: clampInt(params.children, 0, 9, 0),
          infants: clampInt(params.infants, 0, 9, 0),
          cabinClass: VALID_CABIN.has(params.cabinClass?.toUpperCase?.())
            ? params.cabinClass.toUpperCase()
            : 'ECONOMY',
        },
      };

      fastify.log.info({ transcript, result, model, pageContext }, '[Voice] Command parsed');

      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Voice command parse error';
      fastify.log.error({ err, transcript }, '[Voice] Command parse failed');
      return reply.code(500).send({ error: msg });
    }
  });
};

// ─── Passenger parse handler ────────────────────────────────────────────────

async function handlePassengerParse(
  fastify: any,
  client: OpenAI,
  model: string,
  transcript: string,
  passengerContext: PassengerContext | undefined,
  reply: any,
) {
  // Build traveler list for prompt — default to 1 adult if not provided
  const travelers: TravelerInfo[] = passengerContext?.travelers ?? [
    { travelerIndex: 1, passengerType: 'ADULT' },
  ];

  const systemPrompt = buildPassengerSystemPrompt(travelers);

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 600,
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch {
    fastify.log.error({ raw }, '[Voice] Failed to parse GPT passenger response as JSON');
    return reply.code(500).send({ error: 'Failed to parse passenger voice command' });
  }

  const action = parsed.action ?? 'FILL_PASSENGER_DETAILS';
  const params = parsed.params ?? {};

  // Handle CLARIFY action
  if (action === 'CLARIFY') {
    fastify.log.info({ transcript, action, message: parsed.message }, '[Voice] Passenger clarification needed');
    return {
      action: 'CLARIFY',
      message: parsed.message || 'Which traveler should I update?',
    };
  }

  // Normalize passenger params
  const normalizedParams: Record<string, any> = {};

  // String fields — pass through if present
  for (const field of ['firstName', 'middleName', 'lastName', 'email', 'phoneCountryCode', 'phoneNumber', 'passportNumber', 'nationality', 'passportCountry']) {
    if (params[field] && typeof params[field] === 'string' && params[field].trim()) {
      normalizedParams[field] = params[field].trim();
    }
  }

  // Gender
  if (params.gender) {
    const g = String(params.gender).toLowerCase().trim();
    normalizedParams.gender = VALID_GENDER.has(g) ? g : null;
  }

  // Date fields
  if (params.dateOfBirth) normalizedParams.dateOfBirth = normalizeDate(params.dateOfBirth);
  if (params.passportExpiry) normalizedParams.passportExpiry = normalizeDate(params.passportExpiry);

  // Determine missing required fields for traveler fill
  const missingFields: string[] = [];
  if (action === 'FILL_PASSENGER_DETAILS') {
    if (!normalizedParams.firstName) missingFields.push('firstName');
    if (!normalizedParams.lastName) missingFields.push('lastName');
  }

  // Build travelerIndex — GPT might return it as number, string, or with alternate key names
  const rawIndex = parsed.travelerIndex
    ?? parsed.traveler_index
    ?? parsed.targetIndex
    ?? parsed.target_index
    ?? parsed.index;

  let travelerIndex: number | undefined;
  if (typeof rawIndex === 'number' && rawIndex >= 1) {
    travelerIndex = rawIndex;
  } else if (typeof rawIndex === 'string' && !isNaN(parseInt(rawIndex))) {
    travelerIndex = parseInt(rawIndex);
  } else if (action === 'FILL_PRIMARY_CONTACT') {
    travelerIndex = undefined;
  } else {
    travelerIndex = 1; // fallback for traveler fill without explicit index
  }

  const result: any = {
    action,
    target: parsed.target || (action === 'FILL_PRIMARY_CONTACT' ? 'PRIMARY_CONTACT' : 'TRAVELER'),
    params: normalizedParams,
    missingFields,
  };

  if (travelerIndex !== undefined) {
    result.travelerIndex = travelerIndex;
  }

  // Log with masked passport
  const logParams = { ...normalizedParams };
  if (logParams.passportNumber) logParams.passportNumber = maskPassport(logParams.passportNumber);
  fastify.log.info({ transcript, action, travelerIndex, rawGptIndex: rawIndex, params: logParams, missingFields, model }, '[Voice] Passenger command parsed');

  return result;
}

export default plugin;
