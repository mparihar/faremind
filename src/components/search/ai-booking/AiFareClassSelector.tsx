// ═══════════════════════════════════════════════
// AiFareClassSelector
// Displays real fare options fetched from the API
// inside the AI booking chatbot.
// ═══════════════════════════════════════════════

'use client';

import { Check, X, Sparkles } from 'lucide-react';
import type { FareOption } from '@/lib/fare-types';
import { formatPrice } from '@/lib/utils';

interface Props {
  fares: FareOption[];
  onSelect: (fare: FareOption) => void;
}

const FARE_EMOJI: Record<string, string> = {
  basic: '💺',
  standard: '🧳',
  flex: '✨',
  premium: '✨',
};

function getEmoji(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('flex') || lower.includes('premium')) return '✨';
  if (lower.includes('standard') || lower.includes('regular')) return '🧳';
  return '💺';
}

function getBadge(fare: FareOption, index: number, total: number): { label: string; color: string } {
  if (fare.aiBadges.includes('cheapest') || index === 0)
    return { label: 'Lowest price', color: 'bg-blue-50 text-blue-600 border-blue-200' };
  if (fare.aiBadges.includes('ai_pick') || fare.aiBadges.includes('best_value'))
    return { label: 'Best value', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
  if (fare.aiBadges.includes('most_flexible') || index === total - 1)
    return { label: 'Most flexible', color: 'bg-amber-50 text-amber-600 border-amber-200' };
  return { label: 'Best value', color: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
}

function buildFeatureLists(fare: FareOption): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  const excluded: string[] = [];

  // Carry-on
  if (fare.baggage.carryOn)
    included.push(`${fare.baggage.carryOnPieces}× carry-on bag`);

  // Checked bags
  if (fare.baggage.checked > 0)
    included.push(`${fare.baggage.checked}× checked bag${fare.baggage.checked > 1 ? 's' : ''}`);
  else excluded.push('No checked bag');

  // Refund
  if (!fare.policy.refundable) excluded.push('Non-refundable');
  else if (fare.policy.refundFeeUsd === 0) included.push('Fully refundable');
  else if (fare.policy.refundFeeUsd !== null)
    included.push(`Refundable (up to $${fare.policy.refundFeeUsd})`);
  else included.push('Refundable');

  // Changes
  if (!fare.policy.changeable) excluded.push('No changes allowed');
  else if (fare.policy.changeFeeUsd === 0) included.push('Free changes');
  else if (fare.policy.changeFeeUsd !== null)
    included.push(`Change fee: $${fare.policy.changeFeeUsd}`);
  else included.push('Changes allowed');

  // Seat
  if (fare.policy.seatSelection === 'free') included.push('Free seat selection');
  else if (fare.policy.seatSelection === 'fee' && fare.policy.seatSelectionFeeUsd)
    included.push(`Seat: $${fare.policy.seatSelectionFeeUsd}/seat`);

  // Priority
  if (fare.policy.priorityBoarding) included.push('Priority boarding');
  else excluded.push('Priority boarding');

  // Miles
  if (fare.policy.milesEarning === 'full') included.push('Full miles earned');
  else if (fare.policy.milesEarning === 'reduced') included.push('50% miles earned');

  return { included, excluded };
}

export default function AiFareClassSelector({ fares, onSelect }: Props) {
  return (
    <div className="space-y-2">
      {fares.map((fare, idx) => {
        const badge = getBadge(fare, idx, fares.length);
        const emoji = getEmoji(fare.name);
        const { included, excluded } = buildFeatureLists(fare);

        return (
          <button
            key={fare.id}
            onClick={() => onSelect(fare)}
            className="w-full text-left bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200/80 p-3 hover:border-[#1ABC9C]/40 hover:shadow-md hover:shadow-[#1ABC9C]/10 transition-all cursor-pointer group"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-gradient-to-br from-[#1ABC9C] to-emerald-600 text-white text-[12px] font-black flex-none">
                  {idx + 1}
                </span>
                <span className="text-[13px] font-extrabold text-slate-900 truncate">
                  {emoji} {fare.name}
                </span>
              </div>
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full border flex-none ${badge.color}`}>
                {badge.label}
              </span>
            </div>

            {/* Price + AI score */}
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-[15px] font-black text-[#F97316]">
                {formatPrice(fare.totalPrice, fare.currency)}
              </span>
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#1ABC9C]/10">
                <Sparkles className="w-2.5 h-2.5 text-[#1ABC9C]" />
                <span className="text-[11px] font-black text-[#1ABC9C]">AI {fare.aiScore}</span>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-1">
              {included.slice(0, 5).map((f, fi) => (
                <div key={fi} className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-emerald-50 flex items-center justify-center flex-none">
                    <Check className="w-2 h-2 text-emerald-500" strokeWidth={3} />
                  </div>
                  <span className="text-[12px] text-slate-600 leading-tight">{f}</span>
                </div>
              ))}
              {excluded.slice(0, 2).map((f, fi) => (
                <div key={`ex-${fi}`} className="flex items-center gap-1.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-slate-100 flex items-center justify-center flex-none">
                    <X className="w-2 h-2 text-slate-400" strokeWidth={3} />
                  </div>
                  <span className="text-[12px] text-slate-400 leading-tight">{f}</span>
                </div>
              ))}
            </div>

            {/* AI explanation */}
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed italic">
              {fare.aiExplanation}
            </p>
          </button>
        );
      })}

      {/* Instruction */}
      <div className="px-1 mt-1">
        <p className="text-[12px] text-slate-400 text-center">
          <span className="font-bold text-[#1ABC9C]">Tap a fare</span> or type{' '}
          <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[11px]">1–{fares.length}</span>{' '}
          to select
        </p>
      </div>
    </div>
  );
}
