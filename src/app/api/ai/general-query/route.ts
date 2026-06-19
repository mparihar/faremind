import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ── AI Clients ──────────────────────────────────────────────────────────────

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const anthropicClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

// ── FareMind Internal Knowledge Base ────────────────────────────────────────

const FAREMIND_FAQ = `
## FareMind Internal Knowledge (Answer these directly without disclaimers)

**What is FareMind Booking Reference?**
A FareMind Booking Reference (FBR) is a unique code starting with "FM-" assigned to every booking made through FareMind. Use it to manage, track, or modify your booking in the Manage Booking section.

**What is an Airline PNR?**
A Passenger Name Record (PNR) is a 6-character alphanumeric code assigned by the airline. It may differ from your FareMind Booking Reference. You'll find it in your booking confirmation email.

**What does Basic Economy mean?**
Basic Economy is a restricted fare class offered by many airlines. It typically includes only a personal item, has no seat selection, is non-refundable, and does not allow changes. Checked baggage and carry-on may cost extra.

**Are checked bags included?**
Baggage inclusion depends on the fare class and airline. Full-service carriers often include 1 checked bag in Economy. Low-cost and Basic Economy fares usually do not include checked bags. Check the fare details before booking.

**Can I change the passenger name?**
Name changes are generally not allowed after booking. Minor corrections (typos, spelling) may be possible depending on the airline. Contact FareMind Support for assistance.

**Can I update passport details?**
Yes, you can usually update passport details through Manage Booking or by contacting FareMind Support. Some airlines require this before travel.

**How does cancellation work?**
Cancellation policies depend on the fare rules. Refundable fares allow full cancellation. Non-refundable fares may allow cancellation with a fee or provide travel credit. Check fare rules before booking.

**How does refund timing work?**
Refunds typically take 5–10 business days for credit card payments and up to 20 business days for bank transfers. Processing time depends on the airline and payment provider.

**What is Price Drop Protection?**
FareMind's Price Drop Protection monitors fare prices after booking. If the price drops, FareMind notifies you and may help you rebook at the lower fare, subject to airline rules and fare availability.

**What is Travel Insurance?**
Travel insurance provides coverage for trip cancellation, medical emergencies, lost baggage, and travel delays. FareMind partners with insurance providers to offer optional coverage during checkout.

**What is DNA Search?**
DNA Search is FareMind's AI-powered personalized flight ranking. It learns your travel preferences (layover tolerance, airline loyalty, baggage needs, timing preferences) and re-ranks search results to match your unique travel style.

**What is AI Intelligence?**
FareMind AI Intelligence uses GPT-4o Mini to provide smart flight recommendations, conversational booking, travel guidance, and support. It powers the AI Bot, DNA Search explanations, and intelligent search assistance.

**Why does a fare expire?**
Airline fares are dynamic and have limited availability. A fare can expire if the airline updates pricing, the fare bucket sells out, or you take too long to complete checkout. Always complete booking promptly.

**Why did the price change?**
Prices change due to airline revenue management, demand, fare bucket availability, and time to departure. The price shown at search may differ at checkout if the fare was updated by the airline.

**Why was payment authorized but not ticketed?**
This can happen if the airline's ticketing system encounters an error after payment authorization. FareMind automatically creates a support case for such issues. The payment hold will be released if ticketing fails.
`;

// ── Categories ──────────────────────────────────────────────────────────────

const CATEGORIES = [
  'BOOKING_HELP', 'BAGGAGE', 'SEAT_SELECTION', 'MEAL_SELECTION',
  'CANCELLATION', 'REFUND', 'PAYMENT', 'TRAVEL_INSURANCE',
  'PRICE_PROTECTION', 'TRANSIT_VISA', 'IMMIGRATION', 'ROUTE_SAFETY',
  'AIRLINE_POLICY', 'AIRPORT_TRANSIT', 'DOCUMENT_REQUIREMENT',
  'GENERAL_TRAVEL', 'ESCALATE_SUPPORT',
];

// ── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are FareMind AI Travel Assistant.

You help users with general flight booking, travel planning, booking support, transit, baggage, cancellation, refund, passenger information, and travel-document questions.

You are helpful, calm, professional, and concise.

You are NOT an immigration attorney, lawyer, government officer, airline representative, or airport authority.

${FAREMIND_FAQ}

## Safety Rules for Sensitive Topics

For travel-document, visa, immigration, geopolitical safety, airline policy, or route-safety questions:
- Give general guidance only.
- Do NOT guarantee eligibility.
- Tell the user rules may vary based on nationality, passport, visa status, airline, airport, transit duration, and travel date.
- Recommend checking official airline, airport, immigration, embassy, or government sources.
- Recommend consulting an immigration attorney or qualified travel advisor for complex visa/status cases.

NEVER say:
- "You definitely do not need a visa."
- "You are guaranteed to be allowed."
- "This route is 100% safe."
- "The airline will definitely allow you."

Use safer language:
- "Typically..."
- "In many cases..."
- "You may need..."
- "This should be verified with..."
- "Before booking, please confirm with..."

For questions involving CURRENT rules, conflicts, airline policies, visa requirements, travel advisories, or safety advisories:
- Add this disclaimer: "I may not have the latest rule or advisory. Please verify with the official airline, airport, embassy, immigration authority, or government travel advisory before booking."
- Do NOT hallucinate current regulations.

## Answer Style
- Clear, practical, friendly
- Not too long (aim for 2-4 short paragraphs max)
- Structured with bullet points when listing multiple items
- Support-agent-like tone

For sensitive queries, structure your answer:
1. Direct answer
2. Important caveats
3. What user should verify
4. Suggested next step

## Response Format
Return valid JSON exactly:
{
  "answer": "Your response text. Use \\n for line breaks.",
  "category": "ONE_OF_THE_CATEGORIES",
  "confidence": "LOW|MEDIUM|HIGH",
  "needsEscalation": false,
  "recommendedNextStep": "Optional suggestion for user's next step.",
  "citationsRequired": false
}

Categories: ${CATEGORIES.join(', ')}

Set needsEscalation = true if user asks about:
- Legal immigration advice or visa eligibility guarantee
- Expired visa and complex immigration status
- Denied boarding risk
- Payment charged but booking not confirmed
- Refund dispute
- Ticket not issued for flight today
- Safety-sensitive route involving current conflict
- Medical emergency travel
- Minor travel documentation uncertainty
- Airline-specific exception requests

Set citationsRequired = true if the answer references rules that should be verified with official sources.`;

// ── Handler ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!openaiClient && !anthropicClient) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, conversationHistory } = body as {
    message: string;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  // Build messages array with conversation context (last 10 turns)
  const history = (conversationHistory || []).slice(-10);
  const messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user', content: message.trim() },
  ];

  try {
    const provider = process.env.AI_PROVIDER || 'openai';
    const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    let raw = '{}';

    if (provider === 'anthropic') {
      if (!anthropicClient) throw new Error('Anthropic client not configured');
      const response = await anthropicClient.messages.create({
        model,
        max_tokens: 1500,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: messages
          .filter(m => m.role !== 'system')
          .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      });
      const textBlock = response.content.find(c => c.type === 'text');
      raw = textBlock?.type === 'text' ? textBlock.text : '{}';
      raw = raw.replace(/^```json\n/, '').replace(/\n```$/, '').trim();
    } else {
      if (!openaiClient) throw new Error('OpenAI client not configured');
      const completion = await openaiClient.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 1500,
      });
      raw = completion.choices[0]?.message?.content ?? '{}';
    }

    const result = JSON.parse(raw);

    // Validate category
    const category = CATEGORIES.includes(result.category) ? result.category : 'GENERAL_TRAVEL';
    const confidence = ['LOW', 'MEDIUM', 'HIGH'].includes(result.confidence) ? result.confidence : 'MEDIUM';

    return NextResponse.json({
      answer: result.answer || 'I apologize, I was unable to process your question. Please try rephrasing or contact FareMind Support for assistance.',
      category,
      confidence,
      needsEscalation: !!result.needsEscalation,
      recommendedNextStep: result.recommendedNextStep || '',
      citationsRequired: !!result.citationsRequired,
    });
  } catch (err: any) {
    console.error('[ai/general-query] error:', err);
    return NextResponse.json(
      { error: 'AI service temporarily unavailable. Please try again.' },
      { status: 500 }
    );
  }
}
