'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  X,
  Shield,
  ChevronRight,
  Plane,
  Lock,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { OfferExpiryTimer } from '@/components/checkout/OfferExpiryTimer';
import { OfferExpiryModals } from '@/components/checkout/OfferExpiryModals';
import { useFareStore } from '@/store/useFareStore';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import { useOfferSessionStore } from '@/store/useOfferSessionStore';
import type { PricingBreakdown } from '@/store/useCheckoutStore';
import type { FareOption } from '@/lib/fare-types';
import type { JourneySegment } from '@/lib/round-trip-types';
import type { FlightSegment } from '@/lib/types';
import { formatTime, formatDuration, formatDate, cn, formatPrice } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { useFeeLoader } from '@/hooks/useFeeLoader';
import { useBuildPricingConfig } from '@/hooks/usePricingConfig';
import { isBundleEnabled } from '@/lib/bundle-flags';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_INDEX = 0;

const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy',
  premium_economy: 'Premium Economy',
  business: 'Business',
  first: 'First',
};

// ─── Display segment shape ────────────────────────────────────────────────────

interface DisplaySeg {
  key: string;
  label: string;
  from: string;
  to: string;
  depTime: string;
  arrTime: string;
  durationMin: number;
  stops: number;
  flightNumbers: string;
  airline: string;
  date: string;
}

// ─── Helper: build display segments ──────────────────────────────────────────

function buildSegmentsFromJourney(journey: JourneySegment, label: string, key: string): DisplaySeg {
  return {
    key,
    label,
    from: journey.departureAirport,
    to: journey.arrivalAirport,
    depTime: journey.departureTime,
    arrTime: journey.arrivalTime,
    durationMin: journey.durationMinutes,
    stops: journey.stops,
    flightNumbers: journey.flightNumbers.join(', '),
    airline: journey.airlineNames[0] ?? '',
    date: journey.departureTime,
  };
}

function buildSegmentsFromFlight(segments: FlightSegment[], label: string, key: string): DisplaySeg {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return { key, label, from: '', to: '', depTime: '', arrTime: '', durationMin: 0, stops: 0, flightNumbers: '', airline: '', date: '' };

  const totalMin = segments.reduce((sum, s) => sum + s.duration, 0);
  return {
    key,
    label,
    from: first.departure.airport,
    to: last.arrival.airport,
    depTime: first.departure.time,
    arrTime: last.arrival.time,
    durationMin: totalMin,
    stops: segments.length - 1,
    flightNumbers: segments.map(s => s.flightNumber).join(', '),
    airline: first.airline.name,
    date: first.departure.time,
  };
}



function SegmentCard({ seg }: { seg: DisplaySeg }) {
  const router = useRouter();
  const depLabel = formatTime(seg.depTime);
  const arrLabel = formatTime(seg.arrTime);
  const dateLabel = formatDate(seg.date);
  const dur = formatDuration(seg.durationMin);
  const stopsLabel = seg.stops === 0 ? 'Non-stop' : seg.stops === 1 ? '1 stop' : `${seg.stops} stops`;

  const handleChangeFlight = () => {
    // Reconstruct search URL preserving passenger counts from session context
    try {
      const raw = sessionStorage.getItem('fm_fare_context');
      const ctx = raw ? JSON.parse(raw) : {};
      const origin = ctx.origin || seg.from;
      const destination = ctx.destination || seg.to;
      const adults = ctx.adults ?? 1;
      const children = ctx.children ?? 0;
      const infants = ctx.infants ?? 0;
      const date = ctx.date || '';
      const cabin = ctx.cabin || 'economy';
      const trip = ctx.trip || 'one_way';
      const returnDate = ctx.returnDate || '';

      const params = new URLSearchParams({
        origin,
        destination,
        adults: String(adults),
        children: String(children),
        infants: String(infants),
        cabin,
        trip,
      });
      if (date) params.set('date', date);
      if (returnDate) params.set('return', returnDate);

      router.push(`/search?${params.toString()}`);
    } catch {
      // Fallback to browser back
      router.back();
    }
  };

  return (
    <div className="space-y-3">
      {/* Segment label badge */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold text-white bg-[#1ABC9C]">
          <Plane size={11} strokeWidth={2.5} />
          {seg.label}
        </span>
        <span className="text-xs text-slate-400 font-medium">{dateLabel}</span>
      </div>

      {/* Route + times */}
      <div className="flex items-center gap-4">
        {/* Departure */}
        <div className="flex-none text-center">
          <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-none">{depLabel}</p>
          <p className="text-sm font-bold text-slate-500 mt-1">{seg.from}</p>
        </div>

        {/* Duration connector */}
        <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <p className="text-xs font-semibold text-slate-400">{dur} · {stopsLabel}</p>
          <div className="w-full flex items-center gap-1">
            <div className="flex-1 h-px bg-slate-200" />
            <Plane size={14} className="text-[#1ABC9C] flex-none rotate-0" strokeWidth={2} />
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <p className="text-[10px] text-slate-400 font-medium">{seg.flightNumbers}</p>
        </div>

        {/* Arrival */}
        <div className="flex-none text-center">
          <p className="text-2xl font-extrabold text-slate-900 tabular-nums leading-none">{arrLabel}</p>
          <p className="text-sm font-bold text-slate-500 mt-1">{seg.to}</p>
        </div>
      </div>

      {/* Route label + airline */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          <span className="font-bold text-slate-700">{seg.from}</span>
          {' → '}
          <span className="font-bold text-slate-700">{seg.to}</span>
        </p>
        {seg.airline && (
          <p className="text-xs text-slate-400 font-medium">{seg.airline}</p>
        )}
      </div>

      {/* Action links */}
      <div className="flex items-center gap-4 pt-1">
        <button className="text-xs font-semibold text-[#1ABC9C] hover:text-emerald-600 transition-colors flex items-center gap-1">
          Flight details <ChevronRight size={12} />
        </button>
        <button
          onClick={handleChangeFlight}
          className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1"
        >
          Change flight <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

interface FareFeatureRowProps {
  label: string;
  value: string;
  positive: boolean;
}

function FareFeatureRow({ label, value, positive }: FareFeatureRowProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className={cn(
          'w-5 h-5 rounded-full flex items-center justify-center flex-none',
          positive ? 'bg-emerald-50' : 'bg-slate-100',
        )}>
          {positive
            ? <Check size={11} strokeWidth={3} className="text-emerald-500" />
            : <X size={11} strokeWidth={3} className="text-slate-400" />
          }
        </div>
        <span className="text-sm text-slate-600">{label}</span>
      </div>
      <span className={cn('text-sm font-medium', positive ? 'text-slate-700' : 'text-slate-400')}>
        {value}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CheckoutItineraryPage() {
  const router = useRouter();
  const fareStore = useFareStore();
  const checkoutStore = useCheckoutStore();
  const offerSession = useOfferSessionStore();

  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [ready, setReady] = useState(false);
  const [navigating, setNavigating] = useState(false);

  // Load DB-driven fees — populates computedFees in checkout store
  const { loading: feesLoading } = useFeeLoader();
  const pricingCfg = useBuildPricingConfig();

  const handleNextCheckout = async () => {
    const fare = checkoutStore.selectedFare;
    if (!fare) { router.replace('/'); return; }
    setNavigating(true);
    try {
      const data = await apiFetch<{ sessionId: string }>('/api/booking-session/select-fare', {
        method: 'POST',
        body: JSON.stringify({
          fareId: fare.fareId,
          offerId: fare.offerId,
          cabin: fare.cabin,
          name: fare.name,
          basePrice: fare.basePrice,
          totalPrice: fare.totalPrice,
          priceProtection: fare.priceProtection,
          currency: fare.currency,
        }),
      });
      checkoutStore.setSessionId(data.sessionId);
    } catch {
      // Session creation failed — continue with a local session ID.
      // The backend session is for price-protection tracking, not a booking blocker.
      const localSessionId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      checkoutStore.setSessionId(localSessionId);
      console.warn(`[Itinerary] select-fare failed, using local session: ${localSessionId}`);
    }
    router.push('/checkout/passengers');
  };

  // ── Init on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Helper: read sessionStorage safely
    function ssGet(key: string): unknown {
      try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
    }

    // 1. Already initialized in checkout store — reuse it ONLY if the user's current
    //    fare selection (useFareStore) matches. If they searched again and picked a
    //    DIFFERENT fare, the checkout store still holds the PREVIOUS booking (flights,
    //    route, seats) — blindly reusing it made the payment page show the old search's
    //    flights with the new fare's price. When the selection changed, fall through to
    //    a full re-init from the fresh selection.
    const freshSelection = useFareStore.getState().selectedFare;
    const selectionUnchanged =
      !freshSelection ||
      (!!checkoutStore.selectedFare &&
        freshSelection.fareId === checkoutStore.selectedFare.fareId &&
        freshSelection.offerId === checkoutStore.selectedFare.offerId);

    if (checkoutStore.selectedFare && selectionUnchanged) {
      // Re-read breakdown from sessionStorage to ensure correct pax types
      const ctx = ssGet('fm_fare_context') as { travelers?: number; adults?: number; children?: number; infants?: number } | null;
      const expectedCount = typeof ctx?.travelers === 'number' ? ctx.travelers : checkoutStore.travelerCount;
      const breakdown = (typeof ctx?.adults === 'number')
        ? { adults: ctx.adults, children: ctx.children ?? 0, infants: ctx.infants ?? 0 }
        : undefined;

      // Check both count AND type composition — if either is wrong, re-init
      const currentTypes = checkoutStore.passengers.map(p => p.type);
      const expectedTypes: string[] = [];
      if (breakdown) {
        for (let i = 0; i < Math.max(1, breakdown.adults); i++) expectedTypes.push('adult');
        for (let i = 0; i < breakdown.children; i++) expectedTypes.push('child');
        for (let i = 0; i < breakdown.infants; i++) expectedTypes.push('infant');
      }

      const typesMatch = expectedTypes.length > 0
        ? expectedTypes.length === currentTypes.length && expectedTypes.every((t, i) => t === currentTypes[i])
        : expectedCount === checkoutStore.passengers.length;

      if (!typesMatch) {
        // Passenger count or type mismatch — re-initialize with correct breakdown
        checkoutStore.initFromStores(
          checkoutStore.selectedFare, checkoutStore.fareOption,
          checkoutStore.sourceFlight, checkoutStore.sourceRoundTrip,
          expectedCount, breakdown,
        );
      }
      setPricing(buildLocalPricing(useCheckoutStore.getState(), pricingCfg));
      setReady(true);
      return;
    }

    // A different fare was selected than the one in the checkout store — clear the
    // previous booking's flights/seats/meals/ancillaries/source before re-initializing
    // so nothing stale from the earlier search leaks through to payment.
    if (checkoutStore.selectedFare) {
      checkoutStore.reset();
    }

    // 2. Resolve selected fare — Zustand or sessionStorage fallback
    const zustandFare  = useFareStore.getState().selectedFare;
    const ssFare       = ssGet('fm_selected_fare') as import('@/lib/fare-types').SelectedFare | null;
    const resolvedFare = zustandFare ?? ssFare;

    if (!resolvedFare) {
      console.warn('[Itinerary] No fare found — showing empty state');
      // Nothing to show — let user navigate back; don't auto-redirect
      setReady(true);
      return;
    }

    // 3. Resolve payload for full FareOption
    const zustandPayload  = useFareStore.getState().payload;
    const ssPayload       = ssGet('fm_fare_payload') as import('@/lib/fare-types').FareSelectionPayload | null;
    const resolvedPayload = zustandPayload ?? ssPayload;

    const fareOption: FareOption | null =
      resolvedPayload?.fareGroups
        .flatMap(g => g.fares)
        .find(f => f.id === resolvedFare.fareId) ?? null;

    // 4. Resolve source flight / round-trip
    // Only use sessionStorage fallback for sourceRoundTrip when sourceFlight is NOT available
    // to prevent stale round-trip data from a previous search leaking into one-way bookings.
    const sourceFlight    = useFareStore.getState().sourceFlight    ?? (ssGet('fm_source_flight')     as import('@/lib/types').UnifiedFlight | null);
    const sourceRoundTrip = useFareStore.getState().sourceRoundTrip ?? (sourceFlight ? null : (ssGet('fm_source_round_trip') as import('@/lib/round-trip-types').RoundTripOption | null));

    // 5. Traveler count and breakdown from context
    const ctx          = ssGet('fm_fare_context') as { travelers?: number; adults?: number; children?: number; infants?: number } | null;
    const travelerCount = typeof ctx?.travelers === 'number' ? ctx.travelers : 1;
    const passengerBreakdown = (typeof ctx?.adults === 'number')
      ? { adults: ctx.adults, children: ctx.children ?? 0, infants: ctx.infants ?? 0 }
      : undefined;

    // 6. Init checkout store
    try {
      checkoutStore.initFromStores(resolvedFare, fareOption, sourceFlight, sourceRoundTrip, travelerCount, passengerBreakdown);

      // Mystifly ERBUK082 recovery: capture every fare option for this itinerary
      // WITH its characteristics, so the confirm endpoint can pick a same-PRODUCT
      // alternate (matching cabin / refundable / changeable / baggage / price) if
      // the selected fare fails revalidation — never a different-product fare.
      const altFares = (resolvedPayload?.fareGroups ?? [])
        .flatMap(g => g.fares)
        .filter(f => typeof f.offerId === 'string' && f.offerId.length > 0)
        .map(f => ({
          fareSourceCode: f.offerId,
          cabin: f.cabin,
          refundable: f.policy?.refundable ?? false,
          changeable: f.policy?.changeable ?? false,
          totalPrice: f.totalPrice,
          checkedBags: f.baggage?.checked ?? 0,
        }));
      checkoutStore.setAlternateFares(altFares);
    } catch (e) {
      console.error('[Itinerary] initFromStores failed:', e);
      setReady(true);
      return;
    }

    // 7. Continue the offer expiry session — timer was started on the search page.
    //    Only update the tracked offer ID; do NOT restart the countdown.
    //    If no timer is active (page refresh), start a fresh session as fallback.
    const offerExpiresAt = sourceFlight?.offerExpiresAt ?? sourceRoundTrip?.offerExpiresAt;
    const providerOfferId = sourceFlight?.providerOfferId ?? sourceRoundTrip?.providerOfferId ?? resolvedFare.offerId;
    const providerName = sourceFlight?.provider ?? sourceRoundTrip?.provider ?? 'duffel';
    const sessionState = useOfferSessionStore.getState();
    if (sessionState.status === 'ACTIVE' || sessionState.status === 'WARNING') {
      // Timer already running — just update tracked offer
      sessionState.updateTrackedOffer(providerOfferId, providerName);
    } else {
      // No active timer (page refresh or direct navigation) — hydrate or start fresh
      const hydrated = sessionState.hydrateFromStorage();
      if (!hydrated) {
        sessionState.startSession({
          provider: providerName,
          providerOfferId,
          expiresAt: offerExpiresAt,
          searchCriteria: ctx ? {
            origin: (ctx as any).origin,
            destination: (ctx as any).destination,
            departureDate: (ctx as any).date,
            returnDate: (ctx as any).returnDate,
            adults: (ctx as any).adults,
            children: (ctx as any).children,
            infants: (ctx as any).infants,
            cabinClass: (ctx as any).cabin,
          } : undefined,
        });
      }
    }

    const snapshot = useCheckoutStore.getState();
    setPricing(buildLocalPricing(snapshot, pricingCfg));
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild pricing when DB fees arrive
  useEffect(() => {
    if (!feesLoading && checkoutStore.selectedFare) {
      setPricing(buildLocalPricing(useCheckoutStore.getState(), pricingCfg));
    }
  }, [feesLoading, checkoutStore.computedFees]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build display segments ─────────────────────────────────────────────────
  const displaySegs = useMemo<DisplaySeg[]>(() => {
    const { sourceRoundTrip, sourceFlight } = checkoutStore;

    if (sourceRoundTrip) {
      return [
        buildSegmentsFromJourney(sourceRoundTrip.outboundJourney, 'Outbound', 'outbound'),
        buildSegmentsFromJourney(sourceRoundTrip.returnJourney, 'Return', 'return'),
      ];
    }

    if (sourceFlight?.segments?.length) {
      return [buildSegmentsFromFlight(sourceFlight.segments, 'Outbound', 'outbound')];
    }

    return [];
  }, [checkoutStore.sourceRoundTrip, checkoutStore.sourceFlight]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived fare display data ──────────────────────────────────────────────
  const { selectedFare, fareOption } = checkoutStore;
  const currency = selectedFare?.currency ?? 'USD';
  const cabinLabel = selectedFare ? (CABIN_LABELS[selectedFare.cabin] ?? selectedFare.cabin) : '';

  const fareFeatures = useMemo(() => {
    if (!fareOption) return [];

    const { baggage, policy } = fareOption;

    const carryOnLabel = baggage.carryOn
      ? baggage.carryOnPieces > 1
        ? `${baggage.carryOnPieces} pieces`
        : '1 piece included'
      : 'Not included';

    const checkedLabel = baggage.checked > 0
      ? `${baggage.checked} bag${baggage.checked > 1 ? 's' : ''} included`
      : 'Not included';

    const cancelLabel = policy.refundable === null || policy.refundable === undefined
      ? 'Contact airline'
      : policy.refundable
        ? policy.refundFeeUsd
          ? `Refundable (fee: ${formatPrice(policy.refundFeeUsd, currency)})`
          : 'Refundable (Included)'
        : 'Non-refundable';

    const changeLabel = policy.changeable === null || policy.changeable === undefined
      ? 'Contact airline'
      : policy.changeable
        ? policy.changeFeeUsd
          ? `Changeable (fee: ${formatPrice(policy.changeFeeUsd, currency)})`
          : 'Changeable (Included)'
        : 'Not changeable';

    const seatLabel =
      policy.seatSelection === 'free'
        ? 'Free seat selection'
        : policy.seatSelection === 'fee'
          ? `Seat selection (fee)`
          : 'Not available';

    const milesLabel =
      policy.milesEarning === 'full'
        ? 'Full miles'
        : policy.milesEarning === 'reduced'
          ? 'Reduced miles'
          : 'No miles';

    return [
      { label: 'Carry-on bag', value: carryOnLabel, positive: baggage.carryOn },
      { label: 'Checked bags', value: checkedLabel, positive: baggage.checked > 0 },
      { label: 'Cancellation', value: cancelLabel, positive: policy.refundable },
      { label: 'Flight changes', value: changeLabel, positive: policy.changeable },
      { label: 'Seat selection', value: seatLabel, positive: policy.seatSelection !== 'not_available' },
      { label: 'Miles earning', value: milesLabel, positive: policy.milesEarning !== 'none' },
    ];
  }, [fareOption, currency]);

  // Fallback features when fareOption is null but selectedFare exists
  const simpleFareFeatures = useMemo(() => {
    if (fareOption || !selectedFare) return [];
    return [
      { label: 'Carry-on bag', value: '1 piece included', positive: true },
      { label: 'Checked bags', value: 'Not included', positive: false },
      { label: 'Cancellation', value: 'Non-refundable', positive: false },
      { label: 'Flight changes', value: 'Not changeable', positive: false },
    ];
  }, [fareOption, selectedFare]);

  const activeFareFeatures = fareFeatures.length > 0 ? fareFeatures : simpleFareFeatures;

  // ── Loading / not-ready state ──────────────────────────────────────────────
  if (!ready) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-[#1ABC9C]/30 border-t-[#1ABC9C] animate-spin mx-auto mb-4" />
          <p className="text-slate-500 text-sm font-medium">Loading your itinerary…</p>
        </div>
      </div>
    );
  }

  if (!selectedFare) {
    return null; // redirect is in flight
  }

  const grandTotal = pricing?.total ?? selectedFare.grandTotal;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />
      <OfferExpiryModals />

      {/* ── Offer Expiry Banner ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <OfferExpiryTimer
          onRefreshResults={() => router.push('/flights')}
        />
      </div>

      {/* ── Page content ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ════════════════════════════════════════════
              LEFT COLUMN (2/3)
          ════════════════════════════════════════════ */}
          <div className="lg:col-span-2 space-y-5">

            {/* ── A. Flight Details card ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-5">
                <Plane size={15} className="text-[#1ABC9C]" strokeWidth={2.5} />
                <h2 className="text-base font-bold text-slate-900">Your Itinerary</h2>
              </div>

              <div className="space-y-7">
                {displaySegs.length > 0 ? (
                  displaySegs.map((seg, i) => (
                    <div key={seg.key}>
                      {i > 0 && <div className="border-t border-slate-100 my-2" />}
                      <SegmentCard seg={seg} />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400 italic">Flight details unavailable.</p>
                )}
              </div>
            </div>

            {/* ── B. Selected Fare card ── */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-slate-900">Your Fare</h2>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                  {cabinLabel}
                </span>
              </div>

              {/* Fare name */}
              <div className="mb-4 pb-4 border-b border-slate-100">
                <p className="text-xl font-extrabold text-slate-900">{selectedFare.name}</p>
                {fareOption?.aiExplanation && (
                  <p className="text-xs text-slate-500 mt-1">{fareOption.aiExplanation}</p>
                )}
              </div>

              {/* Feature rows */}
              <div>
                {activeFareFeatures.map(f => (
                  <FareFeatureRow key={f.label} label={f.label} value={f.value} positive={f.positive} />
                ))}
              </div>
            </div>

            {/* ── C. Info banner ── */}
            <div className="flex items-start gap-3 bg-[#1ABC9C]/8 border border-[#1ABC9C]/20 rounded-2xl px-5 py-4">
              <Shield size={18} className="text-[#1ABC9C] flex-none mt-0.5" strokeWidth={2} />
              <p className="text-sm text-slate-700 leading-snug">
                <span className="font-semibold text-[#1ABC9C]">Good to know: </span>
                Seats and bags can be added in the next steps. Your fare is held while the countdown timer is active.
              </p>
            </div>
          </div>

          {/* ════════════════════════════════════════════
              RIGHT COLUMN (1/3) — sticky price summary
          ════════════════════════════════════════════ */}
          <div className="lg:col-span-1">
            <div className="sticky top-[calc(4rem+3rem+2px)] space-y-4">

              {/* Price Summary card */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-1">Price Details</h2>
                <div className="border-b border-slate-200 mb-4" />

                {pricing && pricing.perPassenger.length > 0 && (() => {
                  const paxCount = pricing.perPassenger.length;
                  const fareAndTaxes = pricing.fareTotal;

                  // Count passenger types
                  const typeCounts: Record<string, number> = {};
                  for (const p of checkoutStore.passengers) {
                    const label = p.type.charAt(0).toUpperCase() + p.type.slice(1);
                    typeCounts[label] = (typeCounts[label] || 0) + 1;
                  }

                  return (
                    <div className="space-y-5">
                      {/* Traveler Breakdown */}
                      <div>
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Traveler Breakdown</p>
                        <div className="space-y-1">
                          {Object.entries(typeCounts).map(([type, count]) => (
                            <div key={type} className="flex justify-between text-sm">
                              <span className="text-slate-600">{type} ({count})</span>
                              <span className="text-slate-400 font-medium">Included</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Base Fare */}
                      <div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-600">Base fare</span>
                          <span className="font-medium text-slate-900">{formatPrice(pricing.totalBaseFare, currency)}</span>
                        </div>
                      </div>

                      {/* Taxes & Fees — expandable */}
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById('checkout-tax-breakdown');
                            if (el) el.classList.toggle('hidden');
                          }}
                          className="flex justify-between text-sm w-full group"
                        >
                          <span className="text-slate-600 group-hover:text-slate-800 transition-colors flex items-center gap-1">
                            Taxes, fees &amp; charges
                            {pricing.taxBreakdown && pricing.taxBreakdown.length > 0 && (
                              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            )}
                          </span>
                          <span className="font-medium text-slate-900">{formatPrice(pricing.totalTaxes, currency)}</span>
                        </button>
                        {pricing.taxBreakdown && pricing.taxBreakdown.length > 0 && (
                          <div id="checkout-tax-breakdown" className="hidden mt-1.5 ml-3 space-y-0.5 border-l-2 border-slate-200 pl-3">
                            {pricing.taxBreakdown.map((t, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-slate-400">{t.label || t.code}</span>
                                <span className="text-slate-400">{formatPrice(t.amount, currency)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Service Fee */}
                      {pricing.serviceFee > 0 && (
                        <div className="flex justify-between items-center text-sm">
                          <span className="text-slate-500">Service Fee</span>
                          <span className="text-slate-500">{formatPrice(pricing.serviceFee, currency)}</span>
                        </div>
                      )}

                      {/* Optional Services */}
                      {(pricing.protectionFee > 0 || pricing.insuranceFee > 0) && (
                        <div>
                          <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Optional Services</p>
                          <div className="space-y-1.5">
                            {pricing.protectionFee > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500 flex items-center gap-1.5">
                                  <Shield size={11} className="text-[#1ABC9C]" strokeWidth={2} />
                                  Price Drop Protection
                                </span>
                                <span className="text-slate-500">{formatPrice(pricing.protectionFee, currency)}</span>
                              </div>
                            )}
                            {pricing.insuranceFee > 0 && (
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">Travel Insurance</span>
                                <span className="text-slate-500">{formatPrice(pricing.insuranceFee, currency)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Divider */}
                <div className="border-t border-slate-200 my-4" />

                {/* Total Payable */}
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Total Payable</p>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-extrabold text-[#F97316]">
                    {formatPrice(grandTotal, currency)}
                  </span>
                </div>

                {checkoutStore.travelerCount > 1 && (
                  <p className="text-xs text-slate-400 mt-1">
                    for {checkoutStore.travelerCount} traveler{checkoutStore.travelerCount > 1 ? 's' : ''}
                  </p>
                )}

                {/* CTA */}
                <button
                  onClick={handleNextCheckout}
                  disabled={navigating}
                  className="mt-5 w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm transition-all shadow-lg shadow-[#1ABC9C]/25"
                >
                  {navigating ? 'Preparing checkout…' : 'Next: Checkout'}
                  {!navigating && <ChevronRight size={16} strokeWidth={2.5} />}
                </button>

                {/* Trust badge */}
                <div className="flex items-center justify-center gap-1.5 mt-3 text-slate-400 text-xs">
                  <Lock size={11} strokeWidth={2.5} />
                  <span>Secure &amp; encrypted checkout</span>
                </div>
              </div>

              {/* Price Drop Protection confirmation notice */}
              {isBundleEnabled() && selectedFare.priceProtection && selectedFare.protectionFee > 0 && (
                <div className="bg-[#1ABC9C]/8 border border-[#1ABC9C]/20 rounded-2xl px-4 py-3 flex items-start gap-2.5">
                  <Shield size={15} className="text-[#1ABC9C] flex-none mt-0.5" strokeWidth={2} />
                  <div>
                    <p className="text-xs font-bold text-[#1ABC9C]">Price Drop Protection active</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Refund 80% of any eligible fare decrease after booking.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
