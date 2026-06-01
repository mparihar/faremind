import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { fireNotification } from '@/lib/notify';
import { determinePnrStrategy } from '@/lib/pnr-strategy';

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

    // ── Step 0: Create REAL Duffel order ─────────────────────────────────────
    // The offerId comes from the search response, stored on selectedFare
    const offerId = selectedFare?.offerId || selectedFare?.id || selectedFare?.duffelOfferId;
    let duffelOrder: DuffelOrder | null = null;
    let duffelPassengerMap: Record<string, string> = {}; // our pax index → duffel passenger id

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
          return NextResponse.json(
            { error: 'This flight offer has expired. Please search again.' },
            { status: 400 }
          );
        }

        const totalAmount = parseFloat(offer.total_amount);
        const totalCurrency = offer.total_currency;

        // Duffel offers come with pre-assigned passenger IDs (e.g. pas_0000ABC...).
        // We MUST use these exact IDs when creating the order.
        const offerPassengers: Array<{ id: string; type: string }> = offer.passengers ?? [];

        // Verify passenger count matches what Duffel expects
        if (offerPassengers.length !== passengers.length) {
          console.warn(
            `[Duffel] Passenger count mismatch: offer has ${offerPassengers.length} passenger(s) but checkout has ${passengers.length}. ` +
            `The offer was likely searched for a different number of travelers.`
          );
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
              // Add the seat price to the total (price comes from the frontend store)
              seatServiceTotal += (typeof seat.priceUsd === 'number' ? seat.priceUsd : 0);
            }
          }
        }
        if (seatServices.length > 0) {
          console.log(`[Duffel] Including ${seatServices.length} seat service(s) in order (extra cost: ${seatServiceTotal.toFixed(2)} ${totalCurrency}): ${seatServices.map(s => s.id).join(', ')}`);
        }

        // Payment amount must match offer total + any service costs
        const paymentAmount = (totalAmount + seatServiceTotal).toFixed(2);

        console.log(`[Duffel] Creating order with offer ${offerId}, ${duffelPassengers.length} passenger(s), payment: ${paymentAmount} ${totalCurrency}, IDs: ${duffelPassengers.map(p => p.id).join(', ')}`);
        console.log(`[Duffel] Full passenger payload:`, JSON.stringify(duffelPassengers, null, 2));
        // Create the order (booking) — payment via Duffel balance
        duffelOrder = await duffelRequest<DuffelOrder>('POST', '/air/orders', {
          selected_offers: [offerId],
          passengers: duffelPassengers,
          type: 'instant',
          payments: [{
            type: 'balance',
            amount: paymentAmount,
            currency: totalCurrency,
          }],
          // Include seat selections as services so the airline assigns the exact seats
          ...(seatServices.length > 0 ? { services: seatServices } : {}),
          metadata: { booked_via: 'faremind', session_id: sessionId || '' },
        });

        console.log(`[Duffel] ✅ Order created: ${duffelOrder.id} (PNR: ${duffelOrder.booking_reference})`);

        // Map Duffel passenger IDs to our indexes
        duffelOrder.passengers.forEach((dp, i) => {
          duffelPassengerMap[`pax_${i}`] = dp.id;
        });

      } catch (duffelErr: any) {
        console.error('[Duffel] ❌ Order creation failed:', duffelErr.message);
        return NextResponse.json(
          { error: `Booking failed: ${duffelErr.message}` },
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
