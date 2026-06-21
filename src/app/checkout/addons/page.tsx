// FILE: src/app/checkout/addons/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  Luggage,
  Shield,
  ShieldCheck,
  AlertTriangle,
  Check,
  ChevronRight,
  Info,
  Loader2,
  AlertCircle,
  Plus,
  X,
  Crown,
  Armchair,
  Zap,
} from 'lucide-react';
import { CheckoutHeader } from '@/components/checkout/CheckoutStepNav';
import { useOfferGuard } from '@/hooks/useOfferGuard';
import { cn } from '@/lib/utils';
import { useCheckoutStore, buildLocalPricing } from '@/store/useCheckoutStore';
import { apiFetch } from '@/lib/api-client';
import { useFeeLoader } from '@/hooks/useFeeLoader';
import { useBuildPricingConfig } from '@/hooks/usePricingConfig';
import type { NormalizedAncillary } from '@/lib/providers/providerAncillaryNormalizer';
import { isPremiumService } from '@/lib/providers/providerAncillaryNormalizer';

// ─── Constants ────────────────────────────────────────────────────────────────

const STEP_INDEX = 4;

const fmt = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);


// ─── Provider Baggage Section ─────────────────────────────────────────────────

function ProviderBaggageSection({
  includedBags,
  providerBaggage,
  selectedAncillaries,
  onAdd,
  onRemove,
  loading,
  error,
}: {
  includedBags: number;
  providerBaggage: NormalizedAncillary[];
  selectedAncillaries: NormalizedAncillary[];
  onAdd: (ancillary: NormalizedAncillary) => void;
  onRemove: (serviceId: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const includedItems = providerBaggage.filter(a => a.included);
  const purchasableItems = providerBaggage.filter(a => !a.included && a.chargeable);

  const isSelected = (serviceId: string) =>
    selectedAncillaries.some(a => a.providerServiceId === serviceId);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Luggage className="w-5 h-5 text-slate-500" />
        <h2 className="text-base font-bold text-slate-900">Baggage</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Prices are provided by the airline.
      </p>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading baggage options…</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex items-start gap-2.5 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 leading-relaxed">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-3">
          {/* Included bags from fare */}
          {(includedItems.length > 0 || includedBags > 0) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {includedItems.map((item, i) => (
                <div
                  key={`inc-${i}`}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700"
                >
                  <Check className="w-3 h-3" strokeWidth={2.5} />
                  {item.label}
                </div>
              ))}
              {/* Fallback: if no provider included items but fare says bags included */}
              {includedItems.length === 0 && includedBags > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700">
                  <Check className="w-3 h-3" strokeWidth={2.5} />
                  {includedBags} checked bag{includedBags > 1 ? 's' : ''} included
                </div>
              )}
            </div>
          )}

          {/* Purchasable bags from provider */}
          {purchasableItems.length > 0 ? (
            purchasableItems.map((item) => {
              const selected = isSelected(item.providerServiceId);
              return (
                <div
                  key={item.providerServiceId}
                  className={cn(
                    'flex items-center justify-between p-4 rounded-xl border-2 transition-all',
                    selected
                      ? 'border-[#1ABC9C] bg-[#1ABC9C]/5 shadow-sm'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  )}
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                    <span className="text-sm font-bold text-[#F97316]">
                      {item.amount === 0 ? 'Free' : fmt(item.amount)}
                    </span>
                    {selected ? (
                      <button
                        onClick={() => onRemove(item.providerServiceId)}
                        className="w-8 h-8 rounded-full bg-[#1ABC9C] text-white flex items-center justify-center hover:bg-emerald-600 transition-colors shadow-sm"
                        aria-label={`Remove ${item.label}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => onAdd(item)}
                        className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-100 transition-colors shadow-sm"
                        aria-label={`Add ${item.label}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            !loading && includedItems.length === 0 && includedBags === 0 && (
              <div className="text-center py-6 text-slate-400">
                <Luggage className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm font-medium">Checked baggage not available for online purchase</p>
                <p className="text-xs mt-1">Check airline baggage policy for options at the airport.</p>
              </div>
            )
          )}

          {/* Selected bag summary */}
          {selectedAncillaries.filter(a => a.ancillaryType === 'EXTRA_CHECKED_BAG' || a.ancillaryType === 'CHECKED_BAG').length > 0 && (
            <p className="text-sm text-[#1ABC9C] font-semibold mt-1">
              +{fmt(selectedAncillaries
                .filter(a => a.ancillaryType === 'EXTRA_CHECKED_BAG' || a.ancillaryType === 'CHECKED_BAG')
                .reduce((s, a) => s + a.amount * a.quantity, 0)
              )} for extra baggage
            </p>
          )}
        </div>
      )}
    </div>
  );
}
// ─── Premium Airport Services (Lounge Access, Priority Boarding) ──────────────

const PREMIUM_SERVICE_META: Record<string, { icon: typeof Crown; gradient: string; bg: string }> = {
  LOUNGE_ACCESS: { icon: Armchair, gradient: 'from-amber-500 to-orange-500', bg: 'bg-amber-50' },
  PRIORITY_BOARDING: { icon: Zap, gradient: 'from-violet-500 to-purple-600', bg: 'bg-violet-50' },
};

function PremiumAirportServicesSection({
  services,
  selectedAncillaries,
  onAdd,
  onRemove,
}: {
  services: NormalizedAncillary[];
  selectedAncillaries: NormalizedAncillary[];
  onAdd: (ancillary: NormalizedAncillary) => void;
  onRemove: (serviceId: string) => void;
}) {
  const isSelected = (serviceId: string) =>
    selectedAncillaries.some(a => a.providerServiceId === serviceId);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Crown className="w-5 h-5 text-amber-500" />
        <h2 className="text-base font-bold text-slate-900">Premium Airport Services</h2>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Prices are provided by the airline. Available for this itinerary only.
      </p>

      <div className="space-y-3">
        {services.map((svc) => {
          const selected = isSelected(svc.providerServiceId);
          const meta = PREMIUM_SERVICE_META[svc.ancillaryType] ?? PREMIUM_SERVICE_META.PRIORITY_BOARDING;
          const IconComponent = meta.icon;
          const isIncluded = svc.included;

          return (
            <div
              key={svc.providerServiceId}
              className={cn(
                'relative overflow-hidden rounded-xl border-2 transition-all',
                selected
                  ? 'border-[#1ABC9C] bg-[#1ABC9C]/5 shadow-sm'
                  : isIncluded
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              )}
            >
              <div className="flex items-center justify-between p-4">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    selected
                      ? `bg-gradient-to-br ${meta.gradient} text-white shadow-md`
                      : isIncluded
                      ? 'bg-emerald-100 text-emerald-600'
                      : `${meta.bg} text-slate-500`
                  )}>
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{svc.label}</p>
                    <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{svc.description}</p>
                    {svc.airportCode && (
                      <p className="text-[10px] text-slate-400 mt-1 font-medium uppercase tracking-wide">
                        at {svc.airportCode}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  {isIncluded ? (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
                      <Check className="w-3 h-3 text-emerald-600" strokeWidth={2.5} />
                      <span className="text-xs font-semibold text-emerald-700">Included</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#F97316]">{fmt(svc.amount)}</p>
                        <p className="text-[10px] text-slate-400">per traveler</p>
                      </div>
                      {selected ? (
                        <button
                          onClick={() => onRemove(svc.providerServiceId)}
                          className="w-8 h-8 rounded-full bg-[#1ABC9C] text-white flex items-center justify-center hover:bg-emerald-600 transition-colors shadow-sm"
                          aria-label={`Remove ${svc.label}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => onAdd(svc)}
                          className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-slate-100 transition-colors shadow-sm"
                          aria-label={`Add ${svc.label}`}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
            Refund 80% of any eligible fare decrease after booking, credited as FAREMIND credit.
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
      warning: true,
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
                  {opt.warning && (
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
                    <Check className="w-3 h-3" />
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
  protection,
  insurance,
  pricing,
  selectedAncillaries,
}: {
  protection: boolean;
  insurance: boolean;
  pricing: ReturnType<typeof buildLocalPricing>;
  selectedAncillaries: NormalizedAncillary[];
}) {
  // Premium service totals (not included in baggage or standard pricing)
  const premiumSelected = selectedAncillaries.filter(
    a => isPremiumService(a.ancillaryType) && !a.included
  );
  const premiumTotal = premiumSelected.reduce((s, a) => s + a.amount * a.quantity, 0);
  const displayTotal = pricing.total + premiumTotal;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <h3 className="text-sm font-bold text-slate-900 mb-3">Price Summary</h3>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Base fare</span>
          <span>{fmt(pricing.fareTotal)}</span>
        </div>
        {pricing.baggageFees > 0 && (
          <div className="flex justify-between text-slate-600">
            <span>Extra baggage</span>
            <span>+{fmt(pricing.baggageFees)}</span>
          </div>
        )}
        {/* Premium service line items */}
        {premiumSelected.map(svc => (
          <div key={svc.providerServiceId} className="flex justify-between text-slate-600">
            <span>{svc.label}</span>
            <span>+{fmt(svc.amount * svc.quantity)}</span>
          </div>
        ))}
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
        <span className="text-xl font-black text-[#F97316] leading-none">{fmt(displayTotal)}</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AddonsPage() {
  const router = useRouter();
  const { isExpired, OfferGuardUI } = useOfferGuard();
  const store = useCheckoutStore();
  const [submitting, setSubmitting] = useState(false);

  // Load DB-driven fees — populates computedFees in checkout store
  useFeeLoader();
  const pricingCfg = useBuildPricingConfig();

  // Provider state
  const [providerBaggage, setProviderBaggage] = useState<NormalizedAncillary[]>([]);
  const [premiumServices, setPremiumServices] = useState<NormalizedAncillary[]>([]);
  const [baggageLoading, setBaggageLoading] = useState(true);
  const [baggageError, setBaggageError] = useState<string | null>(null);

  const {
    fareOption,
    selectedFare,
    sessionId,
    extraBags,
    priceProtection,
    travelInsurance,
    passengers,
    seatSelections,
    selectedAncillaries,
    currency,
  } = store;

  useEffect(() => {
    if (!selectedFare || !sessionId) router.replace('/');
  }, [selectedFare, sessionId, router]);

  // Fetch provider ancillaries on mount
  useEffect(() => {
    if (!selectedFare?.offerId) {
      setBaggageLoading(false);
      return;
    }

    const provider = (store.sourceFlight?.provider ?? store.sourceRoundTrip?.provider ?? 'duffel').toLowerCase();
    setBaggageLoading(true);
    setBaggageError(null);

    fetch(`/api/ancillaries?offer_id=${encodeURIComponent(selectedFare.offerId)}&provider=${provider}`)
      .then(r => r.json())
      .then((data: { baggage: NormalizedAncillary[]; meals: NormalizedAncillary[]; premiumServices?: NormalizedAncillary[]; error?: string; info?: string }) => {
        setProviderBaggage(data.baggage ?? []);
        setPremiumServices(data.premiumServices ?? []);
        if (data.error) setBaggageError(data.error);
        else if (data.info) setBaggageError(data.info);
      })
      .catch(() => {
        setBaggageError('Add-ons are temporarily unavailable. You can continue booking or manage add-ons with the airline after ticketing.');
      })
      .finally(() => setBaggageLoading(false));
  }, [selectedFare?.offerId]);

  if (!selectedFare || !sessionId) return null;

  const includedBags = fareOption?.baggage.checked ?? 0;

  // Use DB-driven fees if available, otherwise fall back to hardcoded
  const protectionFee = store.computedFees
    ? store.computedFees.protectionFee
    : selectedFare?.protectionFee && selectedFare.protectionFee > 0
      ? selectedFare.protectionFee
      : Math.min(Math.max(Math.round((selectedFare?.basePrice ?? 0) * 0.06), 49), 399);

  const pricing = buildLocalPricing({
    ...store,
    passengers,
    extraBags,
    priceProtection,
    travelInsurance,
    seatSelections,
    selectedAncillaries,
    currency: currency ?? 'USD',
  } as Parameters<typeof buildLocalPricing>[0], pricingCfg);

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
          selectedAncillaries: selectedAncillaries.filter(a => !a.included),
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
      {OfferGuardUI()}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: add-on cards */}
          <div className="lg:col-span-2 space-y-5">
            <ProviderBaggageSection
              includedBags={includedBags}
              providerBaggage={providerBaggage}
              selectedAncillaries={selectedAncillaries}
              onAdd={store.addAncillary}
              onRemove={store.removeAncillary}
              loading={baggageLoading}
              error={baggageError}
            />

            {/* Premium Airport Services — only shown if provider returns them */}
            {premiumServices.length > 0 && (
              <PremiumAirportServicesSection
                services={premiumServices}
                selectedAncillaries={selectedAncillaries}
                onAdd={store.addAncillary}
                onRemove={store.removeAncillary}
              />
            )}

            <PriceDropProtectionSection
              enabled={priceProtection}
              fee={protectionFee}
              onToggle={store.toggleProtection}
            />

            <TravelInsuranceSection
              enabled={travelInsurance}
              fee={store.computedFees
                ? store.computedFees.insuranceFeeTotal
                : pricing.insuranceFee > 0 ? pricing.insuranceFee : Math.round((selectedFare?.basePrice ?? 0) * passengers.length * 0.04)}
              onToggle={store.toggleInsurance}
            />

            <div className="flex items-center gap-2 text-xs text-[#0F766E] px-1">
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
                protection={priceProtection}
                insurance={travelInsurance}
                pricing={pricing}
                selectedAncillaries={selectedAncillaries}
              />

              {priceProtection && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-[#1ABC9C]/5 border border-[#1ABC9C]/20">
                  <ShieldCheck className="w-4 h-4 text-[#1ABC9C] mt-0.5 shrink-0" />
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <span className="font-semibold text-[#1ABC9C]">Price protection active. </span>
                    We&apos;ll monitor this route and refund 80% of any eligible fare decrease as FAREMIND credit.
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
