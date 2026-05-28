// ═══════════════════════════════════════════════
// AiMealPreferenceCollector
// Numbered meal option list using SSR codes
// inside the AI booking chatbot.
// ═══════════════════════════════════════════════

'use client';

import { UtensilsCrossed } from 'lucide-react';

// ─── Options ──────────────────────────────────────────────────────────────────

const MEAL_OPTIONS: { code: string; label: string; emoji: string }[] = [
  { code: 'STANDARD', label: 'Standard meal',     emoji: '🍽️' },
  { code: 'VGML',     label: 'Vegetarian',         emoji: '🥗' },
  { code: 'AVML',     label: 'Asian Vegetarian',   emoji: '🍜' },
  { code: 'NLML',     label: 'Vegan',              emoji: '🌱' },
  { code: 'MOML',     label: 'Halal',              emoji: '🥘' },
  { code: 'KSML',     label: 'Kosher',             emoji: '✡️' },
  { code: 'HNML',     label: 'Hindu',              emoji: '🍛' },
  { code: 'DBML',     label: 'Diabetic',           emoji: '🩺' },
  { code: 'GFML',     label: 'Gluten-Free',        emoji: '🌾' },
  { code: 'NONE',     label: 'Skip meal',          emoji: '⏭️' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onSelect: (code: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiMealPreferenceCollector({ onSelect }: Props) {
  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <UtensilsCrossed className="w-3 h-3 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-[#1ABC9C]">Meal Preference</span>
        </div>
        <p className="text-[13px] text-white/90 leading-relaxed">
          What meal would you like on your flight?
        </p>
        <p className="text-[11px] text-white/40 mt-0.5">
          Select from the options below
        </p>
      </div>

      {/* Meal options grid */}
      <div className="grid grid-cols-2 gap-1.5 px-0.5">
        {MEAL_OPTIONS.map((meal, idx) => (
          <button
            key={meal.code}
            onClick={() => onSelect(meal.code)}
            className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border text-left group transition-all ${
              meal.code === 'NONE'
                ? 'bg-slate-50 border-slate-200/80 hover:border-slate-300 col-span-2'
                : 'bg-white/90 border-slate-200/80 hover:border-[#1ABC9C]/40 hover:shadow-sm'
            }`}
          >
            <span className="text-sm flex-none">{meal.emoji}</span>
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-[11px] font-black text-[#1ABC9C] bg-[#1ABC9C]/10 w-4 h-4 rounded-full flex items-center justify-center flex-none">
                {idx + 1}
              </span>
              <span className="text-[12px] font-semibold text-slate-700 group-hover:text-slate-900 truncate">
                {meal.label}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Instruction */}
      <p className="text-[12px] text-slate-400 text-center px-1">
        <span className="font-bold text-[#1ABC9C]">Tap</span> or type{' '}
        <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[11px]">1–{MEAL_OPTIONS.length}</span>
      </p>
    </div>
  );
}

export { MEAL_OPTIONS };
