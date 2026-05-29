'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronRight, Check, Plane,
  Shield, Sparkles, ChevronDown,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatTime, formatDate, formatPrice } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import type { MealOptionDef } from '@/lib/meal-types';
import type { PassengerInfo } from '@/store/useCheckoutStore';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

const STEP_INDEX = 3;

// ── Accent tints per meal accent color ────────────────────────────────────────

const ACCENT_TINTS: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-300',  text: 'text-slate-700',  glow: 'shadow-slate-200'  },
  green:   { bg: 'bg-green-50',   border: 'border-green-400',  text: 'text-green-700',  glow: 'shadow-green-200'  },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-400',text: 'text-emerald-700',glow: 'shadow-emerald-200'},
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-400',   text: 'text-blue-700',   glow: 'shadow-blue-200'   },
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-400', text: 'text-indigo-700', glow: 'shadow-indigo-200' },
  orange:  { bg: 'bg-orange-50',  border: 'border-orange-400', text: 'text-orange-700', glow: 'shadow-orange-200' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-400',  text: 'text-amber-700',  glow: 'shadow-amber-200'  },
  pink:    { bg: 'bg-pink-50',    border: 'border-pink-400',   text: 'text-pink-700',   glow: 'shadow-pink-200'   },
  yellow:  { bg: 'bg-yellow-50',  border: 'border-yellow-400', text: 'text-yellow-700', glow: 'shadow-yellow-200' },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-400',   text: 'text-rose-700',   glow: 'shadow-rose-200'   },
  cyan:    { bg: 'bg-cyan-50',    border: 'border-cyan-400',   text: 'text-cyan-700',   glow: 'shadow-cyan-200'   },
  lime:    { bg: 'bg-lime-50',    border: 'border-lime-400',   text: 'text-lime-700',   glow: 'shadow-lime-200'   },
};

function accentFor(a: string) {
  return ACCENT_TINTS[a] ?? ACCENT_TINTS.slate;
}

// ── DisplaySegment ────────────────────────────────────────────────────────────

interface DisplaySegment {
  key: string;
  label: string;
  from: string;
  to: string;
  depTime: string;
  durationMin: number;
  flightNumbers: string;
  airline: string;
  airlineCode: string;
}

function buildSegments(
  sourceFlight: UnifiedFlight | null,
  sourceRoundTrip: RoundTripOption | null,
): DisplaySegment[] {
  if (sourceRoundTrip) {
    return [
      {
        key: 'out', label: 'Outbound',
        from: sourceRoundTrip.outboundJourney.departureAirport,
        to:   sourceRoundTrip.outboundJourney.arrivalAirport,
        depTime:     sourceRoundTrip.outboundJourney.departureTime,
        durationMin: sourceRoundTrip.outboundJourney.durationMinutes,
        flightNumbers: sourceRoundTrip.outboundJourney.flightNumbers.join(', '),
        airline:     sourceRoundTrip.outboundJourney.airlineNames[0] ?? '',
        airlineCode: sourceRoundTrip.outboundJourney.flightNumbers[0]?.slice(0, 2) ?? '',
      },
      {
        key: 'ret', label: 'Return',
        from: sourceRoundTrip.returnJourney.departureAirport,
        to:   sourceRoundTrip.returnJourney.arrivalAirport,
        depTime:     sourceRoundTrip.returnJourney.departureTime,
        durationMin: sourceRoundTrip.returnJourney.durationMinutes,
        flightNumbers: sourceRoundTrip.returnJourney.flightNumbers.join(', '),
        airline:     sourceRoundTrip.returnJourney.airlineNames[0] ?? '',
        airlineCode: sourceRoundTrip.returnJourney.flightNumbers[0]?.slice(0, 2) ?? '',
      },
    ];
  }
  return (sourceFlight?.segments ?? []).map((seg, i) => ({
    key: `seg_${i}`,
    label: i === 0 ? 'Outbound' : `Segment ${i + 1}`,
    from: seg.departure.airport,
    to:   seg.arrival.airport,
    depTime:     seg.departure.time,
    durationMin: seg.duration,
    flightNumbers: seg.flightNumber,
    airline:     seg.airline.name,
    airlineCode: seg.airline.code,
  }));
}

function paxLabel(p: PassengerInfo, i: number): string {
  const n = [p.firstName, p.lastName].filter(Boolean).join(' ');
  return n || `Traveler ${i + 1}`;
}



// ── Meal chip ─────────────────────────────────────────────────────────────────

interface MealChipProps {
  meal: MealOptionDef;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}

function MealChip({ meal, selected, recommended, onSelect }: MealChipProps) {
  const t = accentFor(meal.accent);

  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        'relative flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-center transition-all duration-150 w-full cursor-pointer select-none',
        selected
          ? `${t.bg} ${t.border} ring-1 ring-current shadow-md ${t.glow}`
          : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm',
      )}
    >
      {/* Recommended badge */}
      {recommended && !selected && (
        <span className="absolute -top-1.5 -right-1.5 flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-amber-400 text-[7px] font-black text-white leading-none shadow">
          <Sparkles className="w-2 h-2" />AI
        </span>
      )}

      {/* Selected checkmark */}
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#1ABC9C] flex items-center justify-center shadow"
        >
          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        </motion.span>
      )}

      <span className="text-lg leading-none">{meal.emoji}</span>
      <span className={cn('text-xs font-bold leading-tight', selected ? t.text : 'text-slate-700')}>
        {meal.label}
      </span>
      {meal.price > 0 && (
        <span className="text-[9px] font-semibold text-[#1ABC9C]">+${meal.price}</span>
      )}
    </motion.button>
  );
}

// ── Meal card (one per segment) ───────────────────────────────────────────────

interface MealCardProps {
  segment: DisplaySegment;
  meals: MealOptionDef[];
  recommended: string;
  passengers: PassengerInfo[];
  mealSelections: import('@/store/useCheckoutStore').MealSelection[];
  cardIndex: number;
  onSelect: (paxId: string, segKey: string, meal: MealOptionDef) => void;
}

function MealCard({
  segment, meals, recommended, passengers, mealSelections, cardIndex, onSelect,
}: MealCardProps) {
  const [activePax, setActivePax] = useState(0);
  const pax = passengers[activePax];

  const currentCode = useMemo(() => {
    if (!pax) return null;
    return mealSelections.find(m => m.passengerId === pax.id && m.segmentKey === segment.key)?.mealType ?? null;
  }, [mealSelections, pax, segment.key]);

  const currentLabel = meals.find(m => m.code === currentCode)?.label;

  // Check if all passengers have a meal selected for this segment
  const allPaxDone = useMemo(() => {
    return passengers.every(p =>
      mealSelections.some(m => m.passengerId === p.id && m.segmentKey === segment.key),
    );
  }, [passengers, mealSelections, segment.key]);

  // Auto-advance to next passenger after meal selection
  const handleMealSelect = useCallback((meal: MealOptionDef) => {
    if (!pax) return;
    onSelect(pax.id, segment.key, meal);

    // Auto-advance to next passenger that doesn't have a meal yet
    if (passengers.length > 1) {
      const nextUnassigned = passengers.findIndex((p, i) => {
        if (i <= activePax) return false;
        return !mealSelections.some(m => m.passengerId === p.id && m.segmentKey === segment.key);
      });
      if (nextUnassigned !== -1) {
        setTimeout(() => setActivePax(nextUnassigned), 200);
      }
    }
  }, [pax, onSelect, segment.key, passengers, activePax, mealSelections]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: cardIndex * 0.08, duration: 0.3 }}
      className="flex flex-col rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white"
    >
      {/* ── Card header (dark gradient) ── */}
      <div className="bg-gradient-to-br from-[#1a1a2e] to-[#16213e] px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full bg-[#1ABC9C]/20 flex items-center justify-center">
            <Plane className="w-3 h-3 text-[#1ABC9C]" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider">{segment.label}</span>
              <span className="text-[10px] text-white/40">·</span>
              <span className="text-xs font-bold text-white truncate">{segment.from} → {segment.to}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[9px] text-white/50">{formatDate(segment.depTime)}</span>
              {segment.flightNumbers && (
                <>
                  <span className="text-white/30">·</span>
                  <span className="text-[9px] font-mono text-white/40">{segment.flightNumbers}</span>
                </>
              )}
            </div>
          </div>
          {/* Selected meal badge or all-done badge */}
          <AnimatePresence mode="wait">
            {allPaxDone ? (
              <motion.span
                key="all-done"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-400/15 px-2 py-0.5 rounded-full shrink-0"
              >
                <Check className="w-2.5 h-2.5" strokeWidth={3} />
                All set
              </motion.span>
            ) : currentCode ? (
              <motion.span
                key={currentCode}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="text-[9px] font-bold text-[#1ABC9C] bg-[#1ABC9C]/15 px-2 py-0.5 rounded-full shrink-0"
              >
                {currentLabel}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Passenger selector */}
        {passengers.length > 1 ? (
          <div className="flex gap-1.5 mt-2">
            {passengers.map((p, i) => {
              const hasMeal = mealSelections.some(m => m.passengerId === p.id && m.segmentKey === segment.key);
              return (
                <button
                  key={p.id}
                  onClick={() => setActivePax(i)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all',
                    i === activePax
                      ? 'bg-[#1ABC9C] text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/15',
                  )}
                >
                  {paxLabel(p, i).split(' ')[0]}
                  {hasMeal && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-[#1ABC9C]/30 flex items-center justify-center">
              <span className="text-[8px] font-bold text-[#1ABC9C]">1</span>
            </div>
            <span className="text-[10px] text-white/60">{paxLabel(passengers[0], 0)}</span>
          </div>
        )}
      </div>

      {/* ── Meal chips grid ── */}
      <div className="flex-1 p-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activePax}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.15 }}
            className="grid grid-cols-3 gap-1.5"
          >
            {meals.map(meal => (
              <MealChip
                key={meal.code}
                meal={meal}
                selected={currentCode === meal.code}
                recommended={recommended === meal.code}
                onSelect={() => handleMealSelect(meal)}
              />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Right panel: live itinerary ───────────────────────────────────────────────

function ItineraryPanel({
  segments,
  currency,
  onContinue,
}: {
  segments: DisplaySegment[];
  currency: string;
  onContinue: () => void;
}) {
  const store = useCheckoutStore();
  const pricing = useMemo(() => buildLocalPricing(store), [
    store.mealSelections, store.seatSelections, store.extraBags, // eslint-disable-line react-hooks/exhaustive-deps
    store.priceProtection, store.travelInsurance, store.passengers, store.selectedFare, // eslint-disable-line react-hooks/exhaustive-deps
  ]);

  const mealTotal = pricing.mealFees;

  return (
    <div className="sticky top-[calc(4rem+5.75rem+2px)] h-full">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 h-full flex flex-col">
        <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#1ABC9C]" strokeWidth={2} />
          Price Summary
        </h3>

        {/* Base fares */}
        <div className="space-y-1.5 text-sm">
          {pricing.perPassenger.map((pp, i) => (
            <div key={pp.passengerId} className="flex justify-between">
              <span className="text-slate-500">Pax {i + 1} flight</span>
              <span className="font-medium text-slate-800">{formatPrice(pp.subtotal, currency)}</span>
            </div>
          ))}
          {pricing.seatFees > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-500">Seat fees</span>
              <span className="font-medium text-slate-800">{formatPrice(pricing.seatFees, currency)}</span>
            </div>
          )}
          {pricing.serviceFee > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-400 text-xs">Service fee</span>
              <span className="text-slate-400 text-xs">{formatPrice(pricing.serviceFee, currency)}</span>
            </div>
          )}
        </div>

        {/* Meal selections — live update */}
        <AnimatePresence>
          {store.mealSelections.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Meals</p>
                {store.passengers.map((pax, pi) =>
                  segments.map(seg => {
                    const sel = store.mealSelections.find(
                      m => m.passengerId === pax.id && m.segmentKey === seg.key,
                    );
                    if (!sel) return null;
                    return (
                      <motion.div
                        key={`${pax.id}-${seg.key}`}
                        initial={{ x: -8, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-slate-600 truncate">
                          {paxLabel(pax, pi).split(' ')[0]} · {seg.label}
                          <span className="ml-1 text-slate-400">({sel.mealLabel || sel.mealType})</span>
                        </span>
                        <span className="font-semibold text-slate-800 shrink-0 ml-2">
                          {sel.priceUsd === 0 ? <span className="text-emerald-600">Free</span> : formatPrice(sel.priceUsd, currency)}
                        </span>
                      </motion.div>
                    );
                  })
                )}
                {mealTotal > 0 && (
                  <div className="flex justify-between text-xs pt-1 border-t border-slate-100">
                    <span className="text-slate-500">Meal fees</span>
                    <span className="font-bold text-slate-800">{formatPrice(mealTotal, currency)}</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Grand total */}
        <div className="flex items-baseline justify-between mt-auto pt-4 border-t border-slate-200">
          <span className="text-sm font-bold text-slate-700">Trip total</span>
          <motion.span
            key={pricing.total}
            initial={{ scale: 1.06, color: '#1ABC9C' }}
            animate={{ scale: 1, color: '#F97316' }}
            transition={{ duration: 0.25 }}
            className="text-2xl font-extrabold"
            style={{ color: '#F97316' }}
          >
            {formatPrice(pricing.total, currency)}
          </motion.span>
        </div>

        <button
          onClick={onContinue}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/20 transition-all"
        >
          Continue to Add-ons <ChevronRight className="w-4 h-4" />
        </button>

        <div className="flex items-center justify-center gap-1.5 mt-3 text-slate-400 text-[10px]">
          <Lock className="w-3 h-3" />
          Selections can be updated 24h before departure
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface SegmentMeals {
  meals: MealOptionDef[];
  recommended: string;
}

export default function MealsPage() {
  const router = useRouter();
  const {
    selectedFare, sessionId, sourceFlight, sourceRoundTrip,
    passengers, mealSelections, updateMealSelection,
  } = useCheckoutStore();

  const [segmentMeals, setSegmentMeals] = useState<(SegmentMeals | null)[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedFare || !sessionId) router.replace('/');
  }, [selectedFare, sessionId, router]);

  const segments = useMemo(
    () => buildSegments(sourceFlight, sourceRoundTrip),
    [sourceFlight, sourceRoundTrip],
  );

  // Fetch meal options for each segment
  useEffect(() => {
    if (!segments.length) { setLoading(false); return; }

    setLoading(true);
    const hasChildren = passengers.some(p => p.type === 'child' || p.type === 'infant');

    Promise.all(
      segments.map(seg =>
        fetch(
          `/api/meals?airline=${encodeURIComponent(seg.airlineCode)}&origin=${seg.from}&destination=${seg.to}&duration=${seg.durationMin}&children=${hasChildren}`,
        )
          .then(r => r.json())
          .then((data: { meals: MealOptionDef[]; recommended: string }) => data)
          .catch(() => null),
      ),
    ).then(results => {
      setSegmentMeals(results);
      setLoading(false);
    });
  }, [segments, passengers]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedFare || !sessionId) return null;

  const currency = selectedFare.currency ?? 'USD';

  const handleSelect = useCallback(
    (paxId: string, segKey: string, meal: MealOptionDef) => {
      const existing = mealSelections.find(m => m.passengerId === paxId && m.segmentKey === segKey);
      if (existing?.mealType === meal.code) {
        // Deselect — set back to no selection (remove by setting NONE)
        return;
      }
      updateMealSelection(paxId, segKey, meal.code, meal.label, meal.price);
    },
    [mealSelections, updateMealSelection],
  );

  const colCount = segments.length > 1 ? 3 : 2;

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">

        {/* Heading — full width */}
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Choose your meal</h1>
          <p className="text-sm text-slate-400 mt-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Per traveler · Per journey · AI-recommended highlighted
          </p>
        </div>

        {/* Main grid: each meal card + price summary as equal columns */}
        <div className={cn(
          'grid grid-cols-1 gap-6',
          colCount === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
        )}>

          {/* Loading skeletons */}
          {loading && Array.from({ length: Math.max(1, segments.length) }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
              <div className="h-20 bg-slate-200" />
              <div className="p-3 grid grid-cols-3 gap-1.5">
                {Array.from({ length: 6 }).map((_, j) => (
                  <div key={j} className="h-16 rounded-xl bg-slate-100" />
                ))}
              </div>
            </div>
          ))}

          {/* Meal cards — one per column */}
          {!loading && segments.map((seg, i) => {
            const sm = segmentMeals[i];
            if (!sm) return null;
            return (
              <MealCard
                key={seg.key}
                segment={seg}
                meals={sm.meals}
                recommended={sm.recommended}
                passengers={passengers}
                mealSelections={mealSelections}
                cardIndex={i}
                onSelect={handleSelect}
              />
            );
          })}

          {/* Price Summary — last column */}
          <div className="hidden lg:flex flex-col">
            <ItineraryPanel
              segments={segments}
              currency={currency}
              onContinue={() => router.push('/checkout/addons')}
            />
          </div>
        </div>

        {/* Info strip — full width */}
        {!loading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-700 text-xs"
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-500" />
            Meal availability depends on flight duration and airline. Subject to change at time of booking.
          </motion.div>
        )}

        {/* Mobile CTA */}
        <button
          onClick={() => router.push('/checkout/addons')}
          className="lg:hidden w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2"
        >
          Continue to Add-ons <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
