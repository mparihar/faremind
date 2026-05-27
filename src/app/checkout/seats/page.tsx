'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Lock, ChevronRight, Check, Info, AlertCircle,
  Plane, Shield, Users, LayoutGrid, ArrowLeftRight, AlignJustify, Shuffle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatPrice, formatTime, formatDate } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import SeatGrid from '@/components/checkout/SeatGrid';
import type { SegmentSeatMap } from '@/lib/seat-map-types';
import type { PassengerInfo } from '@/store/useCheckoutStore';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = ['Itinerary', 'Passengers', 'Seats', 'Meals', 'Add-ons', 'Review', 'Payment'] as const;
const STEP_INDEX = 2;

const PAX_HEX   = ['#3B82F6', '#8B5CF6', '#EC4899', '#F97316'];

// ── Preference fallback (when seat map unavailable) ───────────────────────────

type SeatPreference = 'window' | 'aisle' | 'middle' | 'no_preference';

const PREF_OPTIONS: Array<{
  value: SeatPreference;
  label: string;
  Icon: typeof LayoutGrid;
  desc: string;
}> = [
  { value: 'window',        label: 'Window',        Icon: LayoutGrid,     desc: 'View & lean room' },
  { value: 'aisle',         label: 'Aisle',         Icon: ArrowLeftRight, desc: 'Easy access' },
  { value: 'middle',        label: 'Middle',        Icon: AlignJustify,   desc: 'Sit with companions' },
  { value: 'no_preference', label: 'No Preference', Icon: Shuffle,        desc: 'Any available seat' },
];

// ── DisplaySegment ────────────────────────────────────────────────────────────

interface DisplaySegment {
  key: string;
  journeyLabel: string;   // 'Outbound' | 'Return' | 'Segment N'
  flightNumber: string;   // e.g. 'LH0761'
  from: string;
  to: string;
  depTime: string;
  arrTime: string;
  durationMin: number;
  airline: string;
}

function segFromFlight(
  seg: import('@/lib/types').FlightSegment,
  key: string,
  journeyLabel: string,
): DisplaySegment {
  return {
    key,
    journeyLabel,
    flightNumber: seg.flightNumber,
    from: seg.departure.airport,
    to: seg.arrival.airport,
    depTime: seg.departure.time,
    arrTime: seg.arrival.time,
    durationMin: seg.duration,
    airline: seg.airline.name,
  };
}

function segFromJourney(
  journey: import('@/lib/round-trip-types').JourneySegment,
  journeyLabel: string,
  keyPrefix: string,
): DisplaySegment[] {
  const segs = journey.segments ?? [];
  if (segs.length > 0) {
    return segs.map((seg, i) => segFromFlight(seg, `${keyPrefix}_${i}`, journeyLabel));
  }
  // Fallback: no per-flight segments available — use journey-level data
  return [{
    key: keyPrefix,
    journeyLabel,
    flightNumber: journey.flightNumbers[0] ?? '',
    from: journey.departureAirport,
    to: journey.arrivalAirport,
    depTime: journey.departureTime,
    arrTime: journey.arrivalTime,
    durationMin: journey.durationMinutes,
    airline: journey.airlineNames[0] ?? '',
  }];
}

function buildSegments(
  sourceFlight: UnifiedFlight | null,
  sourceRoundTrip: RoundTripOption | null,
): DisplaySegment[] {
  if (sourceRoundTrip) {
    return [
      ...segFromJourney(sourceRoundTrip.outboundJourney, 'Outbound', 'out'),
      ...segFromJourney(sourceRoundTrip.returnJourney,   'Return',   'ret'),
    ];
  }
  return (sourceFlight?.segments ?? []).map((seg, i) =>
    segFromFlight(seg, `seg_${i}`, i === 0 ? 'Outbound' : `Segment ${i + 1}`),
  );
}

function paxLabel(p: PassengerInfo, i: number): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  if (name) return name;
  const t = p.type === 'adult' ? 'Adult' : p.type === 'child' ? 'Child' : 'Infant';
  return `Traveler ${i + 1} (${t})`;
}

function formatDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Step chips ────────────────────────────────────────────────────────────────

function StepChips({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide w-full">
      {STEPS.map((step, i) => {
        const isDone = i < currentStep;
        const isActive = i === currentStep;
        return (
          <div key={step} className="flex items-center gap-1.5 flex-none">
            <div className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all',
              isActive && 'bg-[#1ABC9C] text-white',
              isDone && 'bg-emerald-100 text-emerald-700',
              !isActive && !isDone && 'bg-slate-100 text-slate-400',
            )}>
              {isDone
                ? <Check className="w-3 h-3" strokeWidth={3} />
                : <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold bg-white/20">{i + 1}</span>}
              <span className="hidden sm:inline">{step}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn('w-4 h-px flex-none', i < currentStep ? 'bg-emerald-300' : 'bg-slate-200')} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Checkout header ───────────────────────────────────────────────────────────

function CheckoutHeader() {
  const router = useRouter();
  const progressPct = Math.round(((STEP_INDEX + 1) / STEPS.length) * 100);
  return (
    <div className="sticky top-16 z-10 bg-[#1a1a2e]/95 backdrop-blur-xl border-b border-white/[0.06] shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[90px] flex items-center justify-between gap-4">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-medium flex-none"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Book Your Flight</span>
        </button>
        <div className="flex-1 overflow-hidden"><StepChips currentStep={STEP_INDEX} /></div>
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold flex-none">
          <Lock className="w-3 h-3" />
          <span className="hidden sm:inline">Secure Checkout</span>
          <span className="text-slate-600 mx-1">·</span>
          <span className="text-slate-300">Step {STEP_INDEX + 1} of 7</span>
        </div>
      </div>
      <div className="h-0.5 bg-slate-800">
        <div className="h-full bg-[#1ABC9C] transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>
    </div>
  );
}

// ── Segment tab bar ───────────────────────────────────────────────────────────

function SegmentTabs({
  segments,
  activeIndex,
  seatMaps,
  onSelect,
}: {
  segments: DisplaySegment[];
  activeIndex: number;
  seatMaps: SegmentSeatMap[];
  onSelect: (i: number) => void;
}) {
  if (segments.length <= 1) return null;

  // Group by journeyLabel preserving order
  const journeys: string[] = [];
  segments.forEach(s => { if (!journeys.includes(s.journeyLabel)) journeys.push(s.journeyLabel); });

  return (
    <div className="flex flex-wrap gap-6 mb-5">
      {journeys.map(journey => (
        <div key={journey}>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
            {journey}
          </p>
          <div className="flex flex-wrap gap-2">
            {segments.map((seg, i) => {
              if (seg.journeyLabel !== journey) return null;
              const hasSeatMap = !!seatMaps[i]?.cabins?.[0]?.rows?.length;
              const isActive = i === activeIndex;
              return (
                <button
                  key={seg.key}
                  onClick={() => onSelect(i)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border',
                    isActive
                      ? 'bg-[#1ABC9C] border-[#1ABC9C] text-white shadow-md shadow-[#1ABC9C]/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300',
                  )}
                >
                  <Plane className="w-3.5 h-3.5" />
                  <span className="font-bold">{seg.flightNumber || `${seg.from}→${seg.to}`}</span>
                  <span className="text-xs opacity-70">{seg.from}→{seg.to}</span>
                  {hasSeatMap && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Preference fallback ───────────────────────────────────────────────────────

function PreferencePicker({
  segment,
  passengers,
  seatSelections,
  onSelect,
}: {
  segment: DisplaySegment;
  passengers: PassengerInfo[];
  seatSelections: import('@/store/useCheckoutStore').SeatSelection[];
  onSelect: (paxId: string, segKey: string, pref: SeatPreference) => void;
}) {
  return (
    <div className="space-y-5">
      {passengers.map((pax, i) => {
        const existing = seatSelections.find(
          s => s.passengerId === pax.id && s.segmentKey === segment.key,
        );
        return (
          <div key={pax.id}>
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: PAX_HEX[i % PAX_HEX.length] }}
              >
                {i + 1}
              </div>
              <p className="text-sm font-semibold text-slate-700">{paxLabel(pax, i)}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PREF_OPTIONS.map(opt => {
                const active = existing?.preference === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onSelect(pax.id, segment.key, opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border text-center transition-all',
                      active
                        ? 'bg-[#1ABC9C]/10 border-[#1ABC9C] text-[#1ABC9C]'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300',
                    )}
                  >
                    <opt.Icon className="w-5 h-5" />
                    <span className={cn('text-xs font-semibold', active ? 'text-[#1ABC9C]' : 'text-slate-700')}>
                      {opt.label}
                    </span>
                    <span className="text-xs text-slate-400 leading-tight">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Right panel: live itinerary ───────────────────────────────────────────────

function ItineraryPanel({
  currency,
  onContinue,
}: {
  currency: string;
  onContinue: () => void;
}) {
  const store = useCheckoutStore();
  const pricing = useMemo(() => buildLocalPricing(store), [
    store.seatSelections, store.extraBags, store.priceProtection, store.travelInsurance, // eslint-disable-line react-hooks/exhaustive-deps
    store.passengers, store.selectedFare, // eslint-disable-line react-hooks/exhaustive-deps
  ]);

  const seatTotal = pricing.seatFees;
  const grandTotal = pricing.total;

  return (
    <div className="sticky top-[calc(4rem+5.75rem+12rem)] space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#1ABC9C]" strokeWidth={2} />
          Price Summary
        </h3>

        {/* Base fares */}
        <div className="space-y-2 text-sm">
          {pricing.perPassenger.map((pp, i) => (
            <div key={pp.passengerId} className="flex justify-between">
              <span className="text-slate-500">
                Pax {i + 1} flight
              </span>
              <span className="font-medium text-slate-800">
                {formatPrice(pp.subtotal, currency)}
              </span>
            </div>
          ))}

          {pricing.serviceFee > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Service fee</span>
              <span className="text-slate-500">{formatPrice(pricing.serviceFee, currency)}</span>
            </div>
          )}
        </div>

        {/* Seat lines */}
        <AnimatePresence>
          {store.seatSelections.filter(s => s.seatNumber).length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                  Seat Add-ons
                </p>
                {store.passengers.map((pax, i) => {
                  const assigned = store.seatSelections.filter(
                    s => s.passengerId === pax.id && s.seatNumber,
                  );
                  if (!assigned.length) return null;
                  return assigned.map(s => (
                    <motion.div
                      key={`${pax.id}-${s.segmentKey}`}
                      initial={{ x: -8, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-slate-600 flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: PAX_HEX[i % PAX_HEX.length] }}
                        />
                        {paxLabel(pax, i).split(' ')[0]} → {s.seatNumber}
                      </span>
                      <span className="font-semibold text-slate-800">
                        {s.priceUsd === 0 ? 'Free' : formatPrice(s.priceUsd, currency)}
                      </span>
                    </motion.div>
                  ));
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Add-ons */}
        {(pricing.protectionFee > 0 || pricing.insuranceFee > 0 || pricing.baggageFees > 0) && (
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-sm">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
              Add-ons
            </p>
            {pricing.protectionFee > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Price protection</span>
                <span className="text-slate-600">{formatPrice(pricing.protectionFee, currency)}</span>
              </div>
            )}
            {pricing.insuranceFee > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Insurance</span>
                <span className="text-slate-600">{formatPrice(pricing.insuranceFee, currency)}</span>
              </div>
            )}
            {pricing.baggageFees > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-500">Extra bags</span>
                <span className="text-slate-600">{formatPrice(pricing.baggageFees, currency)}</span>
              </div>
            )}
          </div>
        )}

        {/* Seat subtotal badge */}
        <AnimatePresence>
          {seatTotal > 0 && (
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="mt-3 px-3 py-2 rounded-lg bg-[#1ABC9C]/10 border border-[#1ABC9C]/20"
            >
              <p className="text-xs text-[#1ABC9C] font-semibold">
                Seat fees: {formatPrice(seatTotal, currency)}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Total */}
        <div className="flex items-baseline justify-between mt-4 pt-4 border-t border-slate-200">
          <span className="text-sm font-bold text-slate-700">Trip total</span>
          <motion.span
            key={grandTotal}
            initial={{ scale: 1.05, color: '#1ABC9C' }}
            animate={{ scale: 1, color: '#F97316' }}
            transition={{ duration: 0.3 }}
            className="text-2xl font-extrabold"
            style={{ color: '#F97316' }}
          >
            {formatPrice(grandTotal, currency)}
          </motion.span>
        </div>

        <button
          onClick={onContinue}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/20 transition-all"
        >
          Continue to Meals
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="flex items-center justify-center gap-1.5 mt-3 text-slate-400 text-xs">
          <Lock className="w-3 h-3" />
          Seat selection can be updated until check-in
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SeatsPage() {
  const router = useRouter();
  const store = useCheckoutStore();
  const {
    selectedFare, sessionId, sourceFlight, sourceRoundTrip,
    passengers, seatSelections, updateSeatSelection,
  } = store;

  // ── Seat map state ──────────────────────────────────────────────────────────
  const [seatMaps, setSeatMaps]             = useState<SegmentSeatMap[]>([]);
  const [loadingMap, setLoadingMap]         = useState(true);
  const [mapError, setMapError]             = useState<string | null>(null);
  const [activeSegIdx, setActiveSegIdx]     = useState(0);
  const [activePaxIdx, setActivePaxIdx]     = useState(0);
  const [activeCabinIdx, setActiveCabinIdx] = useState(0);

  // ── Guard ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedFare || !sessionId) router.replace('/');
  }, [selectedFare, sessionId, router]);

  // Reset cabin + passenger selection whenever the active segment changes
  useEffect(() => {
    setActiveCabinIdx(0);
    setActivePaxIdx(0);
  }, [activeSegIdx]);

  // ── Fetch seat maps ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedFare?.offerId) { setLoadingMap(false); return; }

    setLoadingMap(true);
    fetch(`/api/seats/seat-map?offer_id=${encodeURIComponent(selectedFare.offerId)}`)
      .then(r => r.json())
      .then((data: { seatMaps: SegmentSeatMap[]; error?: string }) => {
        setSeatMaps(data.seatMaps ?? []);
        if (data.error) setMapError(data.error);
      })
      .catch(() => setMapError('Could not load seat map.'))
      .finally(() => setLoadingMap(false));
  }, [selectedFare?.offerId]);

  if (!selectedFare || !sessionId) return null;

  const segments = buildSegments(sourceFlight, sourceRoundTrip);
  const currency = selectedFare.currency ?? 'USD';
  const activeSeg = segments[activeSegIdx];

  // Does this segment have a real seat map?
  const activeSeatMap = seatMaps[activeSegIdx];
  const hasSeatMap = !loadingMap && !!activeSeatMap?.cabins?.[0]?.rows?.length;

  // ── Seat selection handler ──────────────────────────────────────────────────
  const handleSeatClick = useCallback((
    designator: string,
    serviceId: string | null,
    price: number,
    curr: string,
  ) => {
    if (!activeSeg) return;
    const pax = passengers[activePaxIdx];
    if (!pax) return;

    // Toggle: clicking an already-assigned seat deselects it
    const existing = seatSelections.find(
      s => s.passengerId === pax.id && s.segmentKey === activeSeg.key,
    );
    if (existing?.seatNumber === designator) {
      updateSeatSelection(pax.id, activeSeg.key, { seatNumber: null, priceUsd: 0, serviceId: null });
      return;
    }

    updateSeatSelection(pax.id, activeSeg.key, {
      seatNumber: designator,
      priceUsd: price,
      serviceId,
      preference: 'no_preference',
    });

    // Auto-advance to next passenger that hasn't been assigned this segment
    const nextUnassigned = passengers.findIndex((p, i) => {
      if (i <= activePaxIdx) return false;
      return !seatSelections.find(s => s.passengerId === p.id && s.segmentKey === activeSeg.key && s.seatNumber);
    });
    if (nextUnassigned !== -1) {
      setActivePaxIdx(nextUnassigned);
    }
  }, [activeSeg, passengers, activePaxIdx, seatSelections, updateSeatSelection]);

  // ── Preference handler (fallback) ───────────────────────────────────────────
  const handlePrefSelect = useCallback((paxId: string, segKey: string, pref: SeatPreference) => {
    updateSeatSelection(paxId, segKey, { preference: pref, seatNumber: null, priceUsd: 0, serviceId: null });
  }, [updateSeatSelection]);

  // ── Assignments for active segment ─────────────────────────────────────────
  const activeAssignments = useMemo(() => {
    if (!activeSeg) return [];
    return passengers
      .map((pax, i) => {
        const sel = seatSelections.find(s => s.passengerId === pax.id && s.segmentKey === activeSeg.key);
        if (!sel?.seatNumber) return null;
        return {
          designator: sel.seatNumber,
          passengerIndex: i,
          price: sel.priceUsd,
          currency,
          serviceId: sel.serviceId,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
  }, [passengers, seatSelections, activeSeg, currency]);

  const passengerLabels = passengers.map((p, i) => paxLabel(p, i));

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ══ LEFT PANEL (2/3) ══ */}
          <div className="lg:col-span-2 space-y-4">

            {/* Page heading */}
            <div>
              <h1 className="text-2xl font-bold text-[#0F172A]">Select Your Seats</h1>
              <p className="text-sm text-slate-500 mt-1">
                Choose seats for each traveler. Prices are shown per seat.
              </p>
            </div>

            {/* Segment tabs */}
            {activeSeg && (
              <SegmentTabs
                segments={segments}
                activeIndex={activeSegIdx}
                seatMaps={seatMaps}
                onSelect={setActiveSegIdx}
              />
            )}

            {/* Flight info strip */}
            {activeSeg && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Plane className="w-4 h-4 text-[#1ABC9C] shrink-0" strokeWidth={2} />
                  <span className="text-sm font-bold text-slate-900">
                    {activeSeg.from} → {activeSeg.to}
                  </span>
                  {activeSeg.airline && (
                    <span className="text-xs text-slate-400 font-medium truncate">{activeSeg.airline}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0 flex-wrap gap-y-1">
                  <span>{formatDate(activeSeg.depTime)}</span>
                  <span>·</span>
                  <span>{formatTime(activeSeg.depTime)} – {formatTime(activeSeg.arrTime)}</span>
                  <span>·</span>
                  <span>{formatDur(activeSeg.durationMin)}</span>
                  {activeSeg.flightNumber && (
                    <>
                      <span>·</span>
                      <span className="font-mono">{activeSeg.flightNumber}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Seat map / preference selector */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">

              {/* Flight number label */}
              {activeSeg && !loadingMap && (
                <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Plane className="w-4 h-4 text-[#1ABC9C] shrink-0" strokeWidth={2} />
                    <span className="text-base font-extrabold text-black tracking-wide">
                      {activeSeg.flightNumber || `${activeSeg.from}→${activeSeg.to}`}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {activeSeg.from} → {activeSeg.to}
                  </span>
                  <span className="ml-auto text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                    {activeSeg.journeyLabel}
                  </span>
                </div>
              )}

              {/* Loading */}
              {loadingMap && (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-10 h-10 rounded-full border-4 border-[#1ABC9C]/30 border-t-[#1ABC9C] animate-spin" />
                  <p className="text-sm text-slate-400 font-medium">Loading seat map…</p>
                </div>
              )}

              {/* Seat map unavailable — show preference selector */}
              {!loadingMap && !hasSeatMap && activeSeg && (
                <div className="space-y-5">
                  {mapError && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Interactive seat map is not available for this flight. Select your preference below.</span>
                    </div>
                  )}
                  {!mapError && (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 text-xs">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Seat map not available. Choose your seating preference and the airline will assign a matching seat.</span>
                    </div>
                  )}
                  <PreferencePicker
                    segment={activeSeg}
                    passengers={passengers}
                    seatSelections={seatSelections}
                    onSelect={handlePrefSelect}
                  />
                </div>
              )}

              {/* 2D Seat grid */}
              {!loadingMap && hasSeatMap && activeSeg && activeSeatMap && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeSegIdx}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Cabin class tabs — only shown when a flight genuinely has
                        multiple cabin classes (e.g. Business + Economy).
                        Same-class splits (Economy front/rear) are merged
                        server-side in the seat-map API route. */}
                    {activeSeatMap.cabins.length > 1 && (
                      <div className="flex gap-2 mb-5">
                        {activeSeatMap.cabins.map((c, ci) => (
                          <button
                            key={ci}
                            onClick={() => setActiveCabinIdx(ci)}
                            className={cn(
                              'px-3 py-1.5 rounded-full text-xs font-bold capitalize transition-all border',
                              ci === activeCabinIdx
                                ? 'bg-[#1ABC9C] border-[#1ABC9C] text-white'
                                : 'bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-300',
                            )}
                          >
                            {c.cabinClass.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Render only the active cabin */}
                    {(activeSeatMap.cabins[activeCabinIdx] ?? activeSeatMap.cabins[0]) && (
                      <SeatGrid
                        cabin={activeSeatMap.cabins[activeCabinIdx] ?? activeSeatMap.cabins[0]}
                        assignments={activeAssignments}
                        activePassengerIndex={activePaxIdx}
                        passengerLabels={passengerLabels}
                        onSeatClick={handleSeatClick}
                      />
                    )}

                    {/* Passenger switcher below grid */}
                    {passengers.length > 1 && (
                      <div className="mt-5 pt-4 border-t border-slate-100">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <Users className="w-3 h-3" /> Switch passenger
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {passengers.map((pax, i) => {
                            const hasSeat = seatSelections.some(
                              s => s.passengerId === pax.id && s.segmentKey === activeSeg.key && s.seatNumber,
                            );
                            return (
                              <button
                                key={pax.id}
                                onClick={() => setActivePaxIdx(i)}
                                className={cn(
                                  'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all border',
                                  i === activePaxIdx
                                    ? 'border-current text-white'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300',
                                )}
                                style={i === activePaxIdx ? { backgroundColor: PAX_HEX[i % PAX_HEX.length], borderColor: PAX_HEX[i % PAX_HEX.length] } : {}}
                              >
                                <span>{paxLabel(pax, i)}</span>
                                {hasSeat && <Check className="w-3 h-3" strokeWidth={3} />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {/* Info banner */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-[#1ABC9C]/8 border border-[#1ABC9C]/20 text-slate-700 text-xs">
              <Shield className="w-4 h-4 text-[#1ABC9C] shrink-0 mt-0.5" strokeWidth={2} />
              <span>
                <span className="font-semibold text-[#1ABC9C]">Seat selection confirmed at booking. </span>
                Paid seats will be charged. Free seats are subject to availability at check-in.
              </span>
            </div>

            {/* Mobile CTA */}
            <button
              onClick={() => router.push('/checkout/meals')}
              className="lg:hidden w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2"
            >
              Continue to Meals <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* ══ RIGHT PANEL (1/3) — sticky itinerary ══ */}
          <div className="lg:col-span-1 hidden lg:block">
            <ItineraryPanel currency={currency} onContinue={() => router.push('/checkout/meals')} />
          </div>
        </div>
      </div>
    </div>
  );
}
