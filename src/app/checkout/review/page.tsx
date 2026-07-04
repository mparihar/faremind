// FILE: src/app/checkout/review/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  X,
  Plane,
  User,
  ChevronRight,
  Shield,
  Luggage,
  Accessibility,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { useOfferGuard } from '@/hooks/useOfferGuard';
import { cn, formatTime, formatDuration } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import { isPremiumService } from '@/lib/providers/providerAncillaryNormalizer';
import type { NormalizedAncillary } from '@/lib/providers/providerAncillaryNormalizer';
import { apiFetch } from '@/lib/api-client';
import { useFeeLoader } from '@/hooks/useFeeLoader';
import { useBuildPricingConfig } from '@/hooks/usePricingConfig';
import { isBundleEnabled } from '@/lib/bundle-flags';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_INDEX = 5;

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);

const SEAT_LABEL: Record<string, string> = {
  window: 'Window',
  aisle: 'Aisle',
  middle: 'Middle',
  no_preference: 'No preference',
};

const MEAL_LABEL: Record<string, string> = {
  standard: 'Standard',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  halal: 'Halal',
  kosher: 'Kosher',
  child: 'Child',
  diabetic: 'Diabetic',
  gluten_free: 'Gluten-free',
  none: 'No meal',
  // SSR codes (from AI bot flow)
  STANDARD: 'Standard',
  VGML: 'Vegetarian',
  AVML: 'Asian Vegetarian',
  NLML: 'Vegan',
  MOML: 'Halal',
  KSML: 'Kosher',
  HNML: 'Hindu',
  DBML: 'Diabetic',
  GFML: 'Gluten-Free',
  NONE: 'No meal',
};



// ─── Section wrapper ──────────────────────────────────────────────────────────

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  accent,
  indent,
}: {
  label: string;
  value: string;
  accent?: boolean;
  indent?: boolean;
}) {
  return (
    <div className={cn('flex justify-between text-sm gap-4', indent && 'pl-4 opacity-80')}>
      <span className={cn('text-slate-500 shrink-0', indent && 'text-xs')}>{label}</span>
      <span className={cn('font-medium text-right', accent ? 'text-[#1ABC9C]' : 'text-slate-900', indent && 'text-xs')}>
        {value}
      </span>
    </div>
  );
}

// ─── Price Breakdown card (right sidebar) ─────────────────────────────────────

function PriceBreakdownCard({
  pricing,
  acceptedTerms,
  onProceed,
  selectedAncillaries,
}: {
  pricing: ReturnType<typeof buildLocalPricing>;
  acceptedTerms: boolean;
  onProceed: () => void;
  selectedAncillaries: NormalizedAncillary[];
}) {
  const passengerTotal = pricing.fareTotal;

  return (
    <div className="sticky top-36 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <h3 className="text-sm font-bold text-slate-900">Price Breakdown</h3>

      {/* Per-passenger lines */}
      <div className="space-y-3">
        {pricing.perPassenger.map((p, i) => (
          <div key={p.passengerId} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-slate-700 font-medium">
                Traveler {i + 1} ({p.type === 'adult' ? 'Adult' : p.type === 'infant' ? 'Infant' : 'Child'})
              </span>
              <span className="font-semibold text-slate-900">{fmt(p.subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs pl-3 text-slate-400">
              <span>Flight</span>
              <span>{fmt(p.baseFare)}</span>
            </div>
            <div className="flex justify-between text-xs pl-3 text-slate-400">
              <span>Taxes &amp; fees</span>
              <span>{fmt(p.taxes)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        {pricing.baggageFees > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Extra baggage</span>
            <span className="text-slate-700">+{fmt(pricing.baggageFees)}</span>
          </div>
        )}
        {/* Premium service line items */}
        {selectedAncillaries
          .filter(a => isPremiumService(a.ancillaryType) && !a.included)
          .map(svc => (
            <div key={svc.providerServiceId} className="flex justify-between text-sm">
              <span className="text-slate-500">{svc.label}</span>
              <span className="text-slate-700">+{fmt(svc.amount * svc.quantity)}</span>
            </div>
          ))
        }
        {pricing.seatFees > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Seat fees</span>
            <span className="text-slate-700">+{fmt(pricing.seatFees)}</span>
          </div>
        )}
        {isBundleEnabled() && pricing.protectionFee > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Price protection</span>
            <span className="text-[#1ABC9C]">+{fmt(pricing.protectionFee)}</span>
          </div>
        )}
        {isBundleEnabled() && pricing.insuranceFee > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Travel insurance</span>
            <span className="text-slate-700">+{fmt(pricing.insuranceFee)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Service fee</span>
          <span className="text-slate-700">+{fmt(pricing.serviceFee)}</span>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-900">Total</span>
          <span className="text-2xl font-black text-[#F97316] leading-none">{fmt(pricing.total)}</span>
        </div>
      </div>

      <button
        onClick={onProceed}
        disabled={!acceptedTerms}
        className="w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Proceed to Payment
        <ChevronRight className="w-4 h-4" />
      </button>

      {!acceptedTerms && (
        <p className="text-xs text-center text-slate-400">Accept the terms below to continue</p>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 justify-center">
        <Shield className="w-3 h-3 text-[#1ABC9C]" />
        <span>Price locked until payment</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const router = useRouter();
  const { isExpired, OfferGuardUI } = useOfferGuard();
  const store = useCheckoutStore();
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const {
    selectedFare,
    sessionId,
    fareOption,
    sourceFlight,
    sourceRoundTrip,
    passengers,
    seatSelections,
    mealSelections,
    wheelchairSelections,
    extraBags,
    priceProtection,
    travelInsurance,
    currency,
  } = store;

  const pricingCfg = useBuildPricingConfig();
  const pricing = buildLocalPricing(store, pricingCfg);

  // Load DB-driven fees — populates computedFees in checkout store
  useFeeLoader();

  useEffect(() => {
    if (!selectedFare || !sessionId) router.replace('/');
  }, [selectedFare, sessionId, router]);

  if (!selectedFare || !sessionId) return null;

  useEffect(() => {
    // Recalculate pricing server-side (non-blocking)
    apiFetch('/api/checkout/pricing/recalculate', {
      method: 'POST',
      body: JSON.stringify({
        passengers: passengers.length,
        extraBags,
        priceProtection,
        travelInsurance,
        fareId: selectedFare?.fareId,
      }),
    })
      .then((data: unknown) => {
        if (data && typeof data === 'object' && 'pricing' in data) {
          store.setPricing((data as { pricing: Parameters<typeof store.setPricing>[0] }).pricing);
        }
      })
      .catch(() => {
        // Use local pricing if API unavailable
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Build display segments (journey-level, for flight display) ───────────────
  const displaySegs = (() => {
    if (sourceRoundTrip) {
      return [
        {
          key: 'outbound',
          label: 'Outbound',
          from: sourceRoundTrip.outboundJourney.departureAirport,
          to: sourceRoundTrip.outboundJourney.arrivalAirport,
          depTime: sourceRoundTrip.outboundJourney.departureTime,
          arrTime: sourceRoundTrip.outboundJourney.arrivalTime,
          durationMin: sourceRoundTrip.outboundJourney.durationMinutes,
          flightNumbers: sourceRoundTrip.outboundJourney.flightNumbers.join(', '),
          stops: sourceRoundTrip.outboundJourney.stops,
        },
        {
          key: 'return',
          label: 'Return',
          from: sourceRoundTrip.returnJourney.departureAirport,
          to: sourceRoundTrip.returnJourney.arrivalAirport,
          depTime: sourceRoundTrip.returnJourney.departureTime,
          arrTime: sourceRoundTrip.returnJourney.arrivalTime,
          durationMin: sourceRoundTrip.returnJourney.durationMinutes,
          flightNumbers: sourceRoundTrip.returnJourney.flightNumbers.join(', '),
          stops: sourceRoundTrip.returnJourney.stops,
        },
      ];
    }
    return (sourceFlight?.segments ?? []).map((seg, i) => ({
      key: `seg_${i}`,
      label: i === 0 ? 'Outbound' : `Segment ${i + 1}`,
      from: seg.departure.airport,
      to: seg.arrival.airport,
      depTime: seg.departure.time,
      arrTime: seg.arrival.time,
      durationMin: seg.duration,
      flightNumbers: seg.flightNumber,
      stops: 0,
    }));
  })();

  // ── Build per-flight segments (same key format as seats/meals pages) ──────────
  // Matches out_0/out_1/ret_0/ret_1/seg_0 used by seat & meal selections in store
  const seatMealSegs = (() => {
    if (sourceRoundTrip) {
      const outSegs = (sourceRoundTrip.outboundJourney as any).segments ?? [];
      const retSegs = (sourceRoundTrip.returnJourney  as any).segments ?? [];
      return [
        ...(outSegs.length > 0
          ? outSegs.map((s: any, i: number) => ({
              key: `out_${i}`,
              label: `Outbound · ${s.departure?.airport}→${s.arrival?.airport}`,
              flightNum: `${s.airline?.code ?? ''}${s.flightNumber ?? ''}`,
            }))
          : [{ key: 'out', label: 'Outbound', flightNum: sourceRoundTrip.outboundJourney.flightNumbers[0] ?? '' }]),
        ...(retSegs.length > 0
          ? retSegs.map((s: any, i: number) => ({
              key: `ret_${i}`,
              label: `Return · ${s.departure?.airport}→${s.arrival?.airport}`,
              flightNum: `${s.airline?.code ?? ''}${s.flightNumber ?? ''}`,
            }))
          : [{ key: 'ret', label: 'Return', flightNum: sourceRoundTrip.returnJourney.flightNumbers[0] ?? '' }]),
      ];
    }
    return (sourceFlight?.segments ?? []).map((seg, i) => ({
      key: `seg_${i}`,
      label: i === 0 ? 'Outbound' : `Segment ${i + 1}`,
      flightNum: `${(seg as any).airline?.code ?? ''}${seg.flightNumber ?? ''}`,
    }));
  })();

  const hasAssignedSeats = seatSelections.some(s => s.seatNumber);

  // Meal selections are stored at journey level ('out'/'ret'), not per-segment
  const mealSegs = (() => {
    if (sourceRoundTrip) {
      return [
        {
          key: 'out',
          flightNum: `${sourceRoundTrip.outboundJourney.departureAirport}→${sourceRoundTrip.outboundJourney.arrivalAirport}`,
        },
        {
          key: 'ret',
          flightNum: `${sourceRoundTrip.returnJourney.departureAirport}→${sourceRoundTrip.returnJourney.arrivalAirport}`,
        },
      ];
    }
    return (sourceFlight?.segments ?? []).map((seg, i) => ({
      key: `seg_${i}`,
      flightNum: seg.flightNumber ?? `Segment ${i + 1}`,
    }));
  })();

  // ── Fare feature checklist ─────────────────────────────────────────────────
  const fareFeatures = fareOption
    ? [
        {
          ok: true,
          label: `${fareOption.baggage.carryOnPieces ?? 1}× carry-on bag`,
        },
        fareOption.baggage.checked > 0
          ? { ok: true, label: `${fareOption.baggage.checked}× checked bag included` }
          : { ok: false, label: 'No checked bags included' },
        fareOption.policy.refundable === null || fareOption.policy.refundable === undefined
          ? { ok: true, label: 'Refund: Contact airline' }
          : !fareOption.policy.refundable
          ? { ok: false, label: 'Non-refundable' }
          : fareOption.policy.refundFeeUsd === 0
          ? { ok: true, label: 'Refundable (Included)' }
          : { ok: true, label: 'Refundable (fee applies)' },
        fareOption.policy.changeable === null || fareOption.policy.changeable === undefined
          ? { ok: true, label: 'Changes: Contact airline' }
          : !fareOption.policy.changeable
          ? { ok: false, label: 'No changes allowed' }
          : fareOption.policy.changeFeeUsd === 0
          ? { ok: true, label: 'Changeable (Included)' }
          : { ok: true, label: 'Changes allowed (fee applies)' },
      ]
    : [];

  const handleProceed = () => {
    router.push('/checkout/payment');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />
      {OfferGuardUI()}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── LEFT: Review sections (2/3) ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Flights */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-5">
                <Plane className="w-4 h-4 text-[#1ABC9C]" />
                <h2 className="text-base font-bold text-slate-900">Your Flights</h2>
              </div>
              {displaySegs.length === 0 ? (
                <p className="text-sm text-slate-400">No flight details available.</p>
              ) : (
                <div className="space-y-5">
                  {displaySegs.map((seg, i) => (
                    <div key={seg.key} className={cn(i > 0 && 'pt-5 border-t border-slate-100')}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] font-bold text-[#1ABC9C] uppercase tracking-wider bg-[#1ABC9C]/10 px-2.5 py-0.5 rounded-full">
                          {seg.label}
                        </span>
                        <span className="text-xs text-slate-400">{seg.flightNumbers}</span>
                        <span className="text-xs text-slate-300 ml-auto">
                          {formatDuration(seg.durationMin)}
                          {seg.stops > 0 && ` · ${seg.stops} stop${seg.stops > 1 ? 's' : ''}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center min-w-[60px]">
                          <p className="text-xl font-black text-slate-900 leading-none">
                            {seg.depTime ? formatTime(seg.depTime) : '--'}
                          </p>
                          <p className="text-sm font-bold text-slate-700 mt-0.5">{seg.from}</p>
                        </div>
                        <div className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full flex items-center gap-1.5">
                            <div className="h-px flex-1 bg-slate-200" />
                            <Plane size={11} className="text-[#1ABC9C] rotate-90 shrink-0" />
                            <div className="h-px flex-1 bg-slate-200" />
                          </div>
                        </div>
                        <div className="text-center min-w-[60px]">
                          <p className="text-xl font-black text-slate-900 leading-none">
                            {seg.arrTime ? formatTime(seg.arrTime) : '--'}
                          </p>
                          <p className="text-sm font-bold text-slate-700 mt-0.5">{seg.to}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fare */}
            {selectedFare && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-base font-bold text-slate-900 mb-4">Your Fare</h2>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="text-base font-bold text-slate-900">{selectedFare.name}</p>
                    <span className="inline-block mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                      {selectedFare.cabin.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="text-xl font-black text-[#F97316] shrink-0">
                    {fmt(selectedFare.totalPrice)}
                    <span className="text-xs font-normal text-slate-400 block text-right">Total</span>
                  </p>
                </div>
                {fareFeatures.length > 0 && (
                  <div className="space-y-1.5">
                    {fareFeatures.map((f, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        {f.ok ? (
                          <Check size={13} className="text-emerald-500 shrink-0" strokeWidth={2.5} />
                        ) : (
                          <X size={13} className="text-slate-300 shrink-0" strokeWidth={2.5} />
                        )}
                        <span
                          className={cn(
                            'text-[13px]',
                            f.ok ? 'text-slate-700' : 'text-slate-400'
                          )}
                        >
                          {f.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Passengers */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="w-4 h-4 text-slate-400" />
                <h2 className="text-base font-bold text-slate-900">Passengers</h2>
              </div>
              <div className="space-y-4">
                {passengers.map((pax, i) => (
                  <div key={pax.id} className={cn('space-y-1', i > 0 && 'pt-4 border-t border-slate-100')}>
                    <ReviewSection title={`Passenger ${i + 1}`}>
                      <ReviewRow label="Name" value={[pax.firstName, pax.middleName, pax.lastName].filter(Boolean).join(' ') || '—'} />
                      <ReviewRow label="Type" value={pax.type.charAt(0).toUpperCase() + pax.type.slice(1)} />
                      <ReviewRow label="Gender" value={pax.gender ? pax.gender.charAt(0).toUpperCase() + pax.gender.slice(1) : '—'} />
                      <ReviewRow label="Date of Birth" value={pax.dateOfBirth || '—'} />
                      <ReviewRow label="Nationality" value={pax.nationality || '—'} />
                      {pax.isContact && pax.email && <ReviewRow label="Email" value={pax.email} />}
                      {pax.isContact && pax.phone && <ReviewRow label="Phone" value={pax.phone} />}
                      <ReviewRow label="Passport No." value={pax.passportNumber || '—'} />
                      <ReviewRow label="Passport Country" value={pax.passportCountry || '—'} />
                      <ReviewRow label="Passport Expiry" value={pax.passportExpiry || '—'} />
                    </ReviewSection>
                  </div>
                ))}
              </div>
            </div>

            {/* Seats */}
            {seatSelections.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-base font-bold text-slate-900 mb-4">
                  {hasAssignedSeats ? 'Seat Assignments' : 'Seat Preferences'}
                </h2>
                <div className="space-y-2">
                  {passengers.filter(p => p.type !== 'infant').map((pax, pi) =>
                    seatMealSegs.map((seg) => {
                      const sel = seatSelections.find(s => s.passengerId === pax.id && s.segmentKey === seg.key);
                      const seatValue = sel?.seatNumber
                        ? `Seat ${sel.seatNumber}${sel.preference !== 'no_preference' ? ` · ${SEAT_LABEL[sel.preference]}` : ''}`
                        : sel?.preference && sel.preference !== 'no_preference'
                          ? SEAT_LABEL[sel.preference]
                          : 'No preference';
                      return (
                        <ReviewRow
                          key={`${pax.id}_${seg.key}`}
                          label={`${pax.firstName || `Traveler ${pi + 1}`} · ${seg.flightNum || seg.label}`}
                          value={seatValue}
                          accent={!!sel?.seatNumber}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Wheelchair Assistance */}
            {wheelchairSelections.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Accessibility className="w-4 h-4 text-[#1ABC9C]" />
                  <h2 className="text-base font-bold text-slate-900">Wheelchair Assistance</h2>
                  <span className="text-[10px] font-bold text-[#1ABC9C] bg-[#1ABC9C]/10 px-2 py-0.5 rounded-full uppercase tracking-wider">Free</span>
                </div>
                <div className="space-y-2">
                  {wheelchairSelections.map((w) => {
                    const pax = passengers.find(p => p.id === w.passengerId);
                    const paxIdx = passengers.findIndex(p => p.id === w.passengerId);
                    const paxName = pax ? [pax.firstName, pax.lastName].filter(Boolean).join(' ') || `Traveler ${paxIdx + 1}` : 'Unknown';
                    return (
                      <ReviewRow
                        key={`${w.passengerId}_${w.segmentKey}`}
                        label={`♿ ${paxName}`}
                        value={`${w.code} — ${w.label}`}
                        accent
                      />
                    );
                  })}
                </div>
                <p className="text-[10px] text-slate-400 mt-3">
                  Wheelchair requests are communicated to the airline using IATA standard codes.
                </p>
              </div>
            )}

            {/* Meals */}
            {mealSelections.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-base font-bold text-slate-900 mb-4">Meal Preferences</h2>
                <div className="space-y-2">
                  {passengers.map((pax, pi) =>
                    mealSegs.map((seg) => {
                      const sel = mealSelections.find(m => m.passengerId === pax.id && m.segmentKey === seg.key);
                      return (
                        <ReviewRow
                          key={`${pax.id}_${seg.key}`}
                          label={`${pax.firstName || `Traveler ${pi + 1}`} · ${seg.flightNum}`}
                          value={sel ? (sel.mealLabel || MEAL_LABEL[sel.mealType] || sel.mealType) : 'Standard'}
                        />
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Add-ons */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Luggage className="w-4 h-4 text-slate-400" />
                <h2 className="text-base font-bold text-slate-900">Add-ons</h2>
              </div>
              <div className="space-y-2">
                <ReviewRow
                  label="Extra bags"
                  value={
                    extraBags > 0
                      ? `${extraBags} bag${extraBags > 1 ? 's' : ''} (+${fmt(extraBags * 35)})`
                      : 'None'
                  }
                />
                {isBundleEnabled() && (
                  <ReviewRow
                    label="Price protection"
                    value={
                      priceProtection
                        ? pricing.protectionFee > 0
                          ? `Yes (+${fmt(pricing.protectionFee)})`
                          : 'Yes'
                        : 'No'
                    }
                    accent={priceProtection}
                  />
                )}
                {isBundleEnabled() && (
                  <ReviewRow
                    label="Travel insurance"
                    value={
                      travelInsurance && pricing.insuranceFee > 0
                        ? `Yes (+${fmt(pricing.insuranceFee)})`
                        : 'No'
                    }
                  />
                )}
              </div>
            </div>

            {/* Terms */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={() => setAcceptedTerms(!acceptedTerms)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1ABC9C] focus:ring-[#1ABC9C] cursor-pointer"
                />
                <span className="text-sm text-slate-600 leading-relaxed">
                  I agree to the{' '}
                  <a href="#" className="text-[#1ABC9C] font-medium hover:underline">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="#" className="text-[#1ABC9C] font-medium hover:underline">
                    Privacy Policy
                  </a>
                  . I confirm that all passenger information is accurate and matches
                  the travel documents that will be presented at the airport.
                </span>
              </label>
            </div>

            {/* Mobile CTA */}
            <div className="lg:hidden">
              <button
                onClick={handleProceed}
                disabled={!acceptedTerms || isExpired}
                className="w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proceed to Payment
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* ── RIGHT: Price breakdown (1/3) ── */}
          <div className="hidden lg:block lg:col-span-1">
            <PriceBreakdownCard
              pricing={pricing}
              acceptedTerms={acceptedTerms}
              onProceed={handleProceed}
              selectedAncillaries={store.selectedAncillaries ?? []}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
