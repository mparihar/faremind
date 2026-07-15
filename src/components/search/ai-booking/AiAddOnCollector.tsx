// ═══════════════════════════════════════════════
// AiAddOnCollector
// Extra bags, travel insurance, price protection
// collection inside the AI booking chatbot.
// ═══════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Package, Shield, Heart, ChevronRight, Check } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { FALLBACK_EXTRA_BAG_PRICE, FALLBACK_INSURANCE_RATE } from '@/lib/ai-booking-types';
import { useAiBookingStore } from '@/store/useAiBookingStore';

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  baseFarePrice: number;
  currency: string;
  priceProtectionAvailable: boolean;
  protectionFee: number;
  onComplete: (addOns: { extraBags: number; travelInsurance: boolean }) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiAddOnCollector({
  baseFarePrice,
  currency,
  priceProtectionAvailable,
  protectionFee,
  onComplete,
}: Props) {
  const [step, setStep] = useState<'menu' | 'bags' | 'done'>('menu');
  const [extraBags, setExtraBags] = useState(0);
  const [travelInsurance, setTravelInsurance] = useState(false);
  const [selections, setSelections] = useState<string[]>([]);

  const computedFees = useAiBookingStore(s => s.computedFees);
  // Use DB-driven insurance fee if available, otherwise fallback to hardcoded rate
  const insuranceFee = computedFees
    ? Math.round(computedFees.insuranceFeeTotal) // Total for all passengers
    : Math.round(baseFarePrice * FALLBACK_INSURANCE_RATE);

  const handleOption = (option: number) => {
    switch (option) {
      case 1: // Extra bags
        setStep('bags');
        break;
      case 2: // Travel insurance
        setTravelInsurance(prev => !prev);
        setSelections(prev => {
          if (prev.includes('insurance')) return prev.filter(s => s !== 'insurance');
          return [...prev, 'insurance'];
        });
        break;
      case 3: // No add-ons / Continue
        onComplete({ extraBags, travelInsurance });
        setStep('done');
        break;
    }
  };

  const handleBagSelect = (n: number) => {
    setExtraBags(n);
    if (n > 0) {
      setSelections(prev => [...prev.filter(s => !s.startsWith('bag')), `bag_${n}`]);
    }
    setStep('menu');
  };

  // ── Bag selection sub-step ──────────────────────────────────────────────────
  if (step === 'bags') {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Package className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Extra Checked Bags</span>
          </div>
          <p className="text-[15px] text-white/90">How many extra bags do you need?</p>
          <p className="text-[13px] text-white/50 mt-0.5">
            {formatPrice(FALLBACK_EXTRA_BAG_PRICE, currency)} per bag
          </p>
        </div>

        <div className="space-y-1.5 px-0.5">
          {[1, 2, 3].map(n => (
            <button
              key={n}
              onClick={() => handleBagSelect(n)}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 hover:shadow-sm transition-all"
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-black text-[#1ABC9C] bg-[#1ABC9C]/10 w-6 h-6 rounded-full flex items-center justify-center">
                  {n}
                </span>
                <span className="text-[15px] font-semibold text-slate-700">
                  {n} extra bag{n > 1 ? 's' : ''}
                </span>
              </div>
              <span className="text-[15px] font-bold text-[#F97316]">
                +{formatPrice(n * FALLBACK_EXTRA_BAG_PRICE, currency)}
              </span>
            </button>
          ))}

          <button
            onClick={() => handleBagSelect(0)}
            className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-slate-300 transition-all"
          >
            <span className="text-[14px] text-slate-500 font-medium">No extra bags</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Done step (shouldn't render but just in case) ───────────────────────────
  if (step === 'done') {
    return null;
  }

  // ── Main menu ───────────────────────────────────────────────────────────────
  const runningTotal = (extraBags * FALLBACK_EXTRA_BAG_PRICE) + (travelInsurance ? insuranceFee : 0);

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Package className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">Add-Ons</span>
        </div>
        <p className="text-[15px] text-white/90 leading-relaxed">
          Would you like to add any extras to your booking?
        </p>
      </div>

      {/* Current selections */}
      {selections.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {selections.map(s => (
            <span key={s} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/50">
              <Check className="w-2.5 h-2.5 text-emerald-500" strokeWidth={3} />
              <span className="text-[12px] text-emerald-700 font-medium">
                {s.startsWith('bag') ? `${s.split('_')[1]} bag(s)` : 'Insurance'}
              </span>
            </span>
          ))}
          {runningTotal > 0 && (
            <span className="text-[13px] text-[#F97316] font-bold self-center ml-1">
              +{formatPrice(runningTotal, currency)}
            </span>
          )}
        </div>
      )}

      {/* Options */}
      <div className="space-y-1.5 px-0.5">
        {/* 1. Extra bags */}
        <button
          onClick={() => handleOption(1)}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-[#1ABC9C] to-emerald-600 text-white text-[13px] font-black">
              1
            </span>
            <div className="text-left">
              <span className="text-[15px] font-semibold text-slate-700 block">🧳 Extra checked bags</span>
              <span className="text-[13px] text-slate-400">
                {formatPrice(FALLBACK_EXTRA_BAG_PRICE, currency)}/bag
                {extraBags > 0 && <span className="text-emerald-600 ml-1">· {extraBags} selected</span>}
              </span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-300" />
        </button>

        {/* 2. Travel insurance */}
        <button
          onClick={() => handleOption(2)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
            travelInsurance
              ? 'bg-emerald-50 border-emerald-300'
              : 'bg-white/90 border-slate-200/80 hover:border-[#1ABC9C]/40 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-[#1ABC9C] to-emerald-600 text-white text-[13px] font-black">
              2
            </span>
            <div className="text-left">
              <span className="text-[15px] font-semibold text-slate-700 block">
                <Heart className="w-3.5 h-3.5 inline mr-0.5 text-pink-400" />
                Travel insurance
              </span>
              <span className="text-[13px] text-slate-400">
                {formatPrice(insuranceFee, currency)} · Covers cancellation & medical
              </span>
            </div>
          </div>
          {travelInsurance ? (
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center flex-none">
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            </div>
          ) : (
            <div className="w-6 h-6 rounded-full border-2 border-slate-300 flex-none" />
          )}
        </button>

        {/* 3. Continue */}
        <button
          onClick={() => handleOption(3)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[15px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20 mt-2"
        >
          {selections.length > 0 ? 'Continue with add-ons' : 'No add-ons — Continue'}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
