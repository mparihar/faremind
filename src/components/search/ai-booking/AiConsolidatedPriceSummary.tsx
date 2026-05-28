// ═══════════════════════════════════════════════
// AiConsolidatedPriceSummary
// Full price breakdown for multi-passenger booking.
// ═══════════════════════════════════════════════

'use client';

import { Calculator } from 'lucide-react';
import type { AiPriceSummary } from '@/lib/ai-booking-types';

interface Props {
  summary: AiPriceSummary;
}

export default function AiConsolidatedPriceSummary({ summary }: Props) {
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: summary.currency, maximumFractionDigits: 0 }).format(n);

  const pax = summary.passengerCount;
  const showMultiplier = pax > 1;

  const rows: { label: string; value: number; detail?: string }[] = [
    {
      label: 'Base fare',
      value: summary.baseFare,
      detail: showMultiplier ? `${fmt(summary.baseFarePerPax)} × ${pax}` : undefined,
    },
    {
      label: 'Taxes & fees',
      value: summary.taxes,
      detail: showMultiplier ? `${fmt(Math.round(summary.taxes / pax))} × ${pax}` : undefined,
    },
    {
      label: 'Service fee',
      value: summary.serviceFee,
      detail: showMultiplier ? `${fmt(Math.round(summary.serviceFee / pax))} × ${pax}` : undefined,
    },
  ];

  if (summary.protectionFee > 0) {
    rows.push({
      label: 'Price protection',
      value: summary.protectionFee,
    });
  }

  if (summary.seatSelectionFee > 0) {
    rows.push({
      label: 'Seat selection',
      value: summary.seatSelectionFee,
    });
  }

  if (summary.baggageFee > 0) {
    rows.push({
      label: 'Extra bags',
      value: summary.baggageFee,
    });
  }

  if (summary.insuranceFee > 0) {
    rows.push({
      label: 'Travel insurance',
      value: summary.insuranceFee,
      detail: showMultiplier ? `${fmt(Math.round(summary.insuranceFee / pax))} × ${pax}` : undefined,
    });
  }

  return (
    <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Calculator className="w-3 h-3 text-[#1ABC9C]" />
        <span className="text-[12px] font-bold text-slate-400 uppercase">Price Breakdown</span>
        {showMultiplier && (
          <span className="text-[11px] text-slate-400 ml-auto">{pax} passengers</span>
        )}
      </div>

      <div className="space-y-1">
        {rows.map(row => (
          <div key={row.label} className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-[12px] text-slate-500">{row.label}</span>
              {row.detail && (
                <span className="text-[11px] text-slate-400">({row.detail})</span>
              )}
            </div>
            <span className="text-[12px] font-semibold text-slate-700">{fmt(row.value)}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-200 mt-2 pt-2 flex items-center justify-between">
        <span className="text-[13px] font-bold text-slate-800">Grand Total</span>
        <span className="text-[14px] font-black text-[#F97316]">{fmt(summary.total)}</span>
      </div>
    </div>
  );
}
