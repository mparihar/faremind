// ═══════════════════════════════════════════════
// AiMultiPaxAddOnsStep
// Add-ons for multiple passengers:
// bags (all/per-pax/none), insurance (all/per-pax/none)
// ═══════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Package, Heart, ChevronRight, Check } from 'lucide-react';
import { EXTRA_BAG_PRICE, INSURANCE_RATE } from '@/lib/ai-booking-types';
import { useAiBookingStore } from '@/store/useAiBookingStore';
import { isBundleEnabled } from '@/lib/bundle-flags';

interface Props {
  passengerCount: number;
  baseFarePrice: number;
  currency: string;
  onComplete: (addOns: { extraBags: number; travelInsurance: boolean }) => void;
}

export default function AiMultiPaxAddOnsStep({
  passengerCount,
  baseFarePrice,
  currency,
  onComplete,
}: Props) {
  const [step, setStep] = useState<'menu' | 'bags' | 'done'>('menu');
  const [extraBags, setExtraBags] = useState(0);
  const [travelInsurance, setTravelInsurance] = useState(false);
  const [selections, setSelections] = useState<string[]>([]);

  const computedFees = useAiBookingStore(s => s.computedFees);
  // Use DB-driven insurance fee if available, otherwise fallback to hardcoded rate
  const insuranceFee = computedFees
    ? Math.round(computedFees.insuranceFeeTotal / Math.max(1, passengerCount))
    : Math.round(baseFarePrice * INSURANCE_RATE);

  // Product metadata from DB (with sensible defaults)
  const insuranceName = computedFees?.insuranceProductName || 'Travel Insurance';
  const insuranceCoverage = computedFees?.insuranceCoverage || computedFees?.insuranceDescription || '';

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  const handleDone = (bags: number, insurance: boolean) => {
    onComplete({ extraBags: bags, travelInsurance: insurance });
  };

  if (step === 'bags') {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Package className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Extra Checked Bags</span>
          </div>
          <p className="text-[15px] text-white/90">
            How many extra bags per passenger? ({fmt(EXTRA_BAG_PRICE)} each)
          </p>
          {passengerCount > 1 && (
            <p className="text-[12px] text-white/50 mt-0.5">
              Applied to all {passengerCount} passengers
            </p>
          )}
        </div>

        <div className="flex gap-2 px-0.5">
          {[0, 1, 2].map(n => (
            <button
              key={n}
              onClick={() => {
                setExtraBags(n);
                setStep('menu');
                if (n > 0) setSelections(prev => [...prev.filter(s => s !== 'bags'), 'bags']);
                else setSelections(prev => prev.filter(s => s !== 'bags'));
              }}
              className={`flex-1 py-2.5 rounded-xl border text-center transition-all font-bold text-[15px] ${
                n === 0
                  ? 'bg-slate-50 border-slate-200/80 text-slate-500 hover:border-slate-300'
                  : 'bg-white/90 border-slate-200/80 text-slate-700 hover:border-[#1ABC9C]/40'
              }`}
            >
              {n === 0 ? 'None' : `${n} bag${n > 1 ? 's' : ''}`}
              {n > 0 && (
                <span className="block text-[12px] font-normal text-slate-400">
                  {fmt(EXTRA_BAG_PRICE * n * passengerCount)} total
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Main menu
  return (
    <div className="space-y-2.5">
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Package className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">Travel Add-ons</span>
        </div>
        <p className="text-[15px] text-white/90">
          Almost done! Any extras? 🧳
        </p>
      </div>

      <div className="space-y-1.5 px-0.5">
        {/* Extra bags */}
        <button
          onClick={() => setStep('bags')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left ${
            selections.includes('bags')
              ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30'
              : 'bg-white/90 border-slate-200/80 hover:border-[#1ABC9C]/40'
          }`}
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[#1ABC9C] flex-none" />
            <div>
              <span className="text-[14px] font-semibold text-slate-700">Extra checked bags</span>
              <span className="text-[12px] text-slate-400 ml-1">({fmt(EXTRA_BAG_PRICE)}/bag)</span>
            </div>
          </div>
          {selections.includes('bags') ? (
            <span className="text-[13px] font-bold text-[#1ABC9C]">{extraBags} bag{extraBags > 1 ? 's' : ''}</span>
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
          )}
        </button>

        {/* Travel insurance — hidden when FAREMIND_BUNDLE is disabled */}
        {isBundleEnabled() && (
        <button
          onClick={() => {
            const next = !travelInsurance;
            setTravelInsurance(next);
            if (next) setSelections(prev => [...prev, 'insurance']);
            else setSelections(prev => prev.filter(s => s !== 'insurance'));
          }}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all text-left ${
            travelInsurance
              ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30'
              : 'bg-white/90 border-slate-200/80 hover:border-[#1ABC9C]/40'
          }`}
        >
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-[#1ABC9C] flex-none" />
            <div>
              <span className="text-[14px] font-semibold text-slate-700">{insuranceName}</span>
              <span className="text-[12px] text-slate-400 ml-1">
                ({fmt(insuranceFee)}/pax{passengerCount > 1 ? ` · ${fmt(insuranceFee * passengerCount)} total` : ''})
              </span>
              {insuranceCoverage && (
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{insuranceCoverage}</p>
              )}
            </div>
          </div>
          {travelInsurance ? (
            <Check className="w-4 h-4 text-[#1ABC9C]" />
          ) : (
            <span className="text-[13px] text-slate-300">—</span>
          )}
        </button>
        )}
      </div>

      {/* Continue */}
      <button
        onClick={() => handleDone(extraBags, travelInsurance)}
        className="w-full py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[14px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20 flex items-center justify-center gap-1"
      >
        <Check className="w-3.5 h-3.5" />
        {selections.length === 0 ? 'Skip add-ons' : 'Continue with selections'} →
      </button>
    </div>
  );
}
