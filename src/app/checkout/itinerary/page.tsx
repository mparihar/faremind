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
import { useFareStore } from '@/store/useFareStore';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import type { PricingBreakdown } from '@/store/useCheckoutStore';
import type { FareOption } from '@/lib/fare-types';
import type { JourneySegment } from '@/lib/round-trip-types';
import type { FlightSegment } from '@/lib/types';
import { formatTime, formatDuration, formatDate, cn, formatPrice } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';

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

  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [ready, setReady] = useState(false);
  const [navigating, setNavigating] = useState(false);

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
      router.push('/checkout/passengers');
    } catch {
      // Session creation failed — send back to home
      router.replace('/');
    }
  };

  // ── Init on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Helper: read sessionStorage safely
    function ssGet(key: string): unknown {
      try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
    }

    // 1. Already initialized in checkout store
    if (checkoutStore.selectedFare) {
      setPricing(buildLocalPricing(checkoutStore));
      setReady(true);
      return;
    }

    // 2. Resolve selected fare — Zustand or sessionStorage fallback
    const zustandFare  = useFareStore.getState().selectedFare;
    const ssFare       = ssGet('fm_selected_fare') as import('@/lib/fare-types').SelectedFare | null;
    const resolvedFare = zustandFare ?? ssFare;

    if (!resolvedFare) {
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
    const sourceFlight    = useFareStore.getState().sourceFlight    ?? (ssGet('fm_source_flight')     as import('@/lib/types').UnifiedFlight | null);
    const sourceRoundTrip = useFareStore.getState().sourceRoundTrip ?? (ssGet('fm_source_round_trip') as import('@/lib/round-trip-types').RoundTripOption | null);

    // 5. Traveler count and breakdown from context
    const ctx          = ssGet('fm_fare_context') as { travelers?: number; adults?: number; children?: number; infants?: number } | null;
    const travelerCount = typeof ctx?.travelers === 'number' ? ctx.travelers : 1;
    const passengerBreakdown = (typeof ctx?.adults === 'number')
      ? { adults: ctx.adults, children: ctx.children ?? 0, infants: ctx.infants ?? 0 }
      : undefined;

    // 6. Init checkout store
    checkoutStore.initFromStores(resolvedFare, fareOption, sourceFlight, sourceRoundTrip, travelerCount, passengerBreakdown);

    const snapshot = useCheckoutStore.getState();
    setPricing(buildLocalPricing(snapshot));
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

    const cancelLabel = policy.refundable
      ? policy.refundFeeUsd
        ? `Refundable (fee: ${formatPrice(policy.refundFeeUsd, currency)})`
        : 'Fully refundable'
      : 'Non-refundable';

    const changeLabel = policy.changeable
      ? policy.changeFeeUsd
        ? `Changeable (fee: ${formatPrice(policy.changeFeeUsd, currency)})`
        : 'Free changes'
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

      {/* ── Page content ── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                Seats and bags can be added in the next steps. Your selection is held for{' '}
                <span className="font-semibold">10 minutes</span>.
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
                <h2 className="text-base font-bold text-slate-900 mb-4">Price Details</h2>

                <div className="space-y-4">
                  {pricing?.perPassenger.map((pax, i) => (
                    <div key={pax.passengerId} className="space-y-1.5">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                        Passenger {i + 1}
                        <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 normal-case text-[10px]">
                          {pax.type === 'adult' ? 'Adult' : 'Child'}
                        </span>
                      </p>
                      {/* Show the all-in fare as a single line — taxes are already included in the
                          Duffel total_amount and we do not have a real per-component split. */}
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-slate-600">Fare (incl. taxes &amp; carrier fees)</span>
                        <span className="text-sm font-semibold text-slate-800">
                          {formatPrice(pax.subtotal, currency)}
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Service fee line */}
                  {pricing && pricing.serviceFee > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">Service fee</span>
                      <span className="text-sm text-slate-500">
                        {formatPrice(pricing.serviceFee, currency)}
                      </span>
                    </div>
                  )}

                  {/* Price Drop Protection line */}
                  {pricing && pricing.protectionFee > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500 flex items-center gap-1.5">
                        <Shield size={11} className="text-[#1ABC9C]" strokeWidth={2} />
                        Price Drop Protection
                      </span>
                      <span className="text-sm text-slate-500">
                        {formatPrice(pricing.protectionFee, currency)}
                      </span>
                    </div>
                  )}

                  {/* Travel insurance line */}
                  {pricing && pricing.insuranceFee > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">Travel insurance</span>
                      <span className="text-sm text-slate-500">
                        {formatPrice(pricing.insuranceFee, currency)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div className="border-t border-slate-200 my-4" />

                {/* Trip total */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-700">Trip total</span>
                  <span className="text-2xl font-extrabold text-[#F97316]">
                    {formatPrice(grandTotal, currency)}
                  </span>
                </div>

                {checkoutStore.travelerCount > 1 && (
                  <p className="text-xs text-slate-400 mt-1 text-right">
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
              {selectedFare.priceProtection && selectedFare.protectionFee > 0 && (
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
