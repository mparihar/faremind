// ═══════════════════════════════════════════════
// AiPassengerCountStep
// Compact numbered selector (1–9) for passenger count.
// Shows fare summary after selection.
// ═══════════════════════════════════════════════

'use client';

import { Users } from 'lucide-react';

interface Props {
  farePerPax: number;
  fareName: string;
  currency: string;
  onSelect: (count: number) => void;
}

export default function AiPassengerCountStep({ farePerPax, fareName, currency, onSelect }: Props) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Users className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">Passenger Count</span>
        </div>
        <p className="text-[15px] text-white/90 leading-relaxed">
          How many passengers are traveling?
        </p>
        <p className="text-[12px] text-white/50 mt-0.5">
          {fareName} · {fmt(farePerPax)} per passenger
        </p>
      </div>

      {/* Number grid */}
      <div className="grid grid-cols-5 gap-1.5 px-0.5">
        {Array.from({ length: 9 }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            onClick={() => onSelect(n)}
            className={`py-2.5 rounded-xl border text-center transition-all font-bold text-[14px] ${
              n === 1
                ? 'bg-[#1ABC9C]/10 border-[#1ABC9C]/30 text-[#1ABC9C] hover:bg-[#1ABC9C]/20'
                : 'bg-white/90 border-slate-200/80 text-slate-700 hover:border-[#1ABC9C]/40 hover:shadow-sm'
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      {/* Instruction */}
      <p className="text-[13px] text-slate-400 text-center px-1">
        <span className="font-bold text-[#1ABC9C]">Tap</span> a number or type{' '}
        <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[12px]">1–9</span>
      </p>
    </div>
  );
}
