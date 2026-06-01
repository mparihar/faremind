'use client';

import type { FareOption } from '@/lib/fare-types';
import { Shield, Check, X, Minus, Zap, DollarSign, Repeat2, Star, Armchair } from 'lucide-react';

interface FareCardProps {
  fare: FareOption;
  selected: boolean;
  priceProtection: boolean;
  protectionFee: number;
  onSelect: () => void;
  onToggleProtection: () => void;
  currency: string;
  travelerCount: number;
  passengerBreakdown?: { adults: number; children: number; infants: number };
}

const BADGE_CONFIG = {
  cheapest:        { label: 'Cheapest',         color: 'bg-orange-100 text-[#F97316]',    icon: DollarSign },
  best_value:      { label: 'AI Best Choice',   color: 'bg-[#1ABC9C]/15 text-[#1ABC9C]',  icon: Zap },
  ai_pick:         { label: 'AI Best Choice',   color: 'bg-[#1ABC9C]/15 text-[#1ABC9C]',  icon: Zap },
  most_flexible:   { label: 'Best Flexibility', color: 'bg-purple-100 text-purple-700',   icon: Repeat2 },
  premium_upgrade: { label: 'Premium Upgrade',  color: 'bg-amber-100 text-amber-700',     icon: Star },
  best_comfort:    { label: 'Best Comfort',     color: 'bg-sky-100 text-sky-700',         icon: Armchair },
};

const CABIN_RING: Record<string, string> = {
  economy:         'ring-[#1ABC9C]/40',
  premium_economy: 'ring-purple-300/60',
  business:        'ring-amber-300/60',
};

const CABIN_BORDER: Record<string, string> = {
  economy:         'border-slate-200',
  premium_economy: 'border-purple-200',
  business:        'border-amber-300',
};

function fmtPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

// ─── Feature row ──────────────────────────────────────────────────────────────

type FeatureStatus = 'yes' | 'no' | 'partial';
interface Feature { status: FeatureStatus; label: string }

function FeatureRow({ status, label }: Feature) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-slate-50 last:border-0">
      {status === 'yes'     && <Check size={14} className="text-emerald-500 shrink-0" strokeWidth={2.5} />}
      {status === 'no'      && <X     size={14} className="text-slate-300   shrink-0" strokeWidth={2.5} />}
      {status === 'partial' && <Minus size={14} className="text-amber-400   shrink-0" strokeWidth={2.5} />}
      <span className={`text-[13px] leading-snug ${status === 'no' ? 'text-slate-400' : 'text-slate-700'}`}>
        {label}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FareCard({
  fare,
  selected,
  priceProtection,
  protectionFee,
  onSelect,
  onToggleProtection,
  currency,
  travelerCount,
  passengerBreakdown,
}: FareCardProps) {
  const border     = CABIN_BORDER[fare.cabin] || 'border-slate-200';
  const ring       = CABIN_RING[fare.cabin]   || 'ring-[#1ABC9C]/40';

  // Compute the correct total for all passengers
  // Children get 75% of the adult fare (matching buildLocalPricing)
  const perPersonBase = fare.basePrice;
  let allPassengerFareTotal: number;
  if (passengerBreakdown && travelerCount > 1) {
    const { adults, children: childCount, infants } = passengerBreakdown;
    const adultTotal = adults * perPersonBase;
    const childTotal = childCount * Math.round(perPersonBase * 0.75);
    const infantTotal = infants * perPersonBase; // infants priced same as adults in buildLocalPricing
    const subtotal = adultTotal + childTotal + infantTotal;
    const serviceFee = Math.round(perPersonBase * travelerCount * 0.015);
    allPassengerFareTotal = subtotal + serviceFee;
  } else {
    allPassengerFareTotal = fare.totalPrice;
  }
  const totalProtectionFee = protectionFee * travelerCount;
  const grandTotal = allPassengerFareTotal + (selected && priceProtection ? totalProtectionFee : 0);


  const features: Feature[] = [
    {
      status: 'yes',
      label:  `${fare.baggage.carryOnPieces}× carry-on${fare.baggage.carryOnWeightKg ? ` (${fare.baggage.carryOnWeightKg} kg)` : ''}`,
    },
    fare.baggage.checked > 0
      ? { status: 'yes', label: `${fare.baggage.checked}× checked bag${fare.baggage.checked > 1 ? 's' : ''}${fare.baggage.checkedWeightKg ? ` · ${fare.baggage.checkedWeightKg} kg` : ''}` }
      : { status: 'no',  label: 'No checked bag' },
    !fare.policy.refundable
      ? { status: 'no',      label: 'Non-refundable' }
      : fare.policy.refundFeeUsd === 0
      ? { status: 'yes',     label: 'Fully refundable' }
      : { status: 'partial', label: `Refund fee: ${fmtPrice(fare.policy.refundFeeUsd!, currency)}` },
    !fare.policy.changeable
      ? { status: 'no',      label: 'No changes allowed' }
      : fare.policy.changeFeeUsd === 0
      ? { status: 'yes',     label: 'Free changes' }
      : { status: 'partial', label: `Change fee: ${fmtPrice(fare.policy.changeFeeUsd!, currency)}` },
    fare.policy.seatSelection === 'free'
      ? { status: 'yes',     label: 'Free seat selection' }
      : fare.policy.seatSelection === 'fee'
      ? { status: 'partial', label: `Seat: ${fmtPrice(fare.policy.seatSelectionFeeUsd!, currency)}/seat` }
      : { status: 'no',      label: 'No seat selection' },
    { status: fare.policy.priorityBoarding ? 'yes' : 'no', label: 'Priority boarding' },
    ...(fare.cabin !== 'economy'
      ? [{ status: (fare.policy.loungeAccess ? 'yes' : 'no') as FeatureStatus, label: 'Lounge access' }]
      : []),
    {
      status: fare.policy.milesEarning === 'full' ? 'yes' : fare.policy.milesEarning === 'reduced' ? 'partial' : 'no',
      label:  fare.policy.milesEarning === 'full' ? 'Full miles earned' : fare.policy.milesEarning === 'reduced' ? '50% miles earned' : 'No miles earned',
    },
  ];

  return (
    <div
      className={`relative rounded-2xl border-2 flex flex-col w-full h-full bg-white overflow-hidden cursor-pointer transition-all duration-200 ${
        selected
          ? `${border} shadow-xl ring-2 ${ring}`
          : `${border} hover:shadow-md hover:border-[#1ABC9C]/40`
      }`}
      onClick={onSelect}
    >
      {/* Popular ribbon */}
      {fare.popular && (
        <div className="absolute top-0 right-0 bg-[#1ABC9C] text-white text-[9px] font-black px-3 py-1 rounded-bl-xl tracking-widest z-10">
          POPULAR
        </div>
      )}

      {/* ── Card body ── */}
      <div className="p-5 flex flex-col flex-1 gap-4">

        {/* Badge(s) */}
        <div className="min-h-[24px] flex flex-wrap gap-1.5">
          {fare.aiBadges
            .filter(b => b !== 'ai_pick') // ai_pick is duplicate of best_value
            .slice(0, 2) // show up to 2 badges
            .map(badge => {
              const cfg = BADGE_CONFIG[badge];
              if (!cfg) return null;
              const Icon = cfg.icon;
              return (
                <span key={badge} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${cfg.color}`}>
                  <Icon size={10} strokeWidth={2.5} /> {cfg.label}
                </span>
              );
            })}
        </div>

        {/* Fare name + price */}
        <div>
          <h3 className="text-[15px] font-extrabold text-slate-900 leading-tight">{fare.name}</h3>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="text-[26px] font-black text-[#F97316] leading-none">{fmtPrice(grandTotal, currency)}</span>
            <span className="text-xs text-slate-400">
              Total
            </span>
          </div>
          {selected && priceProtection && (
            <p className="text-[11px] text-[#1ABC9C] font-semibold mt-0.5">incl. price protection</p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100" />

        {/* Feature checklist */}
        <div className="flex-1">
          {features.map((f, i) => <FeatureRow key={i} {...f} />)}
        </div>

        {/* Divider */}
        <div className="border-t border-slate-100" />

        {/* AI score bar */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              AI Score&nbsp;<span className="text-slate-700 text-[13px]">{Math.round(fare.aiScore)}</span>
            </span>
            <span className="text-[11px] text-slate-400">/100</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#1ABC9C] to-emerald-400 transition-all duration-700"
              style={{ width: `${fare.aiScore}%` }}
            />
          </div>
        </div>

        {/* Why this fare */}
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Why this fare</p>
          <p className="text-[12px] text-slate-600 leading-snug">{fare.aiExplanation}</p>
        </div>

        {/* Seats warning */}
        {fare.seatsRemaining !== undefined && fare.seatsRemaining <= 5 && (
          <p className="text-[12px] font-bold text-red-500">
            Only {fare.seatsRemaining} seat{fare.seatsRemaining !== 1 ? 's' : ''} left!
          </p>
        )}

        {/* Price Drop Protection (when selected) */}
        {selected && (
          <div
            className="p-3.5 rounded-xl border border-[#1ABC9C]/30 bg-[#1ABC9C]/5 cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Shield size={15} className="text-[#1ABC9C] shrink-0" />
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-slate-800">Price Protection</p>
                  <p className="text-[11px] text-slate-500 leading-tight">Refund 80% of any eligible fare decrease after booking.</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] font-bold text-slate-900">+{fmtPrice(protectionFee, currency)}</p>
                <p className="text-[9px] text-slate-400">per traveler</p>
                <button
                  onClick={onToggleProtection}
                  className={`mt-1 px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                    priceProtection
                      ? 'bg-[#1ABC9C] text-white'
                      : 'bg-white border border-[#1ABC9C] text-[#1ABC9C] hover:bg-[#1ABC9C]/10'
                  }`}
                >
                  {priceProtection ? 'Added ✓' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Select button ── */}
      <div className="px-5 pb-5 pt-1 shrink-0">
        <button
          className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${
            selected
              ? 'bg-[#1ABC9C] text-white shadow-md shadow-[#1ABC9C]/25'
              : 'bg-slate-100 text-slate-600 hover:bg-[#1ABC9C]/10 hover:text-[#1ABC9C]'
          }`}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          {selected ? '✓ Selected' : 'Select'}
        </button>
      </div>
    </div>
  );
}
