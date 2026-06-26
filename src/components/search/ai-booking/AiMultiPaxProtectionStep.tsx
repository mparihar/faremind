// ═══════════════════════════════════════════════
// AiMultiPaxProtectionStep
// Price protection for multi-passenger: all / per-pax / none
// Uses DB-configured product rules via fee engine
// ═══════════════════════════════════════════════

'use client';

import { useState, useEffect } from 'react';
import { Shield, Check, X } from 'lucide-react';
import { useAiBookingStore } from '@/store/useAiBookingStore';
import { isBundleEnabled } from '@/lib/bundle-flags';

interface Props {
  passengerCount: number;
  protectionFeePerPax: number;
  currency: string;
  onComplete: (selections: boolean[]) => void;
}

export default function AiMultiPaxProtectionStep({
  passengerCount,
  protectionFeePerPax,
  currency,
  onComplete,
}: Props) {
  const [mode, setMode] = useState<'menu' | 'per_pax'>('menu');
  const [perPax, setPerPax] = useState<boolean[]>(Array(passengerCount).fill(false));

  // FAREMIND_BUNDLE gate: auto-skip when disabled
  useEffect(() => {
    if (!isBundleEnabled()) {
      onComplete(Array(passengerCount).fill(false));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render if bundle is disabled
  if (!isBundleEnabled()) return null;


  const computedFees = useAiBookingStore(s => s.computedFees);

  // Use DB-driven fee if available, fallback to prop
  const effectiveFeePerPax = computedFees?.protectionFee ?? protectionFeePerPax;

  // Product metadata from DB (with sensible defaults)
  const productName = computedFees?.protectionProductName || 'Price Drop Protection';
  const rawCoverage = computedFees?.protectionCoverage
    || computedFees?.protectionDescription
    || 'Refund 80% of any eligible fare decrease after booking.';
  // Strip min/max bounds text if present
  const coverageSummary = rawCoverage
    .replace(/\.?\s*Minimum protection fee\s*\$?\d+,?\s*maximum\s*\$?\d+\.?/gi, '')
    .replace(/\.?\s*Min\.?\s*\$?\d+[\s,]*max\.?\s*\$?\d+\.?/gi, '')
    .trim();

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  if (mode === 'per_pax') {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Per-Passenger Protection</span>
          </div>
          <p className="text-[15px] text-white/90">Choose protection for each traveler ({fmt(effectiveFeePerPax)} each):</p>
        </div>

        <div className="space-y-1.5 px-0.5">
          {perPax.map((selected, i) => (
            <button
              key={i}
              onClick={() => {
                const next = [...perPax];
                next[i] = !next[i];
                setPerPax(next);
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border transition-all ${
                selected
                  ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/40 text-[#1ABC9C]'
                  : 'bg-white/90 border-slate-200/80 text-slate-600 hover:border-slate-300'
              }`}
            >
              <span className="text-[14px] font-semibold">
                Traveler {i + 1}
              </span>
              <span className="text-[13px] font-bold">
                {selected ? '✅ Protected' : '—'}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={() => onComplete(perPax)}
          className="w-full py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[14px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20"
        >
          Continue →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Shield className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">{productName}</span>
        </div>
        <p className="text-[15px] text-white/90 leading-relaxed">
          Would you like <span className="font-bold text-white">{productName}</span>?
        </p>
        <p className="text-[12px] text-white/50 mt-1">
          {coverageSummary}
          <br />Cost: {fmt(effectiveFeePerPax)} per passenger
          {passengerCount > 1 && ` · ${fmt(effectiveFeePerPax * passengerCount)} for all ${passengerCount}`}
        </p>
      </div>

      <div className="space-y-1.5 px-0.5">
        <button
          onClick={() => onComplete(Array(passengerCount).fill(true))}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 hover:border-[#1ABC9C]/50 transition-all text-left"
        >
          <Check className="w-4 h-4 text-[#1ABC9C] flex-none" />
          <div>
            <span className="text-[14px] font-bold text-[#1ABC9C]">Add for all passengers</span>
            <span className="text-[12px] text-slate-500 ml-1">({fmt(effectiveFeePerPax * passengerCount)})</span>
          </div>
        </button>

        {passengerCount > 1 && (
          <button
            onClick={() => setMode('per_pax')}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 transition-all text-left"
          >
            <Shield className="w-4 h-4 text-slate-400 flex-none" />
            <span className="text-[14px] font-semibold text-slate-600">Choose per passenger</span>
          </button>
        )}

        <button
          onClick={() => onComplete(Array(passengerCount).fill(false))}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-slate-300 transition-all text-left"
        >
          <X className="w-4 h-4 text-slate-400 flex-none" />
          <span className="text-[14px] font-semibold text-slate-500">No protection</span>
        </button>
      </div>
    </div>
  );
}

