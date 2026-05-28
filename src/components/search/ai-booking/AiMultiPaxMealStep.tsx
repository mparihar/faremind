// ═══════════════════════════════════════════════
// AiMultiPaxMealStep
// Meal selection for multiple passengers:
// same-for-all / per-passenger / skip
// ═══════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { UtensilsCrossed, Check, X, ChevronRight } from 'lucide-react';

const MEAL_OPTIONS: { code: string; label: string; emoji: string }[] = [
  { code: 'STANDARD', label: 'Standard meal',   emoji: '🍽️' },
  { code: 'VGML',     label: 'Vegetarian',       emoji: '🥗' },
  { code: 'AVML',     label: 'Asian Vegetarian', emoji: '🍜' },
  { code: 'NLML',     label: 'Vegan',            emoji: '🌱' },
  { code: 'MOML',     label: 'Halal',            emoji: '🥘' },
  { code: 'KSML',     label: 'Kosher',           emoji: '✡️' },
  { code: 'HNML',     label: 'Hindu',            emoji: '🍛' },
  { code: 'DBML',     label: 'Diabetic',         emoji: '🩺' },
  { code: 'GFML',     label: 'Gluten-Free',      emoji: '🌾' },
  { code: 'NONE',     label: 'Skip meal',        emoji: '⏭️' },
];

interface Props {
  passengerCount: number;
  isRoundTrip: boolean;
  onComplete: (meals: { paxIndex: number; journey: 'outbound' | 'return'; code: string }[]) => void;
}

export default function AiMultiPaxMealStep({ passengerCount, isRoundTrip, onComplete }: Props) {
  const [mode, setMode] = useState<'menu' | 'per_pax'>('menu');
  const [currentPax, setCurrentPax] = useState(0);
  const [perPaxMeals, setPerPaxMeals] = useState<string[]>(Array(passengerCount).fill(''));

  const handleSameForAll = (code: string) => {
    const meals: { paxIndex: number; journey: 'outbound' | 'return'; code: string }[] = [];
    for (let i = 0; i < passengerCount; i++) {
      meals.push({ paxIndex: i, journey: 'outbound', code });
      if (isRoundTrip) meals.push({ paxIndex: i, journey: 'return', code });
    }
    onComplete(meals);
  };

  const handlePerPaxSelect = (code: string) => {
    const next = [...perPaxMeals];
    next[currentPax] = code;
    setPerPaxMeals(next);

    if (currentPax < passengerCount - 1) {
      setCurrentPax(currentPax + 1);
    } else {
      // All done — build meal selections
      const meals: { paxIndex: number; journey: 'outbound' | 'return'; code: string }[] = [];
      next.forEach((c, i) => {
        meals.push({ paxIndex: i, journey: 'outbound', code: c });
        if (isRoundTrip) meals.push({ paxIndex: i, journey: 'return', code: c });
      });
      onComplete(meals);
    }
  };

  // Per-pax meal selector
  if (mode === 'per_pax') {
    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <UtensilsCrossed className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Meal — Traveler {currentPax + 1}</span>
          </div>
          <p className="text-[15px] text-white/90">
            Select meal for Traveler {currentPax + 1} of {passengerCount}:
          </p>
          {/* Progress indicator */}
          <div className="flex gap-1 mt-1.5">
            {Array.from({ length: passengerCount }, (_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full flex-1 ${
                  i < currentPax ? 'bg-[#1ABC9C]' : i === currentPax ? 'bg-[#1ABC9C]/50' : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 px-0.5">
          {MEAL_OPTIONS.map((meal, idx) => (
            <button
              key={meal.code}
              onClick={() => handlePerPaxSelect(meal.code)}
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
                <span className="text-[12px] font-semibold text-slate-700 truncate">{meal.label}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Menu: same for all / per pax / skip
  return (
    <div className="space-y-2.5">
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <UtensilsCrossed className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">Meal Preference</span>
        </div>
        <p className="text-[15px] text-white/90">
          What meal would you like on board? 🍽️
        </p>
      </div>

      <div className="space-y-1.5 px-0.5">
        {/* Same for all — show meal options */}
        {passengerCount === 1 ? (
          // Single pax: show meal grid directly
          <div className="grid grid-cols-2 gap-1.5">
            {MEAL_OPTIONS.map((meal, idx) => (
              <button
                key={meal.code}
                onClick={() => handleSameForAll(meal.code)}
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
                  <span className="text-[12px] font-semibold text-slate-700 truncate">{meal.label}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Multi-pax: same meal for all — meal grid */}
            <div className="grid grid-cols-2 gap-1.5">
              {MEAL_OPTIONS.map((meal, idx) => (
                <button
                  key={meal.code}
                  onClick={() => handleSameForAll(meal.code)}
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
                    <span className="text-[12px] font-semibold text-slate-700 truncate">{meal.label}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className="text-[12px] text-slate-400 text-center py-1">
              ↑ Same meal for all {passengerCount} passengers · or ↓
            </div>

            <button
              onClick={() => setMode('per_pax')}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 transition-all text-left"
            >
              <ChevronRight className="w-4 h-4 text-slate-400 flex-none" />
              <span className="text-[14px] font-semibold text-slate-600">Choose different meals per passenger</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export { MEAL_OPTIONS };
