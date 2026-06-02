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
    throw new Error(`Duffel API error (${response.status}): ${msg}`);
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
      userId,
      currency = 'USD',
    } = body;

    if (!Array.isArray(passengers) || passengers.length === 0) {
      return NextResponse.json({ error: 'passengers required' }, { status: 400 });
    }

    const isRoundTrip = !!sourceRoundTrip;

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1 — Financial Breakdown & Pricing Validation
    // ══════════════════════════════════════════════════════════════════════════
    // Compute the backend source-of-truth for pricing BEFORE calling provider.
    // The provider API must only receive providerPayableTotal, never the
    // customer grand total which includes markup, service fee, insurance, etc.

    const offerId = selectedFare?.offerId || selectedFare?.id || selectedFare?.duffelOfferId;

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
    const frontendTotal = pricing?.total ?? selectedFare?.totalPrice ?? 0;

    // Compute financial breakdown using backend source-of-truth
    // providerTotalFare is the authoritative base from the markup service
    const baseProviderFare = storedProviderFare
      ?? (selectedFare?.basePrice ?? (frontendTotal - frontendMarkup - frontendServiceFee - frontendProtectionFee - frontendInsuranceFee - frontendSeatFees));

    let financials: FinancialBreakdown = computeFinancialBreakdown({
      providerTotalFare: baseProviderFare,
      markupAmount: frontendMarkup,
      serviceFeeAmount: frontendServiceFee,
      seatServiceTotal: frontendSeatFees,
      priceProtectionAmount: frontendProtectionFee,
      travelInsuranceAmount: frontendInsuranceFee,
    });

    // Validate: does the frontend total match our backend-computed total?
    const pricingCheck = validateCheckoutPricing(frontendTotal, financials.customerGrandTotal);
    if (!pricingCheck.valid) {
      console.error(`[Checkout] ❌ ${pricingCheck.error}`);
      return NextResponse.json(
        {
          error: 'Pricing mismatch — the displayed price does not match our records. Please try again.',
          errorCode: pricingCheck.errorCode,
          detail: process.env.NODE_ENV === 'development' ? pricingCheck.error : undefined,
        },
        { status: 409 }
      );
    }

    console.log(
      `[Checkout] Financial breakdown — provider: $${financials.providerPayableTotal.toFixed(2)}, ` +
      `markup: $${financials.markupAmount.toFixed(2)}, svcFee: $${financials.serviceFeeAmount.toFixed(2)}, ` +
      `protection: $${financials.priceProtectionAmount.toFixed(2)}, insurance: $${financials.travelInsuranceAmount.toFixed(2)}, ` +
      `customer total: $${financials.customerGrandTotal.toFixed(2)}`
    );

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE 1b — Stripe Authorization Verification
    // ══════════════════════════════════════════════════════════════════════════
    // Verify that Stripe has AUTHORIZED (not captured) the customer's payment.
    // With capture_method: 'manual', the status should be 'requires_capture'.
    // We capture ONLY after the provider order succeeds.
    // If anything fails, we cancel the authorization — customer is never charged.

    let stripeVerified = false;
    if (paymentIntentId && !paymentIntentId.startsWith('pi_demo_')) {
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
    } else {
      console.warn(`[Checkout] Stripe verification skipped — demo intent or no paymentIntentId`);
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

    // Helper: cancel Stripe authorization — customer is never charged
    const cancelStripeAuth = async (reason: string) => {
      if (stripeVerified && paymentIntentId && !paymentIntentId.startsWith('pi_demo_')) {
        try {
          await stripe.paymentIntents.cancel(paymentIntentId);
          console.log(`[Stripe] Authorization cancelled (${paymentIntentId}) — reason: ${reason}`);
        } catch (cancelErr: any) {
          console.error(`[Stripe] Failed to cancel authorization: ${cancelErr.message}`);
        }
      }
    };

    if (offerId && DUFFEL_API_TOKEN) {
      try {
        // Normalize phone to E.164 format for Duffel
        const normalizePhone = (raw: string): string => {
          if (!raw || !raw.trim()) return '+10000000000';
          let cleaned = raw.trim();
          const hasPlus = cleaned.startsWith('+');
          // Strip everything except digits
          const digits = cleaned.replace(/\D/g, '');
          if (digits.length === 0) return '+10000000000';
          
          // 10 digits (with or without +) → assume US number, prepend +1
          // This catches the common case where user enters area code + number
          // without country code (e.g. 9726971532 or +9726971532)
          if (digits.length === 10) return `+1${digits}`;
          
          // 11 digits starting with 1 → US with country code
          if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
          
          // If already has + and more than 10 digits, trust the country code
          if (hasPlus && digits.length >= 11) return `+${digits}`;
          
          // Other lengths with 7+ digits — prepend +
          if (digits.length >= 7) return `+${digits}`;
          return '+10000000000';
        };

        // Verify offer is still valid and get passenger IDs from the offer
        const offer = await duffelRequest<any>('GET', `/air/offers/${offerId}?return_available_services=false`);
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

        // Use the REVALIDATED provider fare as the authoritative amount
        // Recompute financials with the fresh provider fare
        financials = computeFinancialBreakdown({
          providerTotalFare: revalidatedProviderFare,
          markupAmount: financials.markupAmount,
          serviceFeeAmount: financials.serviceFeeAmount,
          seatServiceTotal: financials.seatServiceTotal,
          priceProtectionAmount: financials.priceProtectionAmount,
          travelInsuranceAmount: financials.travelInsuranceAmount,
        });

        // Duffel offers come with pre-assigned passenger IDs (e.g. pas_0000ABC...).
        // We MUST use these exact IDs when creating the order.
        const offerPassengers: Array<{ id: string; type: string }> = offer.passengers ?? [];

        // Verify passenger count matches what Duffel expects
        if (offerPassengers.length !== passengers.length) {
          console.warn(
            `[Duffel] Passenger count mismatch: offer has ${offerPassengers.length} passenger(s) but checkout has ${passengers.length}. ` +
            `The offer was likely searched for a different number of travelers.`
          );
          await cancelStripeAuth('passenger count mismatch');
          return NextResponse.json(
            { error: `This offer was booked for ${offerPassengers.length} traveler(s) but you have ${passengers.length}. Please search again with the correct number of passengers.` },
            { status: 400 }
          );
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

          return {
            id: paxId ?? '',
            type: duffelType,
            given_name: p.firstName || 'Unknown',
            family_name: p.lastName || 'Traveler',
            born_on: p.dateOfBirth || '1990-01-01',
            gender: p.gender === 'female' ? 'f' : 'm',
            email: p.email || 'guest@faremind.ai',
            phone_number: normalizePhone(p.phone),
            title: p.gender === 'female' ? 'ms' : 'mr',
          };
        });

        // Log phone normalization for debugging
        duffelPassengers.forEach((dp, i) => {
          console.log(`[Duffel] Passenger ${i}: phone raw="${passengers[i]?.phone}" → normalized="${dp.phone_number}"`);
        });

        // Build seat services to send to Duffel at order creation.
        // Each seatSelection with a serviceId maps to a Duffel service add-on.
        const seatServices: { id: string; quantity: number }[] = [];
        let seatServiceTotal = 0;
        if (Array.isArray(seatSelections)) {
          for (const seat of seatSelections) {
            if (seat.serviceId && seat.seatNumber) {
              seatServices.push({ id: seat.serviceId, quantity: 1 });
              seatServiceTotal += (typeof seat.priceUsd === 'number' ? seat.priceUsd : 0);
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
        duffelOrder = await duffelRequest<DuffelOrder>('POST', '/air/orders', duffelOrderRequest);

        console.log(`[Duffel] ✅ Order created: ${duffelOrder.id} (PNR: ${duffelOrder.booking_reference})`);

        // ══════════════════════════════════════════════════════════════════
        // STRIPE CAPTURE — Provider order succeeded, NOW charge the card
        // ══════════════════════════════════════════════════════════════════
        if (stripeVerified && paymentIntentId && !paymentIntentId.startsWith('pi_demo_')) {
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
        return NextResponse.json(
          {
            error: `Booking failed: ${duffelErr.message}`,
            errorCode: 'PROVIDER_ORDER_FAILED',
            customerMessage: 'Unfortunately the fare is no longer available. Your card was not charged. Please refresh flight results.',
          },
          { status: 502 }
        );
      }
    } else {
      console.warn('[booking] No offerId or DUFFEL_API_TOKEN — creating local-only booking (dev fallback)');
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

    // ── Full transaction ─────────────────────────────────────────────────────
    const txResult = await prisma.$transaction(async (tx) => {
      // 1. MasterBooking
      const mb = await tx.masterBooking.create({
        data: {
          masterBookingReference,
          masterPnr,
          customerEmail,
          customerName,
          userId: userId ?? null,
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
          eventDescription: `Reference ${masterBookingReference} · PNR ${masterPnr} · ${passengers.length} passenger(s)`,
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
    });

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
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? msg : 'Internal server error' },
      { status: 500 }
    );
  }
}
