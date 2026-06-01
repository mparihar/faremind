'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { apiUrl } from '@/lib/api-client';
import {
  Plane, User, CreditCard, Check, ChevronRight, Shield, Lock,
  Loader2, ArrowLeft, Sparkles, AlertCircle, X, Package,
  Info, Plus, Minus, ShieldCheck, FileText, Luggage,
  Utensils, LayoutGrid,
} from 'lucide-react';
import { cn, formatPrice, formatTime, formatDuration } from '@/lib/utils';
import Link from 'next/link';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';
import { useFareStore } from '@/store/useFareStore';
import type { FareOption } from '@/lib/fare-types';
import {
  useBookingStore,
  type SeatPref,
  type MealPref,
  type PassengerData,
  type BookingResult,
} from '@/store/useBookingStore';

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'itinerary',  label: 'Itinerary',  icon: Plane      },
  { key: 'seats',      label: 'Seats',      icon: LayoutGrid },
  { key: 'meals',      label: 'Meals',      icon: Utensils   },
  { key: 'extras',     label: 'Extras',     icon: Package    },
  { key: 'passengers', label: 'Passengers', icon: User       },
  { key: 'review',     label: 'Review',     icon: FileText   },
  { key: 'payment',    label: 'Payment',    icon: CreditCard },
  { key: 'confirm',    label: 'Confirmed',  icon: Check      },
];

// ─── Pricing helper ───────────────────────────────────────────────────────────

function computeBookingPricing(
  selectedFare: { totalPrice: number; protectionFee: number } | null,
  fallbackBase: number,
  extraBags: number,
  protection: boolean,
) {
  const fareBase      = selectedFare?.totalPrice ?? fallbackBase;
  const protectionFee = protection ? (selectedFare?.protectionFee ?? Math.min(Math.max(Math.round(fareBase * 0.06), 49), 399)) : 0;
  const baggageFee    = extraBags * 35;
  return { fareBase, protectionFee, baggageFee, total: fareBase + protectionFee + baggageFee };
}

// ─── Segment display helpers ──────────────────────────────────────────────────

interface DisplaySegment {
  key: string;
  label: string;
  from: string;
  to: string;
  flightNumbers: string;
  durationMin: number;
  depTime?: string;
  arrTime?: string;
}

function getDisplaySegments(flight: UnifiedFlight | null, rt: RoundTripOption | null): DisplaySegment[] {
  if (rt) {
    return [
      {
        key: 'outbound', label: 'Outbound',
        from: rt.outboundJourney.departureAirport, to: rt.outboundJourney.arrivalAirport,
        flightNumbers: rt.outboundJourney.flightNumbers.join(', '),
        durationMin: rt.outboundJourney.durationMinutes,
        depTime: rt.outboundJourney.departureTime,
        arrTime: rt.outboundJourney.arrivalTime,
      },
      {
        key: 'return', label: 'Return',
        from: rt.returnJourney.departureAirport, to: rt.returnJourney.arrivalAirport,
        flightNumbers: rt.returnJourney.flightNumbers.join(', '),
        durationMin: rt.returnJourney.durationMinutes,
        depTime: rt.returnJourney.departureTime,
        arrTime: rt.returnJourney.arrivalTime,
      },
    ];
  }
  return (flight?.segments ?? []).map((seg, i) => ({
    key: `seg_${i}`,
    label: i === 0 ? 'Outbound' : `Segment ${i + 1}`,
    from: seg.departure.airport,
    to: seg.arrival.airport,
    flightNumbers: seg.flightNumber,
    durationMin: seg.duration,
    depTime: seg.departure.time,
    arrTime: seg.arrival.time,
  }));
}

function roundTripToFlightPayload(rt: RoundTripOption, totalPrice: number) {
  const ob = rt.outboundJourney;
  const ret = rt.returnJourney;
  const airline = { code: rt.airlineCodes[0] ?? 'XX', name: rt.airlines[0] ?? 'Unknown' };
  return {
    id: rt.id, provider: rt.provider, providerOfferId: rt.providerOfferId, airline,
    segments: [
      {
        id: 'seg_outbound',
        departure: { airport: ob.departureAirport, airportName: ob.departureAirport, city: ob.departureAirport, time: ob.departureTime },
        arrival: { airport: ob.arrivalAirport, airportName: ob.arrivalAirport, city: ob.arrivalAirport, time: ob.arrivalTime },
        airline, flightNumber: ob.flightNumbers[0] ?? '', duration: ob.durationMinutes,
      },
      {
        id: 'seg_return',
        departure: { airport: ret.departureAirport, airportName: ret.departureAirport, city: ret.departureAirport, time: ret.departureTime },
        arrival: { airport: ret.arrivalAirport, airportName: ret.arrivalAirport, city: ret.arrivalAirport, time: ret.arrivalTime },
        airline, flightNumber: ret.flightNumbers[0] ?? '', duration: ret.durationMinutes,
      },
    ],
    totalPrice, currency: rt.currency, totalDuration: rt.totalDurationMinutes,
    stops: rt.totalStops, cabinClass: rt.cabinClass, fareRules: rt.fareRules, baggage: rt.baggage,
    fareClass: rt.cabinClass,
  };
}

// ─── Card formatting ──────────────────────────────────────────────────────────

const fmtCardNum = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
const fmtExpiry  = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 4); return d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d; };

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between text-sm gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={cn('font-medium text-right', accent ? 'text-[#1ABC9C]' : 'text-slate-900')}>{value}</span>
    </div>
  );
}

const CARD_CLS = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5';
const CTA_CLS  = 'w-full flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-semibold text-white bg-[#1ABC9C] hover:bg-emerald-500 shadow-lg shadow-[#1ABC9C]/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const INPUT_CLS = 'w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-[#1ABC9C]/50 focus:bg-white transition-all';

// ─── Step 0: Itinerary Review ─────────────────────────────────────────────────

function ItineraryReviewStep({
  segs, selectedFare, fareOption, pricing, currency, onNext,
}: {
  segs: DisplaySegment[];
  selectedFare: { name: string; cabin: string; totalPrice: number; priceProtection: boolean } | null;
  fareOption: FareOption | null;
  pricing: ReturnType<typeof computeBookingPricing>;
  currency: string;
  onNext: () => void;
}) {
  return (
    <>
      <div className="space-y-4">
        {/* Flight segments */}
        <div className={CARD_CLS}>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-4">Your Itinerary</p>
          {segs.length === 0 ? (
            <p className="text-sm text-slate-400">Flight details not available.</p>
          ) : (
            <div className="space-y-5">
              {segs.map((seg, i) => (
                <div key={seg.key} className={cn(i > 0 && 'pt-5 border-t border-slate-100')}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider bg-[#1ABC9C]/10 px-2.5 py-0.5 rounded-full">
                      {seg.label}
                    </span>
                    {seg.flightNumbers && (
                      <span className="text-xs text-slate-400">{seg.flightNumbers}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-center min-w-[64px]">
                      {seg.depTime && <p className="text-[22px] font-black text-slate-900 leading-none">{formatTime(seg.depTime)}</p>}
                      <p className="text-[13px] font-bold text-slate-700 mt-0.5">{seg.from}</p>
                    </div>
                    <div className="flex-1 flex flex-col items-center gap-1">
                      <p className="text-[11px] text-slate-400">{formatDuration(seg.durationMin)}</p>
                      <div className="w-full flex items-center gap-1.5">
                        <div className="h-px flex-1 bg-slate-200" />
                        <Plane size={12} className="text-[#1ABC9C] rotate-90" />
                        <div className="h-px flex-1 bg-slate-200" />
                      </div>
                      <p className="text-[10px] text-slate-400">Non-stop</p>
                    </div>
                    <div className="text-center min-w-[64px]">
                      {seg.arrTime && <p className="text-[22px] font-black text-slate-900 leading-none">{formatTime(seg.arrTime)}</p>}
                      <p className="text-[13px] font-bold text-slate-700 mt-0.5">{seg.to}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Selected fare */}
        {selectedFare && (
          <div className={CARD_CLS}>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Selected Fare</p>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-[16px] font-extrabold text-slate-900">{selectedFare.name}</h3>
                <span className="inline-block mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                  {selectedFare.cabin.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">per traveler</p>
                <p className="text-[24px] font-black text-[#F97316] leading-none">{formatPrice(selectedFare.totalPrice, currency)}</p>
              </div>
            </div>

            {fareOption && (
              <div className="border-t border-slate-100 pt-3 space-y-0">
                {[
                  { ok: true,  label: `${fareOption.baggage.carryOnPieces}× carry-on${fareOption.baggage.carryOnWeightKg ? ` (${fareOption.baggage.carryOnWeightKg} kg)` : ''}` },
                  fareOption.baggage.checked > 0
                    ? { ok: true,  label: `${fareOption.baggage.checked}× checked bag${fareOption.baggage.checked > 1 ? 's' : ''}${fareOption.baggage.checkedWeightKg ? ` · ${fareOption.baggage.checkedWeightKg} kg` : ''}` }
                    : { ok: false, label: 'No checked bag' },
                  !fareOption.policy.refundable
                    ? { ok: false, label: 'Non-refundable' }
                    : fareOption.policy.refundFeeUsd === 0
                    ? { ok: true,  label: 'Fully refundable' }
                    : { ok: true,  label: 'Refundable (fee applies)' },
                  !fareOption.policy.changeable
                    ? { ok: false, label: 'No changes allowed' }
                    : fareOption.policy.changeFeeUsd === 0
                    ? { ok: true,  label: 'Free changes' }
                    : { ok: true,  label: 'Changes allowed (fee applies)' },
                  fareOption.policy.seatSelection === 'free'
                    ? { ok: true,  label: 'Free seat selection' }
                    : fareOption.policy.seatSelection === 'fee'
                    ? { ok: true,  label: 'Seat selection (fee applies)' }
                    : { ok: false, label: 'No seat selection' },
                  { ok: fareOption.policy.priorityBoarding, label: 'Priority boarding' },
                  {
                    ok: fareOption.policy.milesEarning !== 'none',
                    label: fareOption.policy.milesEarning === 'full' ? 'Full miles earned' : fareOption.policy.milesEarning === 'reduced' ? '50% miles earned' : 'No miles earned',
                  },
                ].map((f, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-1.5 border-b border-slate-50 last:border-0">
                    {f.ok
                      ? <Check size={13} className="text-emerald-500 shrink-0" strokeWidth={2.5} />
                      : <X     size={13} className="text-slate-300   shrink-0" strokeWidth={2.5} />
                    }
                    <span className={cn('text-[13px]', f.ok ? 'text-slate-700' : 'text-slate-400')}>{f.label}</span>
                  </div>
                ))}
              </div>
            )}

            {selectedFare.priceProtection && (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-[#1ABC9C] font-semibold">
                <Shield size={13} />
                Price Drop Protection included
              </div>
            )}
          </div>
        )}

        {/* Price breakdown */}
        <div className={CARD_CLS}>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Price Breakdown</p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Selected fare</span>
              <span className="text-slate-900 font-medium">{formatPrice(pricing.fareBase, currency)}</span>
            </div>
            {pricing.protectionFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Price protection</span>
                <span className="text-[#1ABC9C] font-medium">+{formatPrice(pricing.protectionFee, currency)}</span>
              </div>
            )}
            {pricing.baggageFee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Extra bags</span>
                <span className="text-slate-900 font-medium">+{formatPrice(pricing.baggageFee, currency)}</span>
              </div>
            )}
            <div className="border-t border-slate-100 pt-3 mt-1 flex justify-between items-center">
              <span className="text-sm font-bold text-slate-900">Total per traveler</span>
              <span className="text-[22px] font-black text-[#F97316] leading-none">{formatPrice(pricing.total, currency)}</span>
            </div>
          </div>
        </div>
      </div>

      <button onClick={onNext} className={CTA_CLS}>
        Continue to Seat Preferences <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Step 1: Seats ────────────────────────────────────────────────────────────

const SEAT_OPTS: { key: SeatPref; label: string; icon: string }[] = [
  { key: 'window',        label: 'Window',        icon: '🪟' },
  { key: 'aisle',         label: 'Aisle',         icon: '🚶' },
  { key: 'middle',        label: 'Middle',        icon: '💺' },
  { key: 'no_preference', label: 'No Preference', icon: '🎲' },
];

function SeatStep({ segs, prefs, onSet, onNext }: {
  segs: DisplaySegment[]; prefs: Record<string, SeatPref>;
  onSet: (k: string, p: SeatPref) => void; onNext: () => void;
}) {
  return (
    <>
      <div className={CARD_CLS}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Seat Preferences</h2>
        <p className="text-sm text-slate-500 mb-5">We'll do our best to honor your preference. Subject to availability.</p>
        <div className="space-y-6">
          {segs.map((seg) => (
            <div key={seg.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded">{seg.label}</span>
                <span className="text-sm font-semibold text-slate-900">{seg.from} → {seg.to}</span>
                <span className="text-xs text-slate-400 ml-auto">{formatDuration(seg.durationMin)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {SEAT_OPTS.map((opt) => {
                  const sel = (prefs[seg.key] ?? 'no_preference') === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => onSet(seg.key, opt.key)}
                      className={cn(
                        'p-3 rounded-xl border text-center transition-all',
                        sel
                          ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/40 text-[#1ABC9C]'
                          : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                      )}
                    >
                      <div className="text-xl mb-1">{opt.icon}</div>
                      <p className="text-xs font-medium">{opt.label}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onNext} className={CTA_CLS}>
        Continue to Meal Preferences <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Step 2: Meals ────────────────────────────────────────────────────────────

const MEAL_OPTS: { key: MealPref; label: string; desc: string }[] = [
  { key: 'standard',   label: 'Standard',   desc: 'Regular airline meal'   },
  { key: 'vegetarian', label: 'Vegetarian', desc: 'Plant-based, no meat'   },
  { key: 'vegan',      label: 'Vegan',      desc: 'No animal products'     },
  { key: 'halal',      label: 'Halal',      desc: 'Halal-certified meal'   },
  { key: 'kosher',     label: 'Kosher',     desc: 'Kosher-certified meal'  },
  { key: 'none',       label: 'No Meal',    desc: 'Skip in-flight service' },
];

function MealStep({ segs, prefs, onSet, onNext }: {
  segs: DisplaySegment[]; prefs: Record<string, MealPref>;
  onSet: (k: string, p: MealPref) => void; onNext: () => void;
}) {
  return (
    <>
      <div className={CARD_CLS}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Meal Preferences</h2>
        <p className="text-sm text-slate-500 mb-5">Available on qualifying flights. Subject to airline policy.</p>
        <div className="space-y-6">
          {segs.map((seg) => (
            <div key={seg.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-2 py-0.5 rounded">{seg.label}</span>
                <span className="text-sm font-semibold text-slate-900">{seg.from} → {seg.to}</span>
                <span className="text-xs text-slate-400 ml-auto">{formatDuration(seg.durationMin)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {MEAL_OPTS.map((opt) => {
                  const sel = (prefs[seg.key] ?? 'standard') === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => onSet(seg.key, opt.key)}
                      className={cn(
                        'p-3 rounded-xl border text-left transition-all',
                        sel
                          ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/40'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      )}
                    >
                      <p className={cn('text-sm font-semibold mb-0.5', sel ? 'text-[#1ABC9C]' : 'text-slate-900')}>{opt.label}</p>
                      <p className="text-[11px] text-slate-500">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onNext} className={CTA_CLS}>
        Continue to Add-ons <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Step 3: Extras ───────────────────────────────────────────────────────────

function ExtrasStep({ base, currency, extraBags, protection, protectionFee, onSetBags, onToggle, onNext }: {
  base: number; currency: string; extraBags: number;
  protection: boolean; protectionFee: number;
  onSetBags: (n: number) => void; onToggle: () => void; onNext: () => void;
}) {
  return (
    <>
      <div className={cn(CARD_CLS, 'space-y-5')}>
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">Add-ons</h2>
          <p className="text-sm text-slate-500">Customize your journey with extras.</p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-3">
            <Luggage className="w-5 h-5 text-slate-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">Extra Checked Bags</p>
              <p className="text-xs text-slate-500 mt-0.5">$35 per bag · 23 kg (50 lbs) max each</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onSetBags(Math.max(0, extraBags - 1))}
                disabled={extraBags === 0}
                className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-30"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-4 text-center text-sm font-bold text-slate-900">{extraBags}</span>
              <button
                onClick={() => onSetBags(Math.min(2, extraBags + 1))}
                disabled={extraBags === 2}
                className="w-7 h-7 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-all disabled:opacity-30"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>
          {extraBags > 0 && (
            <p className="text-xs text-emerald-600 mt-2 ml-8">
              +{formatPrice(extraBags * 35, currency)} for {extraBags} extra bag{extraBags > 1 ? 's' : ''}
            </p>
          )}
        </div>

        <div
          className={cn(
            'p-4 rounded-2xl border cursor-pointer transition-all',
            protection ? 'bg-[#1ABC9C]/5 border-[#1ABC9C]/30' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
          )}
          onClick={onToggle}
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className={cn('w-5 h-5 mt-0.5 shrink-0', protection ? 'text-[#1ABC9C]' : 'text-slate-400')} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-slate-900">Price Drop Protection</p>
                <Sparkles className={cn('w-3.5 h-3.5', protection ? 'text-[#1ABC9C]' : 'text-slate-400')} />
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                FareMind monitors this flight&apos;s price after booking. If it drops, you receive credit toward a future booking.
              </p>
              <p className={cn('text-xs font-semibold mt-2', protection ? 'text-[#1ABC9C]' : 'text-slate-500')}>
                +{formatPrice(protectionFee > 0 ? protectionFee : Math.min(Math.max(Math.round(base * 0.06), 49), 399), currency)} · One-time fee
              </p>
            </div>
            <div className={cn(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 mt-0.5',
              protection ? 'bg-[#1ABC9C]' : 'bg-slate-200'
            )}>
              <span className={cn(
                'inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform',
                protection ? 'translate-x-6' : 'translate-x-1'
              )} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>Add-on fees are non-refundable once the booking is confirmed.</span>
        </div>
      </div>
      <button onClick={onNext} className={CTA_CLS}>
        Continue to Passenger Details <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Step 4: Passengers ───────────────────────────────────────────────────────

function PassengerStep({ pax, isValid, onChange, onNext }: {
  pax: PassengerData; isValid: boolean;
  onChange: (p: Partial<PassengerData>) => void; onNext: () => void;
}) {
  return (
    <>
      <div className={CARD_CLS}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Passenger Details</h2>
        <p className="text-sm text-slate-500 mb-5">Enter details exactly as they appear on the travel document.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {([
            { key: 'firstName',   label: 'First Name',    type: 'text',  ph: 'John',             req: true },
            { key: 'lastName',    label: 'Last Name',     type: 'text',  ph: 'Doe',              req: true },
            { key: 'email',       label: 'Email',         type: 'email', ph: 'john@example.com', req: true, span: true },
            { key: 'phone',       label: 'Phone',         type: 'tel',   ph: '+1 555 0123' },
            { key: 'dateOfBirth', label: 'Date of Birth', type: 'date',  ph: '',                 req: true },
          ] as const).map((f) => (
            <div key={f.key} className={'span' in f && f.span ? 'sm:col-span-2' : ''}>
              <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">
                {f.label} {'req' in f && f.req && <span className="text-red-400">*</span>}
              </label>
              <input
                type={f.type}
                placeholder={f.ph}
                value={pax[f.key as keyof PassengerData]}
                onChange={(e) => onChange({ [f.key]: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
          ))}
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Gender</label>
            <select
              value={pax.gender}
              onChange={(e) => onChange({ gender: e.target.value as PassengerData['gender'] })}
              className={INPUT_CLS}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div className="pt-5 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Travel Documents (International Flights)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {([
              { key: 'passportNumber', label: 'Passport Number', type: 'text', ph: 'A12345678' },
              { key: 'passportExpiry', label: 'Passport Expiry',  type: 'date', ph: '' },
              { key: 'nationality',   label: 'Nationality',      type: 'text', ph: 'United States', span: true },
            ] as const).map((f) => (
              <div key={f.key} className={'span' in f && f.span ? 'sm:col-span-2' : ''}>
                <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">{f.label}</label>
                <input
                  type={f.type}
                  placeholder={f.ph}
                  value={pax[f.key as keyof PassengerData]}
                  onChange={(e) => onChange({ [f.key]: e.target.value })}
                  className={INPUT_CLS}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      <button onClick={onNext} disabled={!isValid} className={CTA_CLS}>
        Review Booking <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────

const SEAT_LBL: Record<SeatPref, string> = { window: 'Window', aisle: 'Aisle', middle: 'Middle', no_preference: 'No preference' };
const MEAL_LBL: Record<MealPref, string> = { standard: 'Standard', vegetarian: 'Vegetarian', vegan: 'Vegan', halal: 'Halal', kosher: 'Kosher', none: 'No meal' };

function ReviewStep({
  segs, fareName, cabin, seatPrefs, mealPrefs, extraBags, protection, pax, pricing, currency, onNext,
}: {
  segs: DisplaySegment[]; fareName: string; cabin: string;
  seatPrefs: Record<string, SeatPref>; mealPrefs: Record<string, MealPref>;
  extraBags: number; protection: boolean; pax: PassengerData;
  pricing: ReturnType<typeof computeBookingPricing>; currency: string;
  onNext: () => void;
}) {
  return (
    <>
      <div className={cn(CARD_CLS, 'space-y-5')}>
        <h2 className="text-lg font-bold text-slate-900">Review Your Booking</h2>

        <Section title="Flight">
          {segs.map((seg) => (
            <div key={seg.key} className="flex items-center gap-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase w-14 shrink-0">{seg.label}</span>
              <span className="text-sm font-semibold text-slate-900">{seg.from} → {seg.to}</span>
              {seg.depTime && <span className="text-xs text-slate-500">{formatTime(seg.depTime)}</span>}
              <span className="text-xs text-slate-400 ml-auto">{formatDuration(seg.durationMin)}</span>
            </div>
          ))}
        </Section>

        <Section title="Fare & Preferences">
          <ReviewRow label="Fare" value={`${fareName} · ${cabin.replace(/_/g, ' ')}`} />
          {segs.map((seg) => (
            <ReviewRow key={`seat_${seg.key}`} label={`Seat · ${seg.label}`} value={SEAT_LBL[seatPrefs[seg.key] ?? 'no_preference']} />
          ))}
          {segs.map((seg) => (
            <ReviewRow key={`meal_${seg.key}`} label={`Meal · ${seg.label}`} value={MEAL_LBL[mealPrefs[seg.key] ?? 'standard']} />
          ))}
          {extraBags > 0 && (
            <ReviewRow label="Extra bags" value={`${extraBags} bag${extraBags > 1 ? 's' : ''} · +${formatPrice(pricing.baggageFee, currency)}`} />
          )}
          {protection && (
            <ReviewRow label="Price drop protection" value={`+${formatPrice(pricing.protectionFee, currency)}`} accent />
          )}
        </Section>

        <Section title="Passenger">
          <ReviewRow label="Name"  value={`${pax.firstName} ${pax.lastName}`} />
          <ReviewRow label="Email" value={pax.email} />
          {pax.passportNumber && <ReviewRow label="Passport" value={pax.passportNumber} />}
        </Section>

        <Section title="Price Breakdown">
          <ReviewRow label="Selected fare" value={formatPrice(pricing.fareBase, currency)} />
          {pricing.baggageFee > 0   && <ReviewRow label="Extra bags"       value={`+${formatPrice(pricing.baggageFee, currency)}`} />}
          {pricing.protectionFee > 0 && <ReviewRow label="Price protection" value={`+${formatPrice(pricing.protectionFee, currency)}`} accent />}
          <div className="border-t border-slate-100 pt-3 mt-1 flex justify-between items-center">
            <span className="text-sm font-bold text-slate-900">Total</span>
            <span className="text-[20px] font-black text-[#F97316] leading-none">{formatPrice(pricing.total, currency)}</span>
          </div>
        </Section>
      </div>
      <button onClick={onNext} className={CTA_CLS}>
        Proceed to Payment <ChevronRight className="w-4 h-4" />
      </button>
    </>
  );
}

// ─── Step 6: Payment ──────────────────────────────────────────────────────────

function PaymentStep({ card, setCard, total, currency, processing, bookingError, onBook }: {
  card: { number: string; expiry: string; cvc: string; name: string };
  setCard: React.Dispatch<React.SetStateAction<{ number: string; expiry: string; cvc: string; name: string }>>;
  total: number; currency: string; processing: boolean;
  bookingError: string | null; onBook: () => void;
}) {
  const isValid = card.name && card.number.replace(/\s/g, '').length === 16 && card.expiry.length === 5 && card.cvc.length >= 3;

  return (
    <>
      <div className={CARD_CLS}>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Payment Details</h2>
        <p className="text-sm text-slate-500 mb-5">Securely processed in test mode via Duffel.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Card Number</label>
            <input
              type="text" placeholder="1234 5678 9012 3456" value={card.number}
              onChange={(e) => setCard((p) => ({ ...p, number: fmtCardNum(e.target.value) }))}
              maxLength={19} className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Name on Card</label>
            <input
              type="text" placeholder="John Doe" value={card.name}
              onChange={(e) => setCard((p) => ({ ...p, name: e.target.value }))}
              className={INPUT_CLS}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">Expiry</label>
              <input
                type="text" placeholder="MM/YY" value={card.expiry}
                onChange={(e) => setCard((p) => ({ ...p, expiry: fmtExpiry(e.target.value) }))}
                maxLength={5} className={INPUT_CLS}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">CVC</label>
              <input
                type="text" placeholder="123" value={card.cvc}
                onChange={(e) => setCard((p) => ({ ...p, cvc: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                maxLength={4} className={INPUT_CLS}
              />
            </div>
          </div>
        </div>

        {bookingError && (
          <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <p className="text-sm text-red-500 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {bookingError}
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mt-4 text-xs text-slate-400">
          <Lock className="w-3.5 h-3.5" />
          <span>Secured by Stripe · Duffel NDC direct (test mode)</span>
        </div>
      </div>
      <button onClick={onBook} disabled={processing || !isValid} className={CTA_CLS}>
        {processing ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
        ) : (
          <><Shield className="w-4 h-4" /> Confirm &amp; Pay {formatPrice(total, currency)}</>
        )}
      </button>
    </>
  );
}

// ─── Step 7: Confirmed ────────────────────────────────────────────────────────

function ConfirmStep({ result, protection, routeLabel, total, currency }: {
  result: BookingResult | null; protection: boolean;
  routeLabel: string; total: number; currency: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className="max-w-xl mx-auto"
    >
      <div className={cn(CARD_CLS, 'p-8 text-center')}>
        <div className="w-20 h-20 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-6">
          <Check className="w-10 h-10 text-emerald-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re all booked!</h2>
        <p className="text-sm text-slate-500 mb-6">
          Your flight is confirmed. Check your email for the booking details.
        </p>

        <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 mb-6 text-left">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-slate-400 uppercase tracking-wider">Booking Reference (PNR)</span>
            <span className="text-sm font-mono font-bold text-[#1ABC9C]">{result?.pnr ?? 'N/A'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-900">{routeLabel}</span>
            <span className="text-sm font-bold text-[#F97316]">{formatPrice(total, currency)}</span>
          </div>
        </div>

        {(result?.priceTracking || protection) && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1ABC9C]/5 border border-[#1ABC9C]/20 mb-6">
            <Sparkles className="w-5 h-5 text-[#1ABC9C] shrink-0" />
            <p className="text-xs text-slate-500 text-left">
              <span className="text-[#1ABC9C] font-medium">Price Drop Protection is active. </span>
              FareMind will monitor this flight and credit you if the price drops.
            </p>
          </div>
        )}

        <div className="flex gap-3 justify-center flex-wrap">
          <Link
            href="/account"
            className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold text-white bg-[#1ABC9C] hover:bg-emerald-500 shadow-lg shadow-[#1ABC9C]/25 transition-all"
          >
            View Dashboard
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
          >
            Search More Flights
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Order summary sidebar ────────────────────────────────────────────────────

function OrderSummary({ routeLabel, airlineName, fareName, extraBags, protection, pricing, currency }: {
  routeLabel: string; airlineName: string; fareName: string;
  extraBags: number; protection: boolean;
  pricing: ReturnType<typeof computeBookingPricing>; currency: string;
}) {
  return (
    <div className={cn(CARD_CLS, 'sticky top-32')}>
      <h3 className="text-sm font-bold text-slate-900 mb-4">Order Summary</h3>
      <div className="mb-4 pb-4 border-b border-slate-100">
        <p className="text-base font-semibold text-slate-900">{routeLabel}</p>
        {airlineName && <p className="text-xs text-slate-400 mt-0.5">{airlineName}</p>}
        {fareName && <p className="text-xs text-[#1ABC9C] font-medium mt-1">{fareName}</p>}
      </div>
      <div className="space-y-2.5 pb-4 border-b border-slate-100 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Base fare</span>
          <span className="text-slate-900">{formatPrice(pricing.fareBase, currency)}</span>
        </div>
        {extraBags > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500">Extra bags ({extraBags})</span>
            <span className="text-slate-900">+{formatPrice(pricing.baggageFee, currency)}</span>
          </div>
        )}
        {protection && pricing.protectionFee > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-500">Price protection</span>
            <span className="text-[#1ABC9C]">+{formatPrice(pricing.protectionFee, currency)}</span>
          </div>
        )}
      </div>
      <div className="flex justify-between items-center pt-4">
        <span className="text-sm font-semibold text-slate-900">Total</span>
        <span className="text-[20px] font-bold text-[#F97316] leading-none">{formatPrice(pricing.total, currency)}</span>
      </div>
      <div className="mt-4 flex items-center gap-1.5 text-[10px] text-slate-400">
        <Shield className="w-3 h-3" />
        <span>Price guaranteed at time of booking</span>
      </div>
    </div>
  );
}

// ─── Main booking content ─────────────────────────────────────────────────────

function BookingContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const store        = useBookingStore();
  const fareStore    = useFareStore();
  const isRoundTrip  = searchParams.get('trip') === 'round_trip';

  useEffect(() => {
    const { reset, setFlight, setRoundTrip } = useBookingStore.getState();
    reset();
    try {
      if (isRoundTrip) {
        const stored = sessionStorage.getItem('selectedRoundTrip');
        if (stored) setRoundTrip(JSON.parse(stored));
      } else {
        const stored = sessionStorage.getItem('selectedFlight') ?? localStorage.getItem('selectedFlight');
        if (stored) setFlight(JSON.parse(stored));
      }
    } catch { /* ignore parse errors */ }

    // Sync protection toggle from fare selection modal
    const fareState = useFareStore.getState();
    if (fareState.selectedFare?.priceProtection) {
      const bs = useBookingStore.getState();
      if (!bs.priceDropProtection) bs.togglePriceDropProtection();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundTrip]);

  const {
    flight, roundTrip, step,
    seatPrefs, mealPrefs, extraBags, priceDropProtection,
    passenger, processing, bookingResult, bookingError,
  } = store;

  const selectedFare = fareStore.selectedFare;
  const [cardData, setCardData] = useState({ number: '', expiry: '', cvc: '', name: '' });

  const fallbackBase = roundTrip?.totalPrice ?? flight?.totalPrice ?? 0;
  const base         = selectedFare?.totalPrice ?? fallbackBase;
  const currency     = selectedFare?.currency ?? roundTrip?.currency ?? flight?.currency ?? 'USD';
  const displaySegs  = getDisplaySegments(flight, roundTrip);
  const pricing      = computeBookingPricing(selectedFare, fallbackBase, extraBags, priceDropProtection);

  // Look up full FareOption from fare store payload (for feature checklist)
  const fareOption: FareOption | null = (() => {
    const p = fareStore.payload;
    if (!p || !selectedFare) return null;
    for (const group of p.fareGroups) {
      const found = group.fares.find(f => f.id === selectedFare.fareId);
      if (found) return found;
    }
    return null;
  })();

  const routeLabel = (() => {
    if (roundTrip) return `${roundTrip.outboundJourney.departureAirport} ⇄ ${roundTrip.outboundJourney.arrivalAirport}`;
    if (flight) {
      const first = flight.segments[0];
      const last  = flight.segments[flight.segments.length - 1];
      return `${first.departure.airport} → ${last.arrival.airport}`;
    }
    return selectedFare ? `${selectedFare.cabin.replace(/_/g, ' ')} flight` : '';
  })();

  const airlineName        = roundTrip ? (roundTrip.airlines[0] ?? '') : (flight?.airline.name ?? '');
  const isPassengerValid   = !!(passenger.firstName && passenger.lastName && passenger.email && passenger.dateOfBirth);

  const handleBooking = async () => {
    store.setProcessing(true);
    store.setBookingError(null);
    try {
      const flightPayload = roundTrip
        ? roundTripToFlightPayload(roundTrip, pricing.total)
        : { ...flight!, totalPrice: pricing.total };

      const res = await fetch(apiUrl('/api/book'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider:        roundTrip?.provider ?? flight!.provider,
          providerOfferId: roundTrip?.providerOfferId ?? flight!.providerOfferId,
          flight: flightPayload,
          enablePriceTracking: priceDropProtection,
          userId: 'demo-user',
          passengers: [{
            firstName:      passenger.firstName,
            lastName:       passenger.lastName,
            email:          passenger.email,
            phone:          passenger.phone || '+10000000000',
            dateOfBirth:    passenger.dateOfBirth,
            gender:         passenger.gender,
            type:           'adult',
          }],
        }),
      });

      const data = await res.json();

      if (data.success) {
        store.setBookingResult({ pnr: data.booking.pnr, id: data.booking.id, priceTracking: data.booking.priceTracking });
        store.setStep(7);
      } else {
        store.setBookingError(data.error ?? 'Booking failed. Please try again.');
      }
    } catch {
      store.setBookingError('Network error. Please check your connection.');
    } finally {
      store.setProcessing(false);
    }
  };

  if (!flight && !roundTrip && !selectedFare) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-amber-400" />
        </div>
        <p className="text-lg font-semibold text-slate-900">No flight selected</p>
        <p className="text-sm text-slate-500">Return to search and select a flight to continue.</p>
        <Link href="/" className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold text-white bg-[#1ABC9C] hover:bg-emerald-500 shadow-lg shadow-[#1ABC9C]/25 transition-all">
          Search Flights
        </Link>
      </div>
    );
  }

  const isConfirm = step === 7;

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      {/* ── Header ── */}
      <div className="border-b border-white/[0.06] bg-surface-800/50 sticky top-0 z-20 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3 mb-3">
            {!isConfirm && (
              <button
                onClick={() => (step > 0 ? store.setStep(step - 1) : router.back())}
                className="text-slate-400 hover:text-white transition-colors p-1"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4 text-[#1ABC9C]" />
              <h1 className="text-base font-bold text-white">
                {isConfirm ? 'Booking Confirmed' : 'Book Your Flight'}
              </h1>
            </div>
            {!isConfirm && (
              <span className="ml-auto text-xs text-slate-500">
                Step {step + 1} / {STEPS.length - 1}
              </span>
            )}
          </div>

          {!isConfirm && (
            <>
              <div className="w-full h-1 rounded-full bg-white/[0.06] mb-3">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#1ABC9C] to-emerald-400 transition-all duration-500"
                  style={{ width: `${((step + 1) / (STEPS.length - 1)) * 100}%` }}
                />
              </div>
              <div className="hidden md:flex items-center gap-1">
                {STEPS.slice(0, -1).map((s, i) => {
                  const Icon     = s.icon;
                  const isActive = i === step;
                  const isDone   = i < step;
                  return (
                    <div
                      key={s.key}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all',
                        isActive ? 'bg-[#1ABC9C]/15 text-[#1ABC9C]' :
                        isDone   ? 'text-emerald-400' : 'text-slate-600'
                      )}
                    >
                      {isDone ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                      {s.label}
                    </div>
                  );
                })}
              </div>
              <p className="md:hidden text-sm font-medium text-[#1ABC9C]">{STEPS[step].label}</p>
            </>
          )}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isConfirm ? (
          <ConfirmStep
            result={bookingResult}
            protection={priceDropProtection}
            routeLabel={routeLabel}
            total={pricing.total}
            currency={currency}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <motion.div key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                {step === 0 && (
                  <ItineraryReviewStep
                    segs={displaySegs}
                    selectedFare={selectedFare}
                    fareOption={fareOption}
                    pricing={pricing}
                    currency={currency}
                    onNext={() => store.setStep(1)}
                  />
                )}
                {step === 1 && (
                  <SeatStep segs={displaySegs} prefs={seatPrefs} onSet={store.setSeatPref} onNext={() => store.setStep(2)} />
                )}
                {step === 2 && (
                  <MealStep segs={displaySegs} prefs={mealPrefs} onSet={store.setMealPref} onNext={() => store.setStep(3)} />
                )}
                {step === 3 && (
                  <ExtrasStep
                    base={base} currency={currency}
                    extraBags={extraBags} protection={priceDropProtection}
                    protectionFee={selectedFare?.protectionFee ?? 0}
                    onSetBags={store.setExtraBags} onToggle={store.togglePriceDropProtection} onNext={() => store.setStep(4)}
                  />
                )}
                {step === 4 && (
                  <PassengerStep pax={passenger} isValid={isPassengerValid} onChange={store.updatePassenger} onNext={() => store.setStep(5)} />
                )}
                {step === 5 && (
                  <ReviewStep
                    segs={displaySegs}
                    fareName={selectedFare?.name ?? 'Selected Fare'}
                    cabin={selectedFare?.cabin ?? 'economy'}
                    seatPrefs={seatPrefs} mealPrefs={mealPrefs}
                    extraBags={extraBags} protection={priceDropProtection}
                    pax={passenger} pricing={pricing} currency={currency}
                    onNext={() => store.setStep(6)}
                  />
                )}
                {step === 6 && (
                  <PaymentStep
                    card={cardData} setCard={setCardData}
                    total={pricing.total} currency={currency}
                    processing={processing} bookingError={bookingError}
                    onBook={handleBooking}
                  />
                )}
              </motion.div>
            </div>

            <div className="lg:col-span-1">
              <OrderSummary
                routeLabel={routeLabel} airlineName={airlineName}
                fareName={selectedFare?.name ?? ''}
                extraBags={extraBags} protection={priceDropProtection}
                pricing={pricing} currency={currency}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function BookingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#1ABC9C] animate-spin" />
      </div>
    }>
      <BookingContent />
    </Suspense>
  );
}
