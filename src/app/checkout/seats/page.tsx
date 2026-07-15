'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, Check, Info, AlertCircle, Lock,
  Plane, Shield, Users, LayoutGrid, ArrowLeftRight, AlignJustify, Shuffle,
  Accessibility, ChevronDown as ChevronDownIcon,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { useOfferGuard } from '@/hooks/useOfferGuard';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatPrice, formatTime, formatDate } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import SeatGrid from '@/components/checkout/SeatGrid';
import type { SegmentSeatMap } from '@/lib/seat-map-types';
import type { PassengerInfo, WheelchairCode } from '@/store/useCheckoutStore';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import { useFeeLoader } from '@/hooks/useFeeLoader';
import { useBuildPricingConfig } from '@/hooks/usePricingConfig';

// ── Constants ─────────────────────────────────────────────────────────────────

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



// ── Segment tab bar ───────────────────────────────────────────────────────────

function SegmentTabs({
  segments,
  activeIndex,
  seatMaps,
  completedSegments,
  onSelect,
}: {
  segments: DisplaySegment[];
  activeIndex: number;
  seatMaps: SegmentSeatMap[];
  completedSegments: Set<number>;
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
              const isDone = completedSegments.has(i);
              return (
                <button
                  key={seg.key}
                  onClick={() => onSelect(i)}
                  className={cn(
                    'relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border cursor-pointer',
                    isActive
                      ? 'bg-[#1ABC9C] border-[#1ABC9C] text-white shadow-md shadow-[#1ABC9C]/20'
                      : isDone
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100/80'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  {isDone && !isActive ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={3} />
                  ) : (
                    <Plane className="w-3.5 h-3.5" />
                  )}
                  <span className="font-bold">{seg.flightNumber || `${seg.from}→${seg.to}`}</span>
                  <span className="text-xs opacity-70">{seg.from}→{seg.to}</span>
                  {hasSeatMap && (
                    <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                  )}
                  {isDone && !isActive && (
                    <span className="text-[10px] font-bold text-emerald-500 bg-emerald-100 px-1.5 py-0.5 rounded-full leading-none">
                      Done
                    </span>
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

// ── Wheelchair assistance options (IATA SSR codes) ────────────────────────────

const WHEELCHAIR_OPTIONS: Array<{
  code: WheelchairCode;
  label: string;
  desc: string;
  detail: string;
}> = [
  { code: 'NONE',  label: 'No Assistance',    desc: 'No wheelchair needed',                           detail: 'Standard boarding' },
  { code: 'WCHR',  label: 'Ramp Wheelchair',   desc: 'Can walk short distances & stairs',              detail: 'Wheelchair to/from aircraft door' },
  { code: 'WCHS',  label: 'Stair Wheelchair',  desc: 'Can walk short distances, cannot manage stairs', detail: 'Wheelchair to/from seat row, carried on stairs' },
  { code: 'WCHC',  label: 'Full Wheelchair',   desc: 'Immobile, requires aisle chair',                 detail: 'Full assistance, carried to seat' },
  { code: 'WCOB',  label: 'On-board Chair',    desc: 'Needs wheelchair on aircraft',                   detail: 'On-board wheelchair provided during flight' },
];

function WheelchairAssistancePanel({
  segment,
  passengers,
  wheelchairSelections,
  onSelect,
}: {
  segment: DisplaySegment;
  passengers: PassengerInfo[];
  wheelchairSelections: import('@/store/useCheckoutStore').WheelchairSelection[];
  onSelect: (paxId: string, segKey: string, code: WheelchairCode, label: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSelections = wheelchairSelections.some(
    w => w.segmentKey === segment.key && w.code !== 'NONE',
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50/50 transition-colors"
      >
        <div className={cn(
          'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors',
          hasSelections ? 'bg-[#1ABC9C]/15 text-[#1ABC9C]' : 'bg-slate-100 text-slate-400',
        )}>
          <Accessibility className="w-5 h-5" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900">Wheelchair Assistance</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {hasSelections
              ? `${wheelchairSelections.filter(w => w.segmentKey === segment.key && w.code !== 'NONE').length} passenger(s) assisted`
              : 'Request wheelchair assistance for elderly or mobility-impaired travelers'}
          </p>
        </div>
        {hasSelections && (
          <span className="px-2 py-0.5 rounded-full bg-[#1ABC9C]/15 text-[#1ABC9C] text-[10px] font-bold uppercase tracking-wider shrink-0">
            Active
          </span>
        )}
        <ChevronDownIcon className={cn(
          'w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0',
          expanded && 'rotate-180',
        )} />
      </button>

      {/* Body — collapsible */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-5 border-t border-slate-100 pt-4">
              {/* Free notice */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1ABC9C]/8 border border-[#1ABC9C]/15">
                <Shield className="w-3.5 h-3.5 text-[#1ABC9C] shrink-0" strokeWidth={2} />
                <p className="text-xs text-[#1ABC9C] font-medium">
                  Wheelchair assistance is provided free of charge by the airline.
                </p>
              </div>

              {/* Per-passenger selection */}
              {passengers.map((pax, paxIdx) => {
                const existing = wheelchairSelections.find(
                  w => w.passengerId === pax.id && w.segmentKey === segment.key,
                );
                const activeCode = existing?.code ?? 'NONE';

                return (
                  <div key={pax.id}>
                    <div className="flex items-center gap-2 mb-3">
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ backgroundColor: PAX_HEX[paxIdx % PAX_HEX.length] }}
                      >
                        {paxIdx + 1}
                      </div>
                      <p className="text-sm font-semibold text-slate-700">{paxLabel(pax, paxIdx)}</p>
                      {activeCode !== 'NONE' && (
                        <span className="ml-auto text-[10px] font-bold text-[#1ABC9C] bg-[#1ABC9C]/10 px-2 py-0.5 rounded-full">
                          ♿ {activeCode}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {WHEELCHAIR_OPTIONS.map(opt => {
                        const isActive = activeCode === opt.code;
                        const isNone = opt.code === 'NONE';
                        return (
                          <button
                            key={opt.code}
                            onClick={() => onSelect(pax.id, segment.key, opt.code, opt.label)}
                            className={cn(
                              'flex items-start gap-3 px-3.5 py-3 rounded-xl border text-left transition-all',
                              isActive
                                ? isNone
                                  ? 'bg-slate-50 border-slate-300 ring-1 ring-slate-300'
                                  : 'bg-[#1ABC9C]/8 border-[#1ABC9C] ring-1 ring-[#1ABC9C]/30'
                                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50',
                            )}
                          >
                            <div className={cn(
                              'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                              isActive
                                ? isNone ? 'border-slate-400 bg-slate-400' : 'border-[#1ABC9C] bg-[#1ABC9C]'
                                : 'border-slate-300',
                            )}>
                              {isActive && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                            </div>
                            <div className="min-w-0">
                              <p className={cn(
                                'text-xs font-bold',
                                isActive && !isNone ? 'text-[#1ABC9C]' : 'text-slate-700',
                              )}>
                                {!isNone && '♿ '}{opt.label}
                              </p>
                              <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{opt.desc}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Disclaimer */}
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Wheelchair assistance availability is subject to airline confirmation. Your request will be
                communicated to the carrier using IATA standard codes (WCHR/WCHS/WCHC/WCOB).
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
  const pricingCfg = useBuildPricingConfig();
  const pricing = useMemo(() => buildLocalPricing(store, pricingCfg), [
    store.seatSelections, store.extraBags, store.priceProtection, store.travelInsurance, // eslint-disable-line react-hooks/exhaustive-deps
    store.passengers, store.selectedFare, pricingCfg, // eslint-disable-line react-hooks/exhaustive-deps
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
  const { isExpired, OfferGuardUI } = useOfferGuard();
  const store = useCheckoutStore();
  const {
    selectedFare, sessionId, sourceFlight, sourceRoundTrip,
    passengers, seatSelections, updateSeatSelection,
    wheelchairSelections, updateWheelchairSelection,
  } = store;

  // Lap infants (under 2) sit on parent's lap — exclude from seat selection
  const seatEligiblePax = useMemo(
    () => passengers.filter(p => p.type !== 'infant'),
    [passengers],
  );
  const hasInfants = passengers.length > seatEligiblePax.length;

  // Load DB-driven fees — populates computedFees in checkout store
  useFeeLoader();

  // ── Seat map state ──────────────────────────────────────────────────────────
  const [seatMaps, setSeatMaps]             = useState<SegmentSeatMap[]>([]);
  const [loadingMap, setLoadingMap]         = useState(true);
  const [mapError, setMapError]             = useState<string | null>(null);
  const [seatSelectionSupported, setSeatSelectionSupported] = useState(true);
  const [wheelchairSupported, setWheelchairSupported] = useState(false);
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
    fetch(`/api/seats/seat-map?offer_id=${encodeURIComponent(selectedFare.offerId)}&provider=${encodeURIComponent(sourceFlight?.provider ?? 'duffel')}`)
      .then(r => r.json())
      .then((data: { seatMaps: SegmentSeatMap[]; seatSelectionSupported?: boolean; wheelchairSupported?: boolean; error?: string }) => {
        setSeatMaps(data.seatMaps ?? []);
        setSeatSelectionSupported(data.seatSelectionSupported ?? true);
        setWheelchairSupported(data.wheelchairSupported ?? false);
        if (data.error) setMapError(data.error);
      })
      .catch(() => setMapError('Could not load seat map.'))
      .finally(() => setLoadingMap(false));
  }, [selectedFare?.offerId]);

  if (!selectedFare || !sessionId) return null;

  const segments = useMemo(() => buildSegments(sourceFlight, sourceRoundTrip), [sourceFlight, sourceRoundTrip]);
  const currency = selectedFare.currency ?? 'USD';
  const activeSeg = segments[activeSegIdx];

  // Does this segment have a real, bookable seat map?
  const activeSeatMap = seatMaps[activeSegIdx];
  const hasSeatMap = !loadingMap && seatSelectionSupported && !!activeSeatMap?.cabins?.[0]?.rows?.length;

  // ── Auto-advance to next segment when all passengers are done ───────────────
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoAdvanceMsg, setAutoAdvanceMsg] = useState<string | null>(null);

  // Track whether the user manually navigated to a tab (suppresses auto-advance)
  const manualTabOverride = useRef(false);
  // Track seat-change count to re-enable auto-advance after an edit
  const seatChangeCounter = useRef(0);

  // Handler for manual segment tab selection
  const handleSegmentTabSelect = useCallback((idx: number) => {
    // Clear any pending auto-advance
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
      autoAdvanceTimer.current = null;
      setAutoAdvanceMsg(null);
    }
    // Mark as manual override so auto-advance doesn't immediately kick in
    manualTabOverride.current = true;
    seatChangeCounter.current = 0;
    setActiveSegIdx(idx);
  }, []);

  // Check if all passengers have a seat or preference for the given segment
  const allPaxDoneForSeg = useCallback((segKey: string, currentSelections: typeof seatSelections) => {
    return seatEligiblePax.every(p =>
      currentSelections.some(s =>
        s.passengerId === p.id && s.segmentKey === segKey && (s.seatNumber || s.preference),
      ),
    );
  }, [seatEligiblePax]);

  // Build a set of completed segment indices for the tab UI
  const completedSegments = useMemo(() => {
    const done = new Set<number>();
    segments.forEach((seg, i) => {
      if (allPaxDoneForSeg(seg.key, seatSelections)) done.add(i);
    });
    return done;
  }, [segments, seatSelections, allPaxDoneForSeg]);

  // Auto-advance effect: when all passengers are done on current segment, jump to next
  // Respects manual tab override — only auto-advances after user makes a seat change
  useEffect(() => {
    if (segments.length <= 1) return; // only one segment, nothing to advance to
    if (activeSegIdx >= segments.length - 1) return; // already on last segment
    if (!activeSeg) return;

    // If user manually navigated to this tab and hasn't made a seat change yet,
    // don't auto-advance — let them browse/edit freely
    if (manualTabOverride.current && seatChangeCounter.current === 0) {
      // Clear any leftover auto-advance UI
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
        setAutoAdvanceMsg(null);
      }
      return;
    }

    const done = allPaxDoneForSeg(activeSeg.key, seatSelections);
    if (!done) {
      // Clear any pending auto-advance if user deselects
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
        setAutoAdvanceMsg(null);
      }
      return;
    }

    // All passengers done on this segment — auto-advance after a brief delay
    const nextIdx = activeSegIdx + 1;
    const nextSeg = segments[nextIdx];
    setAutoAdvanceMsg(`All seats selected! Switching to ${nextSeg?.journeyLabel ?? 'next segment'}…`);

    autoAdvanceTimer.current = setTimeout(() => {
      manualTabOverride.current = false; // reset override for new segment
      seatChangeCounter.current = 0;
      setActiveSegIdx(nextIdx);
      setAutoAdvanceMsg(null);
      autoAdvanceTimer.current = null;
    }, 800);

    return () => {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
        autoAdvanceTimer.current = null;
      }
    };
  }, [seatSelections, activeSegIdx, segments, activeSeg, allPaxDoneForSeg]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Seat selection handler ──────────────────────────────────────────────────
  const handleSeatClick = useCallback((
    designator: string,
    serviceId: string | null,
    serviceIds: string[],
    price: number,
    curr: string,
  ) => {
    if (!activeSeg) return;
    const pax = seatEligiblePax[activePaxIdx];
    if (!pax) return;

    // Track that the user made a seat change (re-enables auto-advance after manual tab nav)
    seatChangeCounter.current += 1;

    // Toggle: clicking an already-assigned seat deselects it
    const existing = seatSelections.find(
      s => s.passengerId === pax.id && s.segmentKey === activeSeg.key,
    );
    if (existing?.seatNumber === designator) {
      updateSeatSelection(pax.id, activeSeg.key, { seatNumber: null, priceUsd: 0, serviceId: null, serviceIds: [] });
      return;
    }

    updateSeatSelection(pax.id, activeSeg.key, {
      seatNumber: designator,
      priceUsd: price,
      serviceId,
      serviceIds,
      preference: 'no_preference',
    });

    // Auto-advance to next passenger that hasn't been assigned this segment
    const nextUnassigned = seatEligiblePax.findIndex((p, i) => {
      if (i <= activePaxIdx) return false;
      return !seatSelections.find(s => s.passengerId === p.id && s.segmentKey === activeSeg.key && s.seatNumber);
    });
    if (nextUnassigned !== -1) {
      setActivePaxIdx(nextUnassigned);
    }
  }, [activeSeg, seatEligiblePax, activePaxIdx, seatSelections, updateSeatSelection]);

  // ── Preference handler (fallback) ───────────────────────────────────────────
  const handlePrefSelect = useCallback((paxId: string, segKey: string, pref: SeatPreference) => {
    // Track that the user made a change (re-enables auto-advance after manual tab nav)
    seatChangeCounter.current += 1;
    updateSeatSelection(paxId, segKey, { preference: pref, seatNumber: null, priceUsd: 0, serviceId: null });
    // Note: auto-advance to next segment is handled by the useEffect above
    // that watches seatSelections changes
  }, [updateSeatSelection]);

  // ── Assignments for active segment ─────────────────────────────────────────
  const activeAssignments = useMemo(() => {
    if (!activeSeg) return [];
    return seatEligiblePax
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
  }, [seatEligiblePax, seatSelections, activeSeg, currency]);

  const passengerLabels = seatEligiblePax.map((p, i) => paxLabel(p, i));

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />
      {OfferGuardUI()}

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

            {/* Lap infant info banner */}
            {hasInfants && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold">Lap infants (under 2)</span> travel on a parent&apos;s lap and do not require a seat.
                </span>
              </div>
            )}

            {/* Auto-advance toast */}
            <AnimatePresence>
              {autoAdvanceMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/25 text-[#1ABC9C] text-sm font-semibold"
                >
                  <Check className="w-4 h-4" strokeWidth={3} />
                  {autoAdvanceMsg}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Segment tabs */}
            {activeSeg && (
              <SegmentTabs
                segments={segments}
                activeIndex={activeSegIdx}
                seatMaps={seatMaps}
                completedSegments={completedSegments}
                onSelect={handleSegmentTabSelect}
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
                  {!seatSelectionSupported ? (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold">Seat selection is not available</span> for this airline/fare through our booking system.
                        Your seat will be assigned by the airline — you can select or change your seat during online check-in or at the airport.
                      </span>
                    </div>
                  ) : mapError ? (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Interactive seat map is not available for this flight. Select your preference below.</span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] text-[#B91C1C] text-xs">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Seat map not available. Choose your seating preference and the airline will assign a matching seat.</span>
                    </div>
                  )}
                  <PreferencePicker
                    segment={activeSeg}
                    passengers={seatEligiblePax}
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
                    {seatEligiblePax.length > 1 && (
                      <div className="mt-5 pt-4 border-t border-slate-100">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <Users className="w-3 h-3" /> Switch passenger
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {seatEligiblePax.map((pax, i) => {
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

            {/* Wheelchair Assistance — per segment */}
            {activeSeg && !loadingMap && wheelchairSupported && (
              <WheelchairAssistancePanel
                segment={activeSeg}
                passengers={seatEligiblePax}
                wheelchairSelections={wheelchairSelections}
                onSelect={updateWheelchairSelection}
              />
            )}

            {/* Wheelchair Not Available message */}
            {activeSeg && !loadingMap && !wheelchairSupported && (
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="px-5 py-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <span className="text-lg">♿</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Wheelchair Assistance</p>
                    <p className="text-xs text-slate-400">Not available through our booking system</p>
                  </div>
                </div>
                <div className="px-5 pb-4">
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
                    <Info className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-700 leading-relaxed">
                      Wheelchair and special assistance requests are not available through our booking system for this airline.
                      Please contact the airline directly or request assistance during online check-in.
                    </p>
                  </div>
                </div>
              </div>
            )}

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
