// ═══════════════════════════════════════════════
// AiMultiPaxMealStep
// Meal selection for multiple passengers:
// same-for-all / per-passenger / skip
// Round-trip: asks outbound first, then return separately
// ═══════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { UtensilsCrossed, Check, ChevronRight, Plane } from 'lucide-react';

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

interface MealSelection {
  paxIndex: number;
  journey: 'outbound' | 'return';
  code: string;
}

interface Props {
  passengerCount: number;
  isRoundTrip: boolean;
  onComplete: (meals: MealSelection[]) => void;
}

type Phase = 'outbound_menu' | 'outbound_per_pax' | 'return_prompt' | 'return_menu' | 'return_per_pax';

export default function AiMultiPaxMealStep({ passengerCount, isRoundTrip, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('outbound_menu');
  const [outboundMeals, setOutboundMeals] = useState<string[]>(Array(passengerCount).fill(''));
  const [returnMeals, setReturnMeals] = useState<string[]>(Array(passengerCount).fill(''));
  const [currentPax, setCurrentPax] = useState(0);

  // ── Finalize: build all selections and call onComplete ──
  const finalize = (ob: string[], rt: string[]) => {
    const meals: MealSelection[] = [];
    ob.forEach((code, i) => meals.push({ paxIndex: i, journey: 'outbound', code }));
    rt.forEach((code, i) => meals.push({ paxIndex: i, journey: 'return', code }));
    onComplete(meals);
  };

  // ── After outbound is done, move to return or finish ──
  const afterOutbound = (ob: string[]) => {
    setOutboundMeals(ob);
    if (isRoundTrip) {
      setPhase('return_prompt');
      setCurrentPax(0);
    } else {
      finalize(ob, []);
    }
  };

  // ── Outbound: same for all ──
  const handleOutboundSameForAll = (code: string) => {
    const ob = Array(passengerCount).fill(code);
    afterOutbound(ob);
  };

  // ── Outbound: per-pax selection ──
  const handleOutboundPerPax = (code: string) => {
    const next = [...outboundMeals];
    next[currentPax] = code;
    setOutboundMeals(next);

    if (currentPax < passengerCount - 1) {
      setCurrentPax(currentPax + 1);
    } else {
      afterOutbound(next);
    }
  };

  // ── Return: same as outbound ──
  const handleReturnSameAsOutbound = () => {
    finalize(outboundMeals, [...outboundMeals]);
  };

  // ── Return: same for all ──
  const handleReturnSameForAll = (code: string) => {
    const rt = Array(passengerCount).fill(code);
    finalize(outboundMeals, rt);
  };

  // ── Return: per-pax selection ──
  const handleReturnPerPax = (code: string) => {
    const next = [...returnMeals];
    next[currentPax] = code;
    setReturnMeals(next);

    if (currentPax < passengerCount - 1) {
      setCurrentPax(currentPax + 1);
    } else {
      finalize(outboundMeals, next);
    }
  };

  // ── Journey label helper ──
  const journeyLabel = phase.startsWith('return') ? 'Return Flight' : 'Outbound Flight';
  const journeyIcon = phase.startsWith('return') ? '↩️' : '✈️';

  // ═══ Return Prompt: Same as outbound or choose new ═══
  if (phase === 'return_prompt') {
    const obLabel = (() => {
      const unique = [...new Set(outboundMeals)];
      if (unique.length === 1) {
        const meal = MEAL_OPTIONS.find(m => m.code === unique[0]);
        return meal ? `${meal.emoji} ${meal.label}` : unique[0];
      }
      return 'mixed selections';
    })();

    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Plane className="w-4 h-4 text-[#1ABC9C] rotate-180" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">Return Flight Meal</span>
          </div>
          <p className="text-[15px] text-white/90">
            Outbound: <span className="font-semibold text-white">{obLabel}</span>
          </p>
          <p className="text-[13px] text-white/60 mt-0.5">
            Same meal for the return flight, or choose different?
          </p>
        </div>

        <div className="space-y-1.5 px-0.5">
          <button
            onClick={handleReturnSameAsOutbound}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[#1ABC9C]/10 border border-[#1ABC9C]/30 hover:bg-[#1ABC9C]/20 transition-all text-left"
          >
            <Check className="w-4 h-4 text-[#1ABC9C] flex-none" />
            <span className="text-[14px] font-semibold text-[#0F766E]">Same as outbound</span>
          </button>

          <button
            onClick={() => { setCurrentPax(0); setPhase('return_menu'); }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 transition-all text-left"
          >
            <ChevronRight className="w-4 h-4 text-slate-400 flex-none" />
            <span className="text-[14px] font-semibold text-slate-600">Choose different meal for return</span>
          </button>
        </div>
      </div>
    );
  }

  // ═══ Per-pax meal selector (outbound or return) ═══
  if (phase === 'outbound_per_pax' || phase === 'return_per_pax') {
    const handler = phase === 'outbound_per_pax' ? handleOutboundPerPax : handleReturnPerPax;

    return (
      <div className="space-y-2.5">
        <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <UtensilsCrossed className="w-4 h-4 text-[#1ABC9C]" />
            <span className="text-[14px] font-bold text-[#1ABC9C]">{journeyIcon} {journeyLabel} — Traveler {currentPax + 1}</span>
          </div>
          <p className="text-[15px] text-white/90">
            Select meal for Traveler {currentPax + 1} of {passengerCount}:
          </p>
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
              onClick={() => handler(meal.code)}
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

  // ═══ Menu: same for all / per pax / skip (outbound or return) ═══
  const isSameForAllHandler = phase === 'outbound_menu' ? handleOutboundSameForAll : handleReturnSameForAll;
  const perPaxPhase: Phase = phase === 'outbound_menu' ? 'outbound_per_pax' : 'return_per_pax';

  return (
    <div className="space-y-2.5">
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <UtensilsCrossed className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">
            {isRoundTrip ? `${journeyIcon} ${journeyLabel} — Meal` : 'Meal Preference'}
          </span>
        </div>
        <p className="text-[15px] text-white/90">
          {isRoundTrip
            ? `Select meal for your ${phase === 'return_menu' ? 'return' : 'outbound'} flight 🍽️`
            : 'What meal would you like on board? 🍽️'
          }
        </p>
      </div>

      <div className="space-y-1.5 px-0.5">
        <div className="grid grid-cols-2 gap-1.5">
          {MEAL_OPTIONS.map((meal, idx) => (
            <button
              key={meal.code}
              onClick={() => isSameForAllHandler(meal.code)}
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

        {passengerCount > 1 && (
          <>
            <div className="text-[12px] text-slate-400 text-center py-1">
              ↑ Same meal for all {passengerCount} passengers · or ↓
            </div>

            <button
              onClick={() => { setCurrentPax(0); setPhase(perPaxPhase); }}
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
