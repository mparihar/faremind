// FILE: src/app/checkout/addons/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Luggage,
  Minus,
  Plus,
  Shield,
  ShieldCheck,
  AlertTriangle,
  Check,
  ChevronRight,
  Info,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { cn } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import { apiFetch } from '@/lib/api-client';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_INDEX = 4; // "Add-ons" is step index 4 (0-based), displayed as "Step 5 of 7"
const EXTRA_BAG_PRICE = 35;
const MAX_EXTRA_BAGS = 3;

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);



// ─── Extra Bags Stepper ───────────────────────────────────────────────────────

function ExtraBagsSection({
  includedBags,
  extraBags,
  onSet,
}: {
  includedBags: number;
  extraBags: number;
  onSet: (n: number) => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Luggage className="w-5 h-5 text-slate-500" />
        <h2 className="text-base font-bold text-slate-900">Extra Checked Bags</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        {includedBags > 0
          ? `${includedBags} bag${includedBags > 1 ? 's' : ''} included with your fare.`
          : 'No checked bags included with your fare.'}
        {' '}Additional bags are {fmt(EXTRA_BAG_PRICE)} each.
      </p>

      {/* Included bags display */}
      {includedBags > 0 && (
        <div className="flex gap-2 mb-4">
          {Array.from({ length: includedBags }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700"
            >
              <Check className="w-3 h-3" strokeWidth={2.5} />
              Included
            </div>
          ))}
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
        <div>
          <p className="text-sm font-semibold text-slate-900">Extra bags</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {fmt(EXTRA_BAG_PRICE)} per bag · 23 kg (50 lbs) max
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSet(Math.max(0, extraBags - 1))}
            disabled={extraBags === 0}
            className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
            aria-label="Remove bag"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="w-6 text-center text-base font-bold text-slate-900">{extraBags}</span>
          <button
            onClick={() => onSet(Math.min(MAX_EXTRA_BAGS, extraBags + 1))}
            disabled={extraBags === MAX_EXTRA_BAGS}
            className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm"
            aria-label="Add bag"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {extraBags > 0 && (
        <p className="text-sm text-[#1ABC9C] font-semibold mt-3">
          +{fmt(extraBags * EXTRA_BAG_PRICE)} for {extraBags} extra bag{extraBags > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}

// ─── Price Drop Protection ────────────────────────────────────────────────────

function PriceDropProtectionSection({
  enabled,
  fee,
  onToggle,
}: {
  enabled: boolean;
  fee: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full text-left rounded-2xl border p-6 transition-all cursor-pointer',
        enabled
          ? 'bg-[#1ABC9C]/5 border-[#1ABC9C]/40 shadow-md shadow-[#1ABC9C]/10'
          : 'bg-white border-slate-200 shadow-sm hover:border-slate-300 hover:shadow-md'
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
            enabled ? 'bg-[#1ABC9C] text-white' : 'bg-slate-100 text-slate-400'
          )}
        >
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="text-base font-bold text-slate-900">Price Drop Protection</h2>
            <div
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0',
                enabled ? 'bg-[#1ABC9C]' : 'bg-slate-200'
              )}
            >
              <span
                className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform',
                  enabled ? 'translate-x-6' : 'translate-x-1'
                )}
              />
            </div>
          </div>
          <p className="text-sm text-slate-500 leading-relaxed mb-3">
            If the price drops after booking, we&apos;ll refund 80% of the difference as FareMind credit.
            Peace of mind for your next adventure.
          </p>
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-[#1ABC9C]" />
            <span
              className={cn(
                'text-sm font-semibold',
                enabled ? 'text-[#1ABC9C]' : 'text-slate-500'
              )}
            >
              {fmt(fee)} · One-time fee
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Travel Insurance ─────────────────────────────────────────────────────────

function TravelInsuranceSection({
  enabled,
  fee,
  onToggle,
}: {
  enabled: boolean;
  fee: number;
  onToggle: () => void;
}) {
  interface InsuranceOption {
    id: 'with' | 'without';
    label: string;
    badge: string | null;
    desc: string;
    price: number;
    icon: React.ReactNode;
    warning?: boolean;
  }

  const options: InsuranceOption[] = [
    {
      id: 'with',
      label: 'Protection Plan',
      badge: 'Recommended',
      desc: 'Trip cancellation, medical emergencies, lost baggage, and 24/7 travel assistance.',
      price: fee,
      icon: <ShieldCheck className="w-5 h-5" />,
    },
    {
      id: 'without',
      label: 'No Protection',
      badge: null,
      desc: 'You will not be covered for trip interruptions, medical emergencies, or baggage loss.',
      price: 0,
      icon: <AlertTriangle className="w-5 h-5" />,
      warning: true,
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-5 h-5 text-slate-500" />
        <h2 className="text-base font-bold text-slate-900">Travel Insurance</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Protect your trip against the unexpected.
      </p>

      <div className="space-y-3">
        {options.map((opt) => {
          const isSelected = opt.id === 'with' ? enabled : !enabled;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={onToggle}
              className={cn(
                'w-full text-left p-4 rounded-xl border-2 transition-all',
                isSelected
                  ? 'border-[#1ABC9C] bg-[#1ABC9C]/5 shadow-sm shadow-[#1ABC9C]/10'
                  : opt.warning
                  ? 'border-slate-200 bg-white hover:border-slate-300'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                    isSelected
                      ? 'bg-[#1ABC9C] text-white'
                      : opt.warning
                      ? 'bg-amber-50 text-amber-500'
                      : 'bg-slate-100 text-slate-400'
                  )}
                >
                  {opt.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-bold text-slate-900">{opt.label}</span>
                    {opt.badge && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#F97316]/10 text-[#F97316] uppercase tracking-wide">
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{opt.desc}</p>
                  {opt.warning && !isSelected && (
                    <p className="text-xs text-amber-600 font-medium mt-1.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Traveling without protection is at your own risk
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  {opt.price > 0 ? (
                    <>
                      <p className="text-sm font-bold text-[#F97316]">+{fmt(opt.price)}</p>
                      <p className="text-[10px] text-slate-400">per booking</p>
                    </>
                  ) : (
                    <p className="text-sm font-bold text-slate-400">Free</p>
                  )}
                </div>
              </div>
              {isSelected && (
                <div className="mt-2 flex justify-end">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#1ABC9C]">
                    <Check className="w-3 h-3" strokeWidth={3} />
                    Selected
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Price Summary ────────────────────────────────────────────────────────────

function PriceSummary({
  extraBags,
  protection,
  insurance,
  pricing,
}: {
  extraBags: number;
  protection: boolean;
  insurance: boolean;
  pricing: ReturnType<typeof buildLocalPricing>;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
        <span className="font-medium uppercase tracking-wider">Price Summary</span>
        <span className="text-slate-300">Add-ons included</span>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Base fare</span>
          <span>{fmt(pricing.perPassenger.reduce((s, p) => s + p.subtotal, 0))}</span>
        </div>
        {extraBags > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Extra bags ({extraBags})</span>
            <span>+{fmt(pricing.baggageFees)}</span>
          </div>
        )}
        {protection && pricing.protectionFee > 0 && (
          <div className="flex justify-between text-[#1ABC9C]">
            <span>Price protection</span>
            <span>+{fmt(pricing.protectionFee)}</span>
          </div>
        )}
        {insurance && pricing.insuranceFee > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Travel insurance</span>
            <span>+{fmt(pricing.insuranceFee)}</span>
          </div>
        )}
        <div className="flex justify-between text-slate-600">
          <span>Service fee</span>
          <span>+{fmt(pricing.serviceFee)}</span>
        </div>
      </div>
      <div className="border-t border-slate-100 mt-3 pt-3 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-900">Your total</span>
        <span className="text-xl font-black text-[#F97316] leading-none">{fmt(pricing.total)}</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AddonsPage() {
  const router = useRouter();
  const store = useCheckoutStore();
  const [submitting, setSubmitting] = useState(false);

  const {
    fareOption,
    selectedFare,
    sessionId,
    extraBags,
    priceProtection,
    travelInsurance,
    passengers,
    seatSelections,
    currency,
  } = store;

  useEffect(() => {
    if (!selectedFare || !sessionId) router.replace('/');
  }, [selectedFare, sessionId, router]);

  if (!selectedFare || !sessionId) return null;

  const includedBags = fareOption?.baggage.checked ?? 0;
  const protectionFee =
    selectedFare?.protectionFee && selectedFare.protectionFee > 0
      ? selectedFare.protectionFee
      : Math.min(
          Math.max(Math.round((selectedFare?.basePrice ?? 0) * 0.06), 49),
          399
        );

  const pricing = buildLocalPricing({
    ...store,
    passengers,
    extraBags,
    priceProtection,
    travelInsurance,
    seatSelections,
    currency: currency ?? 'USD',
  } as Parameters<typeof buildLocalPricing>[0]);

  const handleContinue = async () => {
    if (!sessionId) { router.replace('/'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/api/checkout/protection/select', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          priceProtection,
          travelInsurance,
          extraBags,
          protectionFee: priceProtection ? protectionFee : 0,
          insuranceFee: travelInsurance ? pricing.insuranceFee : 0,
        }),
      }).catch(() => {
        // Non-blocking — continue regardless
      });
    } finally {
      setSubmitting(false);
      router.push('/checkout/review');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <CheckoutHeader stepIndex={STEP_INDEX} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: add-on cards */}
          <div className="lg:col-span-2 space-y-5">
            <ExtraBagsSection
              includedBags={includedBags}
              extraBags={extraBags}
              onSet={store.setExtraBags}
            />

            <PriceDropProtectionSection
              enabled={priceProtection}
              fee={protectionFee}
              onToggle={store.toggleProtection}
            />

            <TravelInsuranceSection
              enabled={travelInsurance}
              fee={pricing.insuranceFee > 0 ? pricing.insuranceFee : Math.round((selectedFare?.basePrice ?? 0) * passengers.length * 0.04)}
              onToggle={store.toggleInsurance}
            />

            <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Add-on fees are non-refundable once the booking is confirmed.</span>
            </div>

            <button
              onClick={handleContinue}
              disabled={submitting}
              className="w-full py-4 rounded-2xl bg-[#1ABC9C] hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-[#1ABC9C]/25 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Continue to Review
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Right: sticky price summary */}
          <div className="lg:col-span-1">
            <div className="sticky top-36 space-y-4">
              <PriceSummary
                extraBags={extraBags}
                protection={priceProtection}
                insurance={travelInsurance}
                pricing={pricing}
              />

              {priceProtection && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-[#1ABC9C]/5 border border-[#1ABC9C]/20">
                  <ShieldCheck className="w-4 h-4 text-[#1ABC9C] mt-0.5 shrink-0" />
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold text-[#1ABC9C]">Price protection active. </span>
                    We&apos;ll monitor this route and refund 80% of any price drop as FareMind credit.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
