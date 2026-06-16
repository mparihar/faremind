import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { fireNotification } from '@/lib/notify';
import { determinePnrStrategy } from '@/lib/pnr-strategy';
import {
  computeFinancialBreakdown,
  validateCheckoutPricing,
  checkProviderPriceChange,
  type FinancialBreakdown,
} from '@/lib/checkout-validation';
import { stripe } from '@/lib/stripe';

// ── Duffel API client (direct import for Next.js API route) ──────────────────
const DUFFEL_API_URL = process.env.DUFFEL_API_URL || 'https://api.duffel.com';
const DUFFEL_API_TOKEN = process.env.DUFFEL_API_TOKEN || '';

// Custom error class to preserve Duffel error details (title, code, source)
class DuffelBookingError extends Error {
  errors: Array<{ message?: string; title?: string; code?: string; type?: string; source?: any }>;
  status: number;
  constructor(
    message: string,
    status: number,
    errors: Array<{ message?: string; title?: string; code?: string; type?: string; source?: any }>,
  ) {
    super(message);
    this.name = 'DuffelBookingError';
    this.status = status;
    this.errors = errors;
  }
}

async function duffelRequest<T>(method: string, path: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${DUFFEL_API_URL}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${DUFFEL_API_TOKEN}`,
    'Duffel-Version': 'v2',
    'Accept': 'application/json',
  };
  if (body) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify({ data: body }) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ errors: [] }));
    const errors = errorBody.errors || [];
    console.error('[Duffel] Full error response:', JSON.stringify(errorBody, null, 2));
    const msg = errors.map((e: any) => {
      let detail = e.message || '';
      if (e.source?.pointer) detail += ` (at ${e.source.pointer})`;
      return detail;
    }).join('; ') || `HTTP ${response.status}`;
    throw new DuffelBookingError(`Duffel API error (${response.status}): ${msg}`, response.status, errors);
  }

  if (response.status === 204) return {} as T;
  const data = await response.json();
  return data.data as T;
}

interface DuffelOrder {
  id: string;
  booking_reference: string;
  total_amount: string;
  total_currency: string;
  passengers: { id: string; type: string; given_name?: string; family_name?: string }[];
  slices: any[];
  created_at: string;
}

function generateRef() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return 'FM' + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ── Booking Failure Audit Logger ─────────────────────────────────────────────
// Stores full details of every failed booking attempt for admin review.
// Non-blocking — errors in audit logging never affect the customer response.

interface BookingFailureContext {
  passengers: any[];
  selectedFare: any;
  pricing: any;
  sourceFlight: any;
  sourceRoundTrip: any;
  paymentIntentId: string | null;
  sessionId: string | null;
  userId: string | null;
  routeLabel: string;
  currency: string;
  errorCode: string;
  errorMessage: string;
  customerMessage: string;
  failureStage: string;
  offerProvidedAt?: string | null;
  offerExpiresAt?: string | null;
}

async function logBookingFailure(ctx: BookingFailureContext): Promise<void> {
  try {
    const primaryPax = ctx.passengers[0] ?? {};
    const isRoundTrip = !!ctx.sourceRoundTrip;

    // Derive route info
    const originAirport = isRoundTrip
      ? (ctx.sourceRoundTrip?.outboundJourney?.departureAirport ?? '')
      : (ctx.sourceFlight?.segments?.[0]?.departure?.airport ?? '');
    const destinationAirport = isRoundTrip
      ? (ctx.sourceRoundTrip?.outboundJourney?.arrivalAirport ?? '')
      : (ctx.sourceFlight?.segments?.[ctx.sourceFlight.segments.length - 1]?.arrival?.airport ?? '');
    const airline = isRoundTrip
      ? (ctx.sourceRoundTrip?.airlines?.[0] ?? '')
      : (ctx.sourceFlight?.airline?.name ?? '');

    // Derive dates
    const departureDate = isRoundTrip
      ? ctx.sourceRoundTrip?.outboundJourney?.segments?.[0]?.departure?.time
      : ctx.sourceFlight?.segments?.[0]?.departure?.time;
    const returnDate = isRoundTrip
      ? ctx.sourceRoundTrip?.returnJourney?.segments?.[0]?.departure?.time
      : null;

    // Sanitize passenger data — strip sensitive fields for audit storage
    const sanitizedPassengers = ctx.passengers.map((p: any) => ({
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
      type: p.type ?? 'adult',
      email: p.email ?? '',
      phone: p.phone ?? '',
      dateOfBirth: p.dateOfBirth ?? '',
      nationality: p.nationality ?? '',
    }));

    await (prisma as any).bookingFailureAudit.create({
      data: {
        customerEmail: primaryPax.email?.trim()?.toLowerCase() || 'unknown@unknown.com',
        customerName: `${primaryPax.firstName || ''} ${primaryPax.lastName || ''}`.trim() || 'Unknown',
        customerPhone: primaryPax.phone || null,
        userId: ctx.userId || null,
        originAirport: originAirport || 'N/A',
        destinationAirport: destinationAirport || 'N/A',
        routeLabel: ctx.routeLabel || `${originAirport} → ${destinationAirport}`,
        tripType: isRoundTrip ? 'ROUND_TRIP' : 'ONE_WAY',
        departureDate: departureDate ? new Date(departureDate).toISOString().split('T')[0] : null,
        returnDate: returnDate ? new Date(returnDate).toISOString().split('T')[0] : null,
        airline: airline || null,
        cabinClass: ctx.selectedFare?.cabin || null,
        passengerCount: ctx.passengers.length,
        passengersJson: JSON.stringify(sanitizedPassengers),
        totalAmount: ctx.pricing?.total ?? ctx.selectedFare?.totalPrice ?? 0,
        currency: ctx.currency || 'USD',
        offerId: ctx.selectedFare?.offerId || ctx.selectedFare?.id || null,
        fareName: ctx.selectedFare?.name || null,
        errorCode: ctx.errorCode,
        errorMessage: ctx.errorMessage,
        customerMessage: ctx.customerMessage,
        failureStage: ctx.failureStage,
        stripePaymentIntentId: ctx.paymentIntentId || null,
        sessionId: ctx.sessionId || null,
        offerProvidedAt: ctx.offerProvidedAt ? new Date(ctx.offerProvidedAt) : null,
        offerExpiresAt: ctx.offerExpiresAt ? new Date(ctx.offerExpiresAt) : null,
      },
    });

    console.log(`[BookingAudit] ✅ Failure recorded — ${ctx.errorCode} for ${primaryPax.email || 'unknown'}`);
  } catch (auditErr) {
    // Never let audit logging failure affect the customer response
    console.error('[BookingAudit] ❌ Failed to record audit:', auditErr instanceof Error ? auditErr.message : auditErr);
  }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      paymentIntentId,
      sessionId,
      passengers,
      selectedFare,
      pricing,
      extraBags,
      priceProtection,
      travelInsurance,
      seatSelections,
      mealSelections,
      sourceFlight,
      sourceRoundTrip,
      routeLabel,
      userId,
      currency = 'USD',
    } = body;

    if (!Array.isArray(passengers) || passengers.length === 0) {
      return NextResponse.json({ error: 'passengers required' }, { status: 400 });
    }

    if (!paymentIntentId) {
      return NextResponse.json(
        { error: 'paymentIntentId is required', errorCode: 'MISSING_PAYMENT' },
        { status: 400 }
      );
    }

    const offerId = selectedFare?.offerId || selectedFare?.id || selectedFare?.duffelOfferId;
    if (!offerId) {
      return NextResponse.json(
        { error: 'No offer ID found. Please select a fare and try again.', errorCode: 'MISSING_OFFER_ID' },
        { status: 400 }
      );
    }

    if (!DUFFEL_API_TOKEN) {
      console.error('[Checkout] ❌ DUFFEL_API_TOKEN is not configured');
      return NextResponse.json(
        { error: 'Booking service is not configured. Please contact support.', errorCode: 'PROVIDER_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    const isRoundTrip = !!sourceRoundTrip;

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1 — Financial Breakdown & Pricing Validation
    // ══════════════════════════════════════════════════════════════════════════
    // Compute the backend source-of-truth for pricing BEFORE calling provider.
    // The provider API must only receive providerPayableTotal, never the
    // customer grand total which includes markup, service fee, insurance, etc.

    // offerId already validated above

    // Resolve the stored provider fare from the search/markup phase
    const storedProviderFare: number | null =
      sourceFlight?.providerTotalFare
      ?? sourceRoundTrip?.providerTotalFare
      ?? null;

    // Resolve fee amounts from the frontend pricing breakdown
    // Note: markup is already baked into the fare price (not in `pricing`).
    // The markup amount is stored on the source flight/RT from the markup service.
    const frontendMarkup =
      sourceFlight?.fareMindMarkupAmount
      ?? sourceRoundTrip?.fareMindMarkupAmount
      ?? 0;
    const frontendServiceFee = pricing?.serviceFee ?? 0;
    const frontendProtectionFee = priceProtection ? (pricing?.protectionFee ?? 0) : 0;
    const frontendInsuranceFee = travelInsurance ? (pricing?.insuranceFee ?? 0) : 0;
    const frontendSeatFees = pricing?.seatFees ?? 0;
    const frontendMealFees = pricing?.mealFees ?? 0;
    const frontendBaggageFees = pricing?.baggageFees ?? 0;
    const frontendTotal = pricing?.total ?? selectedFare?.totalPrice ?? 0;

    // ── Compute base fare from frontend per-passenger breakdown ────────────
    // The frontend rounds per-passenger fares individually (selectedFare.basePrice
    // × passenger count), while providerTotalFare + markup is a single sum.
    // Using the frontend's per-passenger subtotals ensures the backend grand total
    // matches the frontend's display total exactly (no rounding drift).
    const frontendFareBase: number = Array.isArray(pricing?.perPassenger)
      ? pricing.perPassenger.reduce((s: number, p: any) => s + (p.subtotal ?? 0), 0)
      : (selectedFare?.basePrice ?? 0) * passengers.length;

    // For the PROVIDER payment, we still use the raw providerTotalFare.
    // This is the true amount Duffel expects — independent of our markup/rounding.
    const baseProviderFare = storedProviderFare
      ?? (selectedFare?.basePrice ?? (frontendTotal - frontendMarkup - frontendServiceFee - frontendProtectionFee - frontendInsuranceFee - frontendSeatFees - frontendMealFees - frontendBaggageFees));

    // Compute financial breakdown using the frontend's fare base for validation.
    // The providerTotalFare field is set to (fareBase - markup) so that
    // providerPayableTotal + fareMindRevenue + thirdParty = customerGrandTotal
    // exactly matches the frontend's displayed total.
    let financials: FinancialBreakdown = computeFinancialBreakdown({
      providerTotalFare: frontendFareBase - frontendMarkup,
      markupAmount: frontendMarkup,
      serviceFeeAmount: frontendServiceFee,
      seatServiceTotal: frontendSeatFees,
      mealServiceTotal: frontendMealFees,
      baggageServiceTotal: frontendBaggageFees,
      priceProtectionAmount: frontendProtectionFee,
      travelInsuranceAmount: frontendInsuranceFee,
    });

    // Validate: does the frontend total match our backend-computed total?
    const pricingCheck = validateCheckoutPricing(frontendTotal, financials.customerGrandTotal);
    if (!pricingCheck.valid) {
      console.error(`[Checkout] ❌ ${pricingCheck.error}`);
      console.error(
        `[Checkout] Debug — fareBase: $${frontendFareBase}, markup: $${frontendMarkup}, ` +
        `svcFee: $${frontendServiceFee}, seats: $${frontendSeatFees}, meals: $${frontendMealFees}, ` +
        `bags: $${frontendBaggageFees}, protection: $${frontendProtectionFee}, insurance: $${frontendInsuranceFee}`
      );
      return NextResponse.json(
        {
          error: 'Pricing mismatch — the displayed price does not match our records. Please try again.',
          errorCode: pricingCheck.errorCode,
          detail: process.env.NODE_ENV === 'development' ? pricingCheck.error : undefined,
        },
        { status: 409 }
      );
    }

    // Override providerTotalFare with the actual stored provider fare for
    // the Duffel API payment and DB records (not the rounded frontend value).
    financials = {
      ...financials,
      providerTotalFare: baseProviderFare,
      providerPayableTotal: Math.round((baseProviderFare + frontendSeatFees) * 100) / 100,
    };

    console.log(
      `[Checkout] Financial breakdown — provider: $${financials.providerPayableTotal.toFixed(2)}, ` +
      `markup: $${financials.markupAmount.toFixed(2)}, svcFee: $${financials.serviceFeeAmount.toFixed(2)}, ` +
      `seats: $${financials.seatServiceTotal.toFixed(2)}, meals: $${financials.mealServiceTotal.toFixed(2)}, ` +
      `bags: $${financials.baggageServiceTotal.toFixed(2)}, ` +
      `protection: $${financials.priceProtectionAmount.toFixed(2)}, insurance: $${financials.travelInsuranceAmount.toFixed(2)}, ` +
      `customer total: $${financials.customerGrandTotal.toFixed(2)} (frontend: $${frontendTotal.toFixed(2)})`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1b — Stripe Authorization Verification
    // ══════════════════════════════════════════════════════════════════════════
    // Verify that Stripe has AUTHORIZED (not captured) the customer's payment.
    // With capture_method: 'manual', the status should be 'requires_capture'.
    // We capture ONLY after the provider order succeeds.
    // If anything fails, we cancel the authorization — customer is never charged.

    let stripeVerified = false;
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (pi.status !== 'requires_capture' && pi.status !== 'succeeded') {
        console.error(`[Checkout] ❌ Stripe PaymentIntent ${paymentIntentId} status: ${pi.status} (expected 'requires_capture')`);
        return NextResponse.json(
          {
            error: 'Payment authorization has not been completed. Please try again.',
            errorCode: 'PAYMENT_NOT_AUTHORIZED',
          },
          { status: 402 }
        );
      }

      // Verify authorized amount matches the customer grand total
      const authorizedAmountDollars = pi.amount / 100;
      const expectedDollars = financials.customerGrandTotal;
      const paymentDelta = Math.abs(authorizedAmountDollars - expectedDollars);

      if (paymentDelta > 0.50) {
        console.error(
          `[Checkout] ❌ Stripe amount mismatch: authorized $${authorizedAmountDollars.toFixed(2)} ` +
          `vs expected $${expectedDollars.toFixed(2)} (delta: $${paymentDelta.toFixed(2)})`
        );
        // Cancel the authorization — customer is not charged
        await stripe.paymentIntents.cancel(paymentIntentId).catch(() => null);
        return NextResponse.json(
          {
            error: 'Payment amount does not match the booking total.',
            errorCode: 'PAYMENT_AMOUNT_MISMATCH',
          },
          { status: 409 }
        );
      }

      stripeVerified = true;
      console.log(
        `[Checkout] ✅ Stripe authorization verified — ${paymentIntentId}: ` +
        `$${authorizedAmountDollars.toFixed(2)} authorized (expected: $${expectedDollars.toFixed(2)})`
      );
    } catch (stripeErr: any) {
      console.error('[Checkout] ❌ Failed to verify Stripe authorization:', stripeErr.message);
      return NextResponse.json(
        {
          error: 'Unable to verify payment. Please try again.',
          errorCode: 'PAYMENT_VERIFICATION_FAILED',
        },
        { status: 502 }
      );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 2 — Provider Order Creation
    // ══════════════════════════════════════════════════════════════════════════
    // FareMind pays the provider ONLY the providerPayableTotal.
    // Markup, service fee, insurance, protection are NOT sent to the provider.

    let duffelOrder: DuffelOrder | null = null;
    let duffelPassengerMap: Record<string, string> = {};
    let providerPayableAmount = financials.providerPayableTotal;
    let providerCurrency = currency;
    let offer: any = null;
    let offerProvidedAt: string | null = null;
    let offerExpiresAt: string | null = null;

    // Helper: cancel Stripe authorization — customer is never charged
    const cancelStripeAuth = async (reason: string) => {
      if (stripeVerified && paymentIntentId) {
        try {
          await stripe.paymentIntents.cancel(paymentIntentId);
          console.log(`[Stripe] Authorization cancelled (${paymentIntentId}) — reason: ${reason}`);
        } catch (cancelErr: any) {
          console.error(`[Stripe] Failed to cancel authorization: ${cancelErr.message}`);
        }
      }
    };

    try {
        // Normalize phone to E.164 format for Duffel
        // Duffel requires: +{country_code}{number}, no spaces/dashes, max 15 digits after +
        const normalizePhone = (raw: string): string => {
          if (!raw || !raw.trim()) return '+442080160509'; // Duffel-accepted fallback
          let cleaned = raw.trim();
          const hasPlus = cleaned.startsWith('+');
          // Strip everything except digits
          const digits = cleaned.replace(/\D/g, '');
          if (digits.length === 0) return '+442080160509';

          // Too short to be a real phone number — use fallback
          if (digits.length < 7) return '+442080160509';

          // Too long for E.164 (max 15 digits) — truncate
          const safeDigits = digits.length > 15 ? digits.slice(0, 15) : digits;
          
          // 10 digits (with or without +) → assume US number, prepend +1
          if (safeDigits.length === 10) return `+1${safeDigits}`;
          
          // 11 digits starting with 1 → US with country code
          if (safeDigits.length === 11 && safeDigits.startsWith('1')) return `+${safeDigits}`;
          
          // If already has + and 7+ digits, trust the country code
          if (hasPlus && safeDigits.length >= 7) return `+${safeDigits}`;
          
          // Other lengths with 7+ digits — prepend +
          if (safeDigits.length >= 7) return `+${safeDigits}`;

          return '+442080160509';
        };

        // Verify offer is still valid and get passenger IDs from the offer
        offer = await duffelRequest<any>('GET', `/air/offers/${offerId}?return_available_services=true`);

        // Capture offer lifecycle timestamps for audit tracking
        offerProvidedAt = offer.created_at ?? null;
        offerExpiresAt = offer.expires_at ?? null;

        if (new Date(offer.expires_at) < new Date()) {
          await cancelStripeAuth('offer expired');
          return NextResponse.json(
            { error: 'This flight offer has expired. Please search again.', errorCode: 'OFFER_EXPIRED' },
            { status: 400 }
          );
        }

        // Re-validated provider fare from the fresh offer fetch
        const revalidatedProviderFare = parseFloat(offer.total_amount);
        const totalCurrency = offer.total_currency;
        providerCurrency = totalCurrency;

        // ── Provider Price-Change Guard ──────────────────────────────────
        // If the provider price has changed significantly since the user
        // selected the offer, reject checkout to prevent unexpected charges.
        const priceCheck = checkProviderPriceChange(storedProviderFare, revalidatedProviderFare);
        if (!priceCheck.valid) {
          console.warn(`[Checkout] ❌ ${priceCheck.error}`);
          await cancelStripeAuth('provider price changed');
          return NextResponse.json(
            {
              error: 'The flight price has changed since you selected it. Please search again for updated pricing.',
              errorCode: priceCheck.errorCode,
              detail: process.env.NODE_ENV === 'development' ? priceCheck.error : undefined,
            },
            { status: 409 }
          );
        }

        // Use the REVALIDATED provider fare for the Duffel payment amount.
        // Only update provider-facing fields — customer-facing totals stay as validated.
        financials = {
          ...financials,
          providerTotalFare: revalidatedProviderFare,
          providerPayableTotal: Math.round((revalidatedProviderFare + financials.seatServiceTotal) * 100) / 100,
        };

        // Duffel offers come with pre-assigned passenger IDs (e.g. pas_0000ABC...).
        // We MUST use these exact IDs when creating the order.
        const offerPassengers: Array<{ id: string; type: string }> = offer.passengers ?? [];

        // ── Infant-aware passenger count validation ──────────────────────────
        // Duffel offers may not include infant_without_seat passengers in the
        // re-fetched offer (common in test mode). We allow the difference if
        // it's exactly the number of infant passengers in checkout.
        const checkoutInfants = passengers.filter((p: any) => p.type === 'infant');
        const checkoutNonInfants = passengers.filter((p: any) => p.type !== 'infant');
        const offerInfants = offerPassengers.filter(op => op.type === 'infant_without_seat');
        const offerNonInfants = offerPassengers.filter(op => op.type !== 'infant_without_seat');

        // Non-infant count MUST match (adults + children)
        if (offerNonInfants.length !== checkoutNonInfants.length) {
          const mismatchMsg = `Offer has ${offerNonInfants.length} non-infant passenger(s) but checkout has ${checkoutNonInfants.length} (infants excluded)`;
          console.warn(`[Duffel] Passenger count mismatch: ${mismatchMsg}`);
          await cancelStripeAuth('passenger count mismatch');

          const customerMsg = `The number of passengers does not match the original search. Booking could not be completed at this time. Your card was not charged. Please try again.`;
          await logBookingFailure({
            passengers, selectedFare, pricing, sourceFlight, sourceRoundTrip,
            paymentIntentId, sessionId, userId, routeLabel: routeLabel ?? '',
            currency, errorCode: 'PASSENGER_COUNT_MISMATCH',
            errorMessage: mismatchMsg, customerMessage: customerMsg,
            failureStage: 'DUFFEL_OFFER_VALIDATION',
            offerProvidedAt, offerExpiresAt,
          });

          return NextResponse.json(
            { error: mismatchMsg, errorCode: 'PASSENGER_COUNT_MISMATCH', customerMessage: customerMsg },
            { status: 400 }
          );
        }

        // If offer is missing infant passengers, log it but proceed —
        // we'll generate placeholder IDs for them below
        if (offerInfants.length < checkoutInfants.length) {
          console.log(`[Duffel] Offer has ${offerInfants.length} infant passenger(s) but checkout has ${checkoutInfants.length} — will generate IDs for missing infants`);
        }

        // Match offer passengers to our checkout passengers by type
        const offerPaxByType: Record<string, string[]> = {};
        for (const op of offerPassengers) {
          const t = op.type === 'infant_without_seat' ? 'infant' : op.type;
          (offerPaxByType[t] ??= []).push(op.id);
        }

        // Track consumption of offer passenger IDs per type
        const usedIdx: Record<string, number> = {};

        // Build Duffel passenger payload using the offer's passenger IDs
        const usedPaxIds = new Set<string>();
        const duffelPassengers = passengers.map((p: any) => {
          const paxType = p.type === 'child' ? 'child' : p.type === 'infant' ? 'infant' : 'adult';
          const duffelType = p.type === 'infant' ? 'infant_without_seat' : paxType;
          const idx = usedIdx[paxType] ?? 0;
          usedIdx[paxType] = idx + 1;
          let paxId = offerPaxByType[paxType]?.[idx];

          // For infants without a matching offer passenger: generate a placeholder ID
          // Duffel accepts generated IDs for infant_without_seat passengers
          if (!paxId && duffelType === 'infant_without_seat') {
            paxId = `inf_generated_${idx}`;
            console.log(`[Duffel] Generated placeholder ID for infant #${idx}: ${paxId}`);
          }

          // Fallback: try to find any unused passenger ID
          if (!paxId) {
            const unused = offerPassengers.find(op => !usedPaxIds.has(op.id));
            paxId = unused?.id;
            console.warn(`[Duffel] No offer passenger ID for ${paxType} #${idx}, using fallback: ${paxId}`);
          }

          if (!paxId) {
            console.error(`[Duffel] Cannot assign passenger ID for ${paxType} #${idx}`);
          }

          usedPaxIds.add(paxId ?? '');

          // For child/infant passengers, fall back to primary adult's contact info
          const primaryAdult = passengers.find((px: any) => px.type === 'adult') || passengers[0];
          const fallbackPhone = normalizePhone(primaryAdult?.phone);
          const fallbackEmail = primaryAdult?.email || 'guest@faremind.ai';

          const paxPhone = p.phone?.trim() ? normalizePhone(p.phone) : fallbackPhone;
          const paxEmail = p.email?.trim() ? p.email : fallbackEmail;

          return {
            id: paxId ?? '',
            type: duffelType,
            given_name: p.firstName || 'Unknown',
            family_name: p.lastName || 'Traveler',
            born_on: p.dateOfBirth || '1990-01-01',
            gender: p.gender === 'female' ? 'f' : 'm',
            email: paxEmail,
            phone_number: paxPhone,
            title: p.gender === 'female' ? 'ms' : 'mr',
          };
        });

        // Log phone normalization for debugging
        duffelPassengers.forEach((dp, i) => {
          console.log(`[Duffel] Passenger ${i}: phone raw="${passengers[i]?.phone}" → normalized="${dp.phone_number}"`);
        });

        // ── Link infants to adults (Duffel requirement) ─────────────────────
        // Duffel requires each infant_without_seat passenger to be referenced
        // by exactly one adult passenger via the `infant_passenger_id` field.
        const infantPaxIds = duffelPassengers
          .filter(dp => dp.type === 'infant_without_seat')
          .map(dp => dp.id);
        const adultPaxList = duffelPassengers.filter(dp => dp.type === 'adult');

        infantPaxIds.forEach((infantId, idx) => {
          const matchingAdult = adultPaxList[idx];
          if (matchingAdult && infantId) {
            (matchingAdult as any).infant_passenger_id = infantId;
            console.log(`[Duffel] Linked infant ${infantId} to adult ${matchingAdult.id}`);
          } else {
            console.warn(`[Duffel] Could not link infant ${infantId} to an adult — no matching adult at index ${idx}`);
          }
        });

        // Build seat services to send to Duffel at order creation.
        // IMPORTANT: Each seat has per-passenger service IDs (serviceIds[]).
        // Duffel requires exactly one service per passenger per segment.
        // serviceIds[0] = first passenger's service, serviceIds[1] = second, etc.
        const seatServices: { id: string; quantity: number }[] = [];
        let seatServiceTotal = 0;
        if (Array.isArray(seatSelections)) {
          for (const seat of seatSelections) {
            if (!seat.seatNumber) continue;

            // Extract passenger index from passengerId (e.g. "pax_0" → 0, "pax_1" → 1)
            const paxIndex = parseInt(seat.passengerId?.replace('pax_', '') ?? '0', 10);

            // Pick the correct per-passenger service ID
            const serviceIds: string[] = (seat as any).serviceIds ?? [];
            const correctServiceId = serviceIds[paxIndex] ?? seat.serviceId;

            if (correctServiceId) {
              seatServices.push({ id: correctServiceId, quantity: 1 });
              seatServiceTotal += (typeof seat.priceUsd === 'number' ? seat.priceUsd : 0);
              console.log(`[Duffel] Seat ${seat.seatNumber} → pax_${paxIndex} → service: ${correctServiceId}`);
            }
          }
        }
        if (seatServices.length > 0) {
          console.log(`[Duffel] Including ${seatServices.length} seat service(s) in order (extra cost: ${seatServiceTotal.toFixed(2)} ${totalCurrency}): ${seatServices.map(s => s.id).join(', ')}`);
        }

        // ── PROVIDER PAYABLE AMOUNT ──────────────────────────────────────
        // This is the ONLY amount sent to Duffel: provider fare + seat services.
        // Markup, service fee, insurance, protection are NEVER sent to provider.
        providerPayableAmount = revalidatedProviderFare + seatServiceTotal;
        const providerPaymentStr = providerPayableAmount.toFixed(2);

        console.log(
          `[Duffel] Creating order — offer: ${offerId}, pax: ${duffelPassengers.length}, ` +
          `providerPayable: $${providerPaymentStr} ${totalCurrency} ` +
          `(provider fare: $${revalidatedProviderFare.toFixed(2)} + seats: $${seatServiceTotal.toFixed(2)}), ` +
          `customer grand total: $${financials.customerGrandTotal.toFixed(2)}`
        );

        // Debug: log full passenger payload for troubleshooting
        console.log('[Duffel] Passenger payload:', JSON.stringify(duffelPassengers.map(dp => ({
          id: dp.id, type: dp.type, given_name: dp.given_name, family_name: dp.family_name,
          born_on: (dp as any).born_on, infant_passenger_id: (dp as any).infant_passenger_id ?? null,
        })), null, 2));

        // Build the provider order request payload
        const duffelOrderRequest = {
          selected_offers: [offerId],
          passengers: duffelPassengers,
          type: 'instant' as const,
          payments: [{
            type: 'balance' as const,
            amount: providerPaymentStr,
            currency: totalCurrency,
          }],
          ...(seatServices.length > 0 ? { services: seatServices } : {}),
          metadata: { booked_via: 'faremind', session_id: sessionId || '' },
        };

        // Create the order (booking) — payment via Duffel balance
        // Provider receives ONLY providerPayableAmount, NOT the customer total
        try {
          duffelOrder = await duffelRequest<DuffelOrder>('POST', '/air/orders', duffelOrderRequest);
        } catch (seatErr: any) {
          const errMsg = (seatErr.message || '').toLowerCase();
          const errCode = seatErr.errors?.[0]?.code || '';

          // ── Phone number rejection — retry with sanitized phone ──────
          // Duffel (especially in test/sandbox mode) can reject valid E.164
          // phone numbers. If the error is specifically about phone_number,
          // retry with Duffel's known-accepted format.
          const isPhoneError = errCode === 'invalid_phone_number' ||
            (errMsg.includes('phone') && errMsg.includes('invalid'));

          if (isPhoneError) {
            console.warn(`[Duffel] ⚠️ Phone number rejected — retrying with sanitized phone numbers`);

            // Use Duffel's documented example phone as fallback
            const DUFFEL_SAFE_PHONE = '+442080160509';
            const retryPassengers = duffelPassengers.map((dp: any) => ({
              ...dp,
              phone_number: DUFFEL_SAFE_PHONE,
            }));

            const retryRequest = {
              ...duffelOrderRequest,
              passengers: retryPassengers,
            };

            console.log(`[Duffel] Retrying with phone: ${DUFFEL_SAFE_PHONE} for all ${retryPassengers.length} passenger(s)`);

            try {
              duffelOrder = await duffelRequest<DuffelOrder>('POST', '/air/orders', retryRequest);
              console.log(`[Duffel] ✅ Order created (with sanitized phone): ${duffelOrder.id} (PNR: ${duffelOrder.booking_reference})`);
            } catch (phoneRetryErr: any) {
              // If still fails, try without seats as well
              const retryNoSeats = { ...retryRequest };
              delete (retryNoSeats as any).services;
              retryNoSeats.payments = [{
                type: 'balance' as const,
                amount: revalidatedProviderFare.toFixed(2),
                currency: totalCurrency,
              }];
              providerPayableAmount = revalidatedProviderFare;
              seatServiceTotal = 0;

              duffelOrder = await duffelRequest<DuffelOrder>('POST', '/air/orders', retryNoSeats);
              console.log(`[Duffel] ✅ Order created (sanitized phone, no seats): ${duffelOrder.id} (PNR: ${duffelOrder.booking_reference})`);
            }
          } else {
            // If the error is about seat services, retry WITHOUT seat services.
            // Seats can be added post-booking or selected at airline check-in.
            const isSeatError = errMsg.includes('n_per_group') ||
              errMsg.includes('seat service per passenger') ||
              errMsg.includes('services');

            if (isSeatError && seatServices.length > 0) {
              console.warn(`[Duffel] ⚠️ Seat service error — retrying WITHOUT seat services: ${seatErr.message}`);

              // Remove seat services and recalculate provider payable
              const retryRequest = {
                ...duffelOrderRequest,
                payments: [{
                  type: 'balance' as const,
                  amount: revalidatedProviderFare.toFixed(2),
                  currency: totalCurrency,
                }],
              };
              delete (retryRequest as any).services;

              providerPayableAmount = revalidatedProviderFare;
              seatServiceTotal = 0;

              duffelOrder = await duffelRequest<DuffelOrder>('POST', '/air/orders', retryRequest);
              console.log(`[Duffel] ✅ Order created (without seats): ${duffelOrder.id} (PNR: ${duffelOrder.booking_reference})`);
            } else {
              throw seatErr; // re-throw non-seat errors
            }
          }
        }

        console.log(`[Duffel] ✅ Order created: ${duffelOrder.id} (PNR: ${duffelOrder.booking_reference})`);

        // ══════════════════════════════════════════════════════════════════
        // STRIPE CAPTURE — Provider order succeeded, NOW charge the card
        // ══════════════════════════════════════════════════════════════════
        if (stripeVerified && paymentIntentId) {
          try {
            const captured = await stripe.paymentIntents.capture(paymentIntentId);
            console.log(
              `[Stripe] ✅ Payment captured: ${captured.id} — $${(captured.amount / 100).toFixed(2)} ${captured.currency}`
            );
          } catch (captureErr: any) {
            // CRITICAL: Duffel order exists but Stripe capture failed.
            // Log this for manual intervention — the booking is valid,
            // but payment needs to be retried.
            console.error(
              `[Stripe] ❌ CRITICAL: Capture failed for ${paymentIntentId} after Duffel order ${duffelOrder.id}: ${captureErr.message}`
            );
            // Continue with booking — the order exists at the airline.
            // A background job or admin action should retry capture.
          }
        }

        // Map Duffel passenger IDs to our indexes
        duffelOrder.passengers.forEach((dp, i) => {
          duffelPassengerMap[`pax_${i}`] = dp.id;
        });

      } catch (duffelErr: any) {
        console.error('[Duffel] ❌ Order creation failed:', duffelErr.message);
        // Cancel Stripe authorization — customer is NOT charged
        await cancelStripeAuth(`Duffel order failed: ${duffelErr.message}`);

        // ── Show actual Duffel root cause to the user ──────────────────
        const raw = (duffelErr.message || '').toLowerCase();

        // Extract the provider's own title if available (e.g. "Requested offer is no longer available")
        const providerTitle: string = duffelErr.errors?.[0]?.title || duffelErr.errors?.[0]?.message || duffelErr.message || 'The airline was unable to process this booking.';

        // Add actionable hint for known error categories
        let hint = '';
        if (raw.includes('expired') || raw.includes('no longer available') || raw.includes('offer is not valid')) {
          hint = ' Please go back and search for new flights.';
        } else if (raw.includes('timeout') || raw.includes('timed out')) {
          hint = ' The airline system took too long to respond.';
        } else if (raw.includes('503') || raw.includes('service_unavailable') || raw.includes('500') || raw.includes('internal server')) {
          hint = ' The airline system is temporarily unavailable.';
        } else if (raw.includes('infant') && raw.includes('adult')) {
          hint = ' Each infant must be accompanied by an adult traveler.';
        } else if (raw.includes('passenger') && (raw.includes('count') || raw.includes('mismatch'))) {
          hint = ' Please search again with the correct traveler count.';
        } else if (raw.includes('passport') || raw.includes('travel_document')) {
          hint = ' Please verify your passport/travel document details.';
        } else if (raw.includes('date_of_birth') || raw.includes('born_on') || /\bage\b/.test(raw)) {
          hint = ' Please verify all dates of birth are correct.';
        } else if (raw.includes('phone')) {
          hint = ' Please check the contact details.';
        } else if (raw.includes('email')) {
          hint = ' Please verify the email address.';
        } else if (raw.includes('given_name') || raw.includes('family_name')) {
          hint = ' Please check that all passenger names match travel documents.';
        }

        // Ensure provider title ends with punctuation for clean message formatting
        const titleWithPeriod = /[.!?]$/.test(providerTitle.trim()) ? providerTitle.trim() : `${providerTitle.trim()}.`;
        const customerMessage = `${titleWithPeriod}${hint} Booking could not be completed at this time. Your card was not charged. Please try again.`;

        // Audit log — store full error for admin review
        await logBookingFailure({
          passengers, selectedFare, pricing, sourceFlight, sourceRoundTrip,
          paymentIntentId, sessionId, userId, routeLabel: routeLabel ?? '',
          currency, errorCode: 'PROVIDER_ORDER_FAILED',
          errorMessage: duffelErr.message || 'Unknown Duffel error',
          customerMessage, failureStage: 'DUFFEL_ORDER_CREATION',
          offerProvidedAt, offerExpiresAt,
        });

        return NextResponse.json(
          {
            error: `Booking failed: ${duffelErr.message}`,
            errorCode: 'PROVIDER_ORDER_FAILED',
            customerMessage,
          },
          { status: 502 }
        );
      }

    // Use real Duffel PNR if available, otherwise generate local reference
    const masterBookingReference = generateRef();
    const masterPnr = duffelOrder?.booking_reference || generateRef();

    // ── Derive journey source data ───────────────────────────────────────────
    const outSegs: any[] = isRoundTrip
      ? (sourceRoundTrip.outboundJourney?.segments ?? [])
      : (sourceFlight?.segments ?? []);
    const retSegs: any[] = isRoundTrip ? (sourceRoundTrip.returnJourney?.segments ?? []) : [];

    const firstSeg = outSegs[0] ?? null;
    const lastOutSeg = outSegs[outSegs.length - 1] ?? firstSeg;

    const originAirport = isRoundTrip
      ? (sourceRoundTrip.outboundJourney?.departureAirport ?? firstSeg?.departure?.airport ?? '')
      : (firstSeg?.departure?.airport ?? '');
    const originCity = firstSeg?.departure?.city ?? '';
    const destinationAirport = isRoundTrip
      ? (sourceRoundTrip.outboundJourney?.arrivalAirport ?? lastOutSeg?.arrival?.airport ?? '')
      : (lastOutSeg?.arrival?.airport ?? '');
    const destinationCity = lastOutSeg?.arrival?.city ?? '';

    const outDepTime = firstSeg?.departure?.time ? new Date(firstSeg.departure.time) : new Date();
    const outArrTime = lastOutSeg?.arrival?.time ? new Date(lastOutSeg.arrival.time) : new Date();

    const retFirstSeg = retSegs[0] ?? null;
    const retLastSeg = retSegs[retSegs.length - 1] ?? null;

    const airlineCode = isRoundTrip
      ? (sourceRoundTrip.airlines?.[0]?.slice(0, 2) ?? 'XX')
      : (sourceFlight?.airline?.code ?? 'XX');
    const airlineName = isRoundTrip
      ? (sourceRoundTrip.airlines?.[0] ?? 'Unknown')
      : (sourceFlight?.airline?.name ?? 'Unknown');

    const totalAmount = pricing?.total ?? selectedFare?.totalPrice ?? 0;
    const primaryPax = passengers[0] ?? {};
    const customerEmail = primaryPax.email ?? '';
    const customerName = `${primaryPax.firstName ?? ''} ${primaryPax.lastName ?? ''}`.trim();

    // ══════════════════════════════════════════════════════════════════════════
    // AUTO-REGISTER: Primary Contact → Platform User
    // ══════════════════════════════════════════════════════════════════════════
    // The Primary Contact form collects the same fields as Sign Up (First Name,
    // Last Name, Email, Phone). We auto-register them as a platform user so
    // they can sign in via OTP later and access features like DNA Search.
    // If they already have a platform account, we just link the booking to it.

    let resolvedUserId = userId ?? null;

    if (customerEmail) {
      try {
        const normEmail = customerEmail.trim().toLowerCase();
        const existingUser = await prisma.user.findUnique({ where: { email: normEmail } });

        if (existingUser) {
          // User already registered — link booking to their account
          resolvedUserId = existingUser.id;
          console.log(`[Checkout] Platform user found for ${normEmail} → ${existingUser.id}`);
        } else {
          // Auto-register: create platform user from primary contact info
          const newUser = await prisma.user.create({
            data: {
              email:        normEmail,
              firstName:    (primaryPax.firstName ?? '').trim() || 'Traveler',
              lastName:     (primaryPax.lastName ?? '').trim() || '',
              phone:        (primaryPax.phone ?? '').trim() || null,
              passwordHash: 'otp-only',   // OTP-based auth, no password
              emailVerified: false,        // Will be verified on first OTP sign-in
            },
          });
          resolvedUserId = newUser.id;
          console.log(`[Checkout] ✅ Auto-registered platform user for ${normEmail} → ${newUser.id}`);
        }
      } catch (autoRegErr: any) {
        // Non-blocking: if auto-registration fails, booking still proceeds
        // (e.g., race condition with concurrent bookings for same email)
        console.warn(`[Checkout] ⚠️ Auto-registration failed for ${customerEmail}: ${autoRegErr.message}`);
      }
    }

    // ── Full transaction ─────────────────────────────────────────────────────
    const txResult = await prisma.$transaction(async (tx) => {
      // 1. MasterBooking
      const mb = await tx.masterBooking.create({
        data: {
          masterBookingReference,
          masterPnr,
          customerEmail,
          customerName,
          userId: resolvedUserId,
          tripType: isRoundTrip ? 'ROUND_TRIP' : 'ONE_WAY',
          originAirport,
          originCity,
          destinationAirport,
          destinationCity,
          departureDate: outDepTime,
          returnDate: isRoundTrip && retFirstSeg?.departure?.time
            ? new Date(retFirstSeg.departure.time)
            : null,
          bookingStatus: 'CONFIRMED',
          paymentStatus: 'SUCCEEDED',
          ticketingStatus: 'NOT_STARTED',
          totalAmount,
          currency,

          // Financial — Provider Settlement
          providerPayableTotal: providerPayableAmount,
          providerCurrency: providerCurrency,
          providerOfferId: offerId ?? null,
          providerOrderId: duffelOrder?.id ?? null,

          // Offer lifecycle timestamps
          offerProvidedAt: offerProvidedAt ? new Date(offerProvidedAt) : null,
          offerExpiresAt: offerExpiresAt ? new Date(offerExpiresAt) : null,

          // Financial — FareMind Revenue
          markupAmount: financials.markupAmount,
          serviceFeeAmount: financials.serviceFeeAmount,
          fareMindRevenueTotal: financials.fareMindRevenueTotal,

          // Financial — Third-Party Vendor Payables
          priceProtectionAmount: financials.priceProtectionAmount,
          travelInsuranceAmount: financials.travelInsuranceAmount,
          thirdPartyPayableTotal: financials.thirdPartyPayableTotal,

          // Financial — Seat/Ancillary
          seatServiceTotal: financials.seatServiceTotal,

          primaryProvider: 'duffel',
          rawProviderPayload: { sourceFlight: sourceFlight ?? null, sourceRoundTrip: sourceRoundTrip ?? null },

          // Capabilities
          providerCapabilities: {
            addBaggageAllowed: offer?.available_services?.some((s: any) => s.type === 'baggage') ?? false,
          },
        },
      });

      // ── Helper: create segments and return id maps ──────────────────────────
      const makeSegments = async (
        segs: any[],
        journeyId: string,
        dir: 'OUTBOUND' | 'RETURN',
      ): Promise<{ keyToDbId: Record<string, string>; dbIdToJourneyId: Record<string, string> }> => {
        const keyToDbId: Record<string, string> = {};
        const dbIdToJourneyId: Record<string, string> = {};
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          const prevSeg = segs[i - 1] ?? null;
          const layoverAfterMinutes = prevSeg
            ? Math.round((new Date(seg.departure.time).getTime() - new Date(prevSeg.arrival.time).getTime()) / 60000)
            : null;
          const dbSeg = await tx.bookingSegment.create({
            data: {
              bookingId: mb.id,
              journeyId,
              direction: dir,
              segmentOrder: i,
              airlineCode: seg.airline?.code ?? airlineCode,
              airlineName: seg.airline?.name ?? airlineName,
              operatingAirlineCode: seg.operatingCarrier?.code ?? null,
              operatingAirlineName: seg.operatingCarrier?.name ?? null,
              flightNumber: seg.flightNumber ?? '',
              aircraftType: seg.aircraft ?? null,
              cabin: (selectedFare?.cabin ?? 'economy').toUpperCase(),
              fareClass: selectedFare?.name ?? null,
              originAirport: seg.departure?.airport ?? '',
              originCity: seg.departure?.city ?? '',
              originTerminal: seg.departure?.terminal ?? null,
              originGate: seg.departure?.gate ?? null,
              destinationAirport: seg.arrival?.airport ?? '',
              destinationCity: seg.arrival?.city ?? '',
              destinationTerminal: seg.arrival?.terminal ?? null,
              destinationGate: seg.arrival?.gate ?? null,
              departureDateTime: seg.departure?.time ? new Date(seg.departure.time) : new Date(),
              arrivalDateTime: seg.arrival?.time ? new Date(seg.arrival.time) : new Date(),
              durationMinutes: seg.duration ?? 0,
              layoverAfterMinutes,
              providerSegmentId: seg.id ?? null,
              rawSegmentPayload: seg,
            },
          });
          // Index by provider segment id (used by seat/meal selections)
          if (seg.id) keyToDbId[seg.id] = dbSeg.id;
          // Index by position key (round-trip uses out_N / ret_N)
          const prefix = dir === 'OUTBOUND' ? 'out' : 'ret';
          keyToDbId[`${prefix}_${i}`] = dbSeg.id;
          // One-way flights use seg_N keys from the checkout UI
          if (dir === 'OUTBOUND') keyToDbId[`seg_${i}`] = dbSeg.id;
          dbIdToJourneyId[dbSeg.id] = journeyId;
        }
        return { keyToDbId, dbIdToJourneyId };
      };

      // 3. Outbound journey
      const outJourney = await tx.bookingJourney.create({
        data: {
          bookingId: mb.id,
          direction: 'OUTBOUND',
          journeyOrder: 0,
          originAirport,
          originCity,
          destinationAirport,
          destinationCity,
          departureDateTime: outDepTime,
          arrivalDateTime: outArrTime,
          totalDurationMinutes: isRoundTrip
            ? (sourceRoundTrip.outboundJourney?.durationMinutes ?? 0)
            : (sourceFlight?.totalDuration ?? 0),
          totalStops: Math.max(0, outSegs.length - 1),
          primaryAirline: airlineName,
          cabinSummary: selectedFare?.cabin ?? 'economy',
        },
      });
      const { keyToDbId: outKeyMap, dbIdToJourneyId: outDbToJourney } =
        await makeSegments(outSegs, outJourney.id, 'OUTBOUND');

      // 4. Return journey (round-trip only)
      let retJourney: { id: string } | null = null;
      let retKeyMap: Record<string, string> = {};
      let retDbToJourney: Record<string, string> = {};
      if (isRoundTrip && retSegs.length > 0) {
        const retDepTime = retFirstSeg?.departure?.time ? new Date(retFirstSeg.departure.time) : new Date();
        const retArrTime = retLastSeg?.arrival?.time ? new Date(retLastSeg.arrival.time) : new Date();
        retJourney = await tx.bookingJourney.create({
          data: {
            bookingId: mb.id,
            direction: 'RETURN',
            journeyOrder: 1,
            originAirport: retFirstSeg?.departure?.airport ?? destinationAirport,
            originCity: retFirstSeg?.departure?.city ?? destinationCity,
            destinationAirport: retLastSeg?.arrival?.airport ?? originAirport,
            destinationCity: retLastSeg?.arrival?.city ?? originCity,
            departureDateTime: retDepTime,
            arrivalDateTime: retArrTime,
            totalDurationMinutes: sourceRoundTrip.returnJourney?.durationMinutes ?? 0,
            totalStops: Math.max(0, retSegs.length - 1),
            primaryAirline: airlineName,
            cabinSummary: selectedFare?.cabin ?? 'economy',
          },
        });
        const result = await makeSegments(retSegs, retJourney.id, 'RETURN');
        retKeyMap = result.keyToDbId;
        retDbToJourney = result.dbIdToJourneyId;
      }

      // Merged maps
      const allKeyToDbId = { ...outKeyMap, ...retKeyMap };
      const allDbIdToJourney = { ...outDbToJourney, ...retDbToJourney };

      // 5. PNR strategy — determine from provider response shape
      const pnrResult = determinePnrStrategy(
        { bookingReference: masterPnr },
        {
          isRoundTrip,
          origin: originAirport,
          destination: destinationAirport,
          provider: 'duffel',
          outboundJourneyId: outJourney.id,
          returnJourneyId: retJourney?.id ?? null,
        },
      );

      for (const entry of pnrResult.pnrs) {
        await tx.bookingPnr.create({
          data: {
            bookingId: mb.id,
            pnrCode: entry.pnrCode ?? masterPnr,
            pnrType: entry.pnrType,
            journeyDirection: entry.journeyDirection,
            isPrimary: entry.isPrimary,
            status: entry.status,
            provider: entry.provider,
            // Store real Duffel order ID so post-booking operations work
            providerOrderId: duffelOrder?.id ?? entry.providerOrderId ?? null,
            airlineCode: entry.airlineCode ?? null,
            airlineName: entry.airlineName ?? null,
            displayLabel: entry.displayLabel,
            // Fare rules from selected fare — stored per-PNR for manage-booking
            refundable:       selectedFare?.policy?.refundable ?? false,
            changeable:       selectedFare?.policy?.changeable ?? false,
            cancellationFee:  selectedFare?.policy?.refundFeeUsd ?? null,
            changeFee:        selectedFare?.policy?.changeFeeUsd ?? null,
            seatSelection:    selectedFare?.policy?.seatSelection ?? null,
            seatSelectionFee: selectedFare?.policy?.seatSelectionFeeUsd ?? null,
            milesEarning:     selectedFare?.policy?.milesEarning ?? null,
            fareRulesJson:    selectedFare?.policy ?? null,
          },
        });
      }

      await tx.masterBooking.update({
        where: { id: mb.id },
        data: {
          pnrStrategy: pnrResult.strategy,
          isSplitTicket: pnrResult.isSplitTicket,
          isSelfTransfer: pnrResult.isSelfTransfer,
          connectionProtStatus: pnrResult.connectionProtectionStatus,
          pnrCount: pnrResult.pnrCount,
          riskLabel: pnrResult.riskLabel,
          riskExplanation: pnrResult.riskExplanation,
        },
      });

      // 7. Passengers
      const passengerIdMap: Record<string, string> = {};
      const dbPaxIds: string[] = [];

      for (let i = 0; i < passengers.length; i++) {
        const p = passengers[i];
        const dbPax = await tx.bookingPassenger.create({
          data: {
            bookingId: mb.id,
            passengerOrder: i,
            passengerType: p.type ?? 'adult',
            firstName: p.firstName ?? '',
            middleName: p.middleName ?? null,
            lastName: p.lastName ?? '',
            email: p.email ?? null,
            phone: p.phone ?? null,
            gender: p.gender ?? null,
            dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
            nationality: p.nationality ?? null,
            passportCountry: p.passportCountry ?? null,
            passportNumber: p.passportNumber ?? null,
            passportExpiry: p.passportExpiry ? new Date(p.passportExpiry) : null,
          },
        });
        const storeId = p.id ?? `pax_${i}`;
        passengerIdMap[storeId] = dbPax.id;
        dbPaxIds.push(dbPax.id);
      }

      // 8. Tickets (one per passenger per journey)
      const journeys = [outJourney, ...(retJourney ? [retJourney] : [])];
      for (const paxId of dbPaxIds) {
        for (const j of journeys) {
          await tx.bookingTicket.create({
            data: {
              bookingId: mb.id,
              passengerId: paxId,
              journeyId: j.id,
              ticketStatus: 'PENDING',
              airlineCode,
            },
          });
        }
      }

      // 7. Seats
      if (Array.isArray(seatSelections)) {
        for (const seat of seatSelections) {
          if (!seat.seatNumber) continue;
          const paxId = passengerIdMap[seat.passengerId];
          if (!paxId) continue;
          const dbSegId = seat.segmentKey ? allKeyToDbId[seat.segmentKey] : null;
          if (!dbSegId) continue;
          const journeyId = allDbIdToJourney[dbSegId] ?? outJourney.id;
          await tx.bookingSeat.create({
            data: {
              bookingId: mb.id,
              passengerId: paxId,
              journeyId,
              segmentId: dbSegId,
              seatNumber: seat.seatNumber,
              seatType: seat.preference ?? 'unknown',
              seatPrice: seat.priceUsd ?? 0,
              currency,
              seatStatus: 'CONFIRMED',
            },
          }).catch(() => null);
        }
      }

      // 8. Meals
      if (Array.isArray(mealSelections)) {
        for (const meal of mealSelections) {
          const mealCode = meal.mealType ?? meal.meal ?? '';
          if (!mealCode || mealCode === 'STANDARD' || mealCode === 'NONE') continue;
          const paxId = passengerIdMap[meal.passengerId];
          if (!paxId) continue;
          const segKey = meal.segmentKey ?? '';
          const dbSegId = segKey ? allKeyToDbId[segKey] : null;
          // Map 'outbound'/'return'/'out'/'ret' direction keys to correct journeyId
          let journeyId: string;
          if ((segKey === 'return' || segKey === 'ret') && retJourney) {
            journeyId = retJourney.id;
          } else if (dbSegId) {
            journeyId = allDbIdToJourney[dbSegId] ?? outJourney.id;
          } else {
            journeyId = outJourney.id;
          }
          const isReturn = journeyId === retJourney?.id;
          await tx.bookingMeal.create({
            data: {
              bookingId: mb.id,
              passengerId: paxId,
              journeyId,
              segmentId: dbSegId ?? null,
              direction: isReturn ? 'RETURN' : 'OUTBOUND',
              mealCode,
              mealLabel: meal.mealLabel ?? mealCode,
              mealPrice: meal.priceUsd ?? 0,
              currency,
              mealStatus: 'CONFIRMED',
            },
          }).catch(() => null);
        }
      }

      // 9. Baggage
      if (typeof extraBags === 'number' && extraBags > 0) {
        await tx.bookingBaggage.create({
          data: {
            bookingId: mb.id,
            baggageType: 'checked',
            quantity: extraBags,
            baggagePrice: extraBags * 35,
            currency,
          },
        }).catch(() => null);
      }

      // 10. Price protection add-on
      if (priceProtection) {
        await tx.bookingAddon.create({
          data: {
            bookingId: mb.id,
            addonType: 'PRICE_PROTECTION',
            addonName: 'Price Drop Protection',
            amount: pricing?.protectionFee ?? 0,
            currency,
          },
        }).catch(() => null);
      }

      // 11. Travel insurance add-on
      if (travelInsurance) {
        await tx.bookingAddon.create({
          data: {
            bookingId: mb.id,
            addonType: 'TRAVEL_INSURANCE',
            addonName: 'Travel Insurance',
            amount: pricing?.insuranceFee ?? 0,
            currency,
          },
        }).catch(() => null);
      }

      // 12. Payment record
      await tx.bookingPayment.create({
        data: {
          bookingId: mb.id,
          stripePaymentIntentId: paymentIntentId ?? null,
          amount: totalAmount,
          currency,
          status: 'SUCCEEDED',
          paidAt: new Date(),
        },
      }).catch(() => null);

      // 13. Booking confirmed event
      await tx.bookingEvent.create({
        data: {
          bookingId: mb.id,
          eventType: 'BOOKING_CONFIRMED',
          eventTitle: 'Booking Confirmed',
          eventDescription: `Reference ${masterBookingReference} · Airline PNR ${masterPnr} · ${passengers.length} passenger(s)`,
          actorType: 'system',
          actorName: 'FareMind',
        },
      }).catch(() => null);

      // 14. Raw provider payload snapshot
      await tx.bookingProviderPayload.create({
        data: {
          bookingId: mb.id,
          provider: 'duffel',
          payloadType: 'OFFER_SELECTED',
          payloadJson: {
            sourceFlight: sourceFlight ?? null,
            sourceRoundTrip: sourceRoundTrip ?? null,
            selectedFare,
            duffelOfferId: offerId ?? null,
          },
        },
      }).catch(() => null);

      // 15. Store Duffel order response if available
      if (duffelOrder) {
        await tx.bookingProviderPayload.create({
          data: {
            bookingId: mb.id,
            provider: 'duffel',
            payloadType: 'ORDER_CREATED',
            providerReference: duffelOrder.id,
            payloadJson: duffelOrder as any,
          },
        }).catch(() => null);

        // 15b. Store the outgoing ORDER_REQUEST payload for audit
        // This records exactly what FareMind sent to Duffel, including
        // the providerPayableAmount (NOT the customer grand total).
        await tx.bookingProviderPayload.create({
          data: {
            bookingId: mb.id,
            provider: 'duffel',
            payloadType: 'ORDER_REQUEST',
            payloadJson: {
              endpoint: 'POST /air/orders',
              providerPayableAmount,
              providerCurrency,
              customerGrandTotal: totalAmount,
              financialBreakdown: {
                providerTotalFare: financials.providerTotalFare,
                markupAmount: financials.markupAmount,
                serviceFeeAmount: financials.serviceFeeAmount,
                seatServiceTotal: financials.seatServiceTotal,
                priceProtectionAmount: financials.priceProtectionAmount,
                travelInsuranceAmount: financials.travelInsuranceAmount,
                fareMindRevenueTotal: financials.fareMindRevenueTotal,
                thirdPartyPayableTotal: financials.thirdPartyPayableTotal,
                providerPayableTotal: financials.providerPayableTotal,
              },
              selected_offers: [offerId],
              passengerCount: passengers.length,
            },
          },
        }).catch(() => null);

        // Update ticketing status — Duffel instant orders are auto-ticketed
        await tx.masterBooking.update({
          where: { id: mb.id },
          data: { ticketingStatus: 'ISSUED' },
        });
      }

      // 16. Commercial charge snapshot — write fee breakdown for audit trail
      try {
        const { calculateCommercialFees, calculateFallbackFees } = await import('@/lib/fee-engine');
        const paxForEngine = passengers.map((p: any, i: number) => ({
          id: `pax_${i}`,
          type: p.type || 'adult',
          baseFare: (pricing?.perPassenger?.[i]?.baseFare ?? 0) + (pricing?.perPassenger?.[i]?.taxes ?? 0),
        }));
        const feeCtx = {
          provider: 'duffel',
          tripType: isRoundTrip ? 'ROUND_TRIP' : 'ONE_WAY',
          cabin: (selectedFare?.cabin ?? 'economy').toLowerCase(),
          fareClass: selectedFare?.name ?? undefined,
          passengers: paxForEngine,
          supplierFareTotal: paxForEngine.reduce((s: number, p: any) => s + p.baseFare, 0),
          bookingTotalBeforeFees: totalAmount,
          currency,
        };
        let feeResult;
        try { feeResult = await calculateCommercialFees(feeCtx); } catch { feeResult = calculateFallbackFees(feeCtx); }

        const chargeInserts = [];
        // Service fee
        if (feeResult.serviceFee > 0) {
          chargeInserts.push({
            masterBookingId: mb.id, chargeType: 'SERVICE_FEE' as const, sourceType: 'PLATFORM' as const,
            calculationModel: feeResult.charges.find((c: any) => c.chargeType === 'SERVICE_FEE')?.calculationModel ?? 'FIXED_PER_TRAVELER',
            ruleId: feeResult.charges.find((c: any) => c.chargeType === 'SERVICE_FEE')?.ruleId ?? null,
            unitAmount: feeResult.charges.find((c: any) => c.chargeType === 'SERVICE_FEE')?.unitAmount ?? feeResult.serviceFee,
            quantity: passengers.length, totalAmount: feeResult.serviceFee, currency,
            displayToCustomer: true, rawRuleSnapshot: feeResult.charges.find((c: any) => c.chargeType === 'SERVICE_FEE')?.ruleSnapshot ?? null,
          });
        }
        // Markup (if any)
        if (feeResult.markupFee > 0) {
          chargeInserts.push({
            masterBookingId: mb.id, chargeType: 'MARKUP_FEE' as const, sourceType: 'PLATFORM' as const,
            calculationModel: feeResult.charges.find((c: any) => c.chargeType === 'MARKUP_FEE')?.calculationModel ?? 'PERCENTAGE_OF_FARE',
            ruleId: feeResult.charges.find((c: any) => c.chargeType === 'MARKUP_FEE')?.ruleId ?? null,
            unitAmount: feeResult.markupFee, quantity: 1, totalAmount: feeResult.markupFee, currency,
            displayToCustomer: false, rawRuleSnapshot: feeResult.charges.find((c: any) => c.chargeType === 'MARKUP_FEE')?.ruleSnapshot ?? null,
          });
        }
        // Protection
        if (priceProtection && feeResult.protectionFeeTotal > 0) {
          chargeInserts.push({
            masterBookingId: mb.id, chargeType: 'PRICE_DROP_PROTECTION' as const, sourceType: 'ADMIN_CONFIG' as const,
            calculationModel: feeResult.charges.find((c: any) => c.chargeType === 'PRICE_DROP_PROTECTION')?.calculationModel ?? 'PERCENTAGE_OF_FARE',
            ruleId: feeResult.charges.find((c: any) => c.chargeType === 'PRICE_DROP_PROTECTION')?.ruleId ?? null,
            unitAmount: feeResult.protectionFee, quantity: passengers.length, totalAmount: feeResult.protectionFeeTotal, currency,
            displayToCustomer: true, rawRuleSnapshot: feeResult.charges.find((c: any) => c.chargeType === 'PRICE_DROP_PROTECTION')?.ruleSnapshot ?? null,
          });
        }
        // Insurance
        if (travelInsurance && feeResult.insuranceFeeTotal > 0) {
          chargeInserts.push({
            masterBookingId: mb.id, chargeType: 'TRAVEL_INSURANCE' as const, sourceType: 'ADMIN_CONFIG' as const,
            calculationModel: feeResult.charges.find((c: any) => c.chargeType === 'TRAVEL_INSURANCE')?.calculationModel ?? 'PERCENTAGE_OF_BOOKING_TOTAL',
            ruleId: feeResult.charges.find((c: any) => c.chargeType === 'TRAVEL_INSURANCE')?.ruleId ?? null,
            unitAmount: feeResult.insuranceFee, quantity: passengers.length, totalAmount: feeResult.insuranceFeeTotal, currency,
            displayToCustomer: true, rawRuleSnapshot: feeResult.charges.find((c: any) => c.chargeType === 'TRAVEL_INSURANCE')?.ruleSnapshot ?? null,
          });
        }
        if (chargeInserts.length > 0) {
          await tx.bookingCommercialCharge.createMany({ data: chargeInserts });
          console.log(`[booking] ✅ Wrote ${chargeInserts.length} commercial charge snapshot(s)`);
        }
      } catch (feeErr) {
        // Don't block booking creation if fee snapshot fails
        console.error('[booking] ⚠️ Commercial charge snapshot failed (non-blocking):', feeErr);
      }

      return { mb, pnrResult };
    }, { timeout: 30000, maxWait: 10000 });

    const { mb: masterBooking, pnrResult } = txResult;
    const confirmedAt = new Date().toISOString();

    // Fetch full booking with all relations for rich email itinerary
    const fullBooking = await prisma.masterBooking.findUnique({
      where: { id: masterBooking.id },
      include: {
        journeys: { include: { segments: true }, orderBy: { journeyOrder: 'asc' } },
        passengers: { orderBy: { passengerOrder: 'asc' } },
        seats: true,
        meals: true,
        baggage: true,
        addons: true,
        pnrs: true,
        payments: true,
      },
    }).catch(() => null);

    // Fire email notifications (non-blocking)
    fireNotification({
      event_type: 'BOOKING_CONFIRMED',
      booking_id: masterBooking.id,
      customer_email: customerEmail || undefined,
      data: {
        booking_reference: masterBookingReference,
        pnr: masterPnr,
        customer_name: customerName,
        customer_email: customerEmail,
        origin: originAirport,
        destination: destinationAirport,
        route: `${originAirport} - ${destinationAirport}`,
        airline: airlineName,
        fare_class: selectedFare?.cabin ?? 'Economy',
        passengers: passengers.map((p: any) => ({ name: `${p.firstName} ${p.lastName}`.trim(), type: p.type ?? 'adult' })),
        total_amount: `$${totalAmount.toLocaleString()}`,
        total_charged: totalAmount,
        currency,
        confirmed_at: new Date(confirmedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
        payment_intent_id: paymentIntentId ?? '',
        full_booking_data: fullBooking ?? undefined,
      },
    });

    fireNotification({
      event_type: 'PAYMENT_SUCCESS',
      booking_id: masterBooking.id,
      customer_email: customerEmail || undefined,
      data: {
        booking_reference: masterBookingReference,
        pnr: masterPnr,
        customer_name: customerName,
        customer_email: customerEmail,
        origin: originAirport,
        destination: destinationAirport,
        route: `${originAirport} - ${destinationAirport}`,
        airline: airlineName,
        total_amount: `$${totalAmount.toLocaleString()}`,
        total_charged: totalAmount,
        currency,
        payment_intent_id: paymentIntentId ?? '',
        confirmed_at: new Date(confirmedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
      },
    });

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 3 — Customer-Safe Confirmation Response
    // ══════════════════════════════════════════════════════════════════════════
    // Return ONLY customer-facing data. Explicitly exclude:
    //   - providerPayableTotal, providerOrderId, providerOfferId
    //   - markupAmount, serviceFeeAmount, fareMindRevenueTotal
    //   - thirdPartyPayableTotal, raw provider payloads
    //   - internal reconciliation data

    // Determine if auto-registration created a new user
    const isNewPlatformUser = resolvedUserId && resolvedUserId !== userId;

    return NextResponse.json({
      success: true,
      pnr: masterPnr,
      bookingId: masterBooking.id,
      masterBookingReference: masterBooking.masterBookingReference,
      status: 'confirmed',
      confirmedAt,
      passengerNames: passengers.map((p: any) => `${p.firstName} ${p.lastName}`.trim()),
      totalCharged: totalAmount,
      currency,
      platformUserId: resolvedUserId ?? undefined,
      isNewPlatformUser: !!isNewPlatformUser,
      pnrStrategy: pnrResult.strategy,
      isSplitTicket: pnrResult.isSplitTicket,
      riskLabel: pnrResult.riskLabel,
      riskExplanation: pnrResult.riskExplanation,
      pnrs: pnrResult.pnrs.map(e => ({
        pnrCode:          e.pnrCode ?? masterPnr,
        pnrType:          e.pnrType,
        journeyDirection: e.journeyDirection,
        isPrimary:        e.isPrimary,
        airlineCode:      e.airlineCode ?? null,
        airlineName:      e.airlineName ?? null,
        displayLabel:     e.displayLabel,
      })),
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error('[checkout/bookings/confirm] error:', msg, err);

    // Extract Duffel root cause if available
    let customerMsg: string;
    if (err instanceof DuffelBookingError && err.errors?.length > 0) {
      const providerTitle = err.errors[0]?.title || err.errors[0]?.message || msg;
      customerMsg = `${providerTitle}. Booking could not be completed at this time. Your card was not charged. Please try again.`;
    } else {
      // For non-Duffel errors, show actual error context (sanitized)
      const safeMsg = msg.includes('Duffel') || msg.includes('offer') || msg.includes('expired') || msg.includes('passenger')
        ? msg.replace(/Duffel API error \(\d+\): /g, '')
        : 'An unexpected error occurred';
      customerMsg = `${safeMsg}. Booking could not be completed at this time. Your card was not charged. Please try again.`;
    }

    // Audit log — capture unexpected errors for admin review
    // NOTE: body may not be available if JSON parsing itself failed,
    // so we guard every field access with try/catch.
    try {
      await logBookingFailure({
        passengers: [],
        selectedFare: {},
        pricing: {},
        sourceFlight: null,
        sourceRoundTrip: null,
        paymentIntentId: null,
        sessionId: null,
        userId: null,
        routeLabel: '',
        currency: 'USD',
        errorCode: 'UNEXPECTED_ERROR',
        errorMessage: msg,
        customerMessage: customerMsg,
        failureStage: 'UNKNOWN',
      });
    } catch { /* never let audit break the response */ }

    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'development' ? msg : 'Internal server error',
        customerMessage: customerMsg,
      },
      { status: 500 }
    );
  }
}
