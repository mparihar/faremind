// ═══════════════════════════════════════════════
// AiSeatPreferenceCollector
// Two-step seat preference collection:
// Step 1 — Position (front/middle/rear/restroom)
// Step 2 — Type (window/aisle/middle/any)
// ═══════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Armchair } from 'lucide-react';
import type { AiSeatPosition, AiSeatType, AiSeatPreference } from '@/lib/ai-booking-types';

// ─── Options ──────────────────────────────────────────────────────────────────

const POSITION_OPTIONS: { value: AiSeatPosition; label: string; emoji: string }[] = [
  { value: 'front',              label: 'Front of plane',        emoji: '🛫' },
  { value: 'middle_plane',      label: 'Middle of plane',       emoji: '✈️' },
  { value: 'rear',              label: 'Rear of plane',         emoji: '🛬' },
  { value: 'near_restroom',     label: 'Near restroom',         emoji: '🚻' },
  { value: 'away_from_restroom', label: 'Away from restroom',   emoji: '🔇' },
  { value: 'any',               label: 'Any best available',    emoji: '🎲' },
];

const TYPE_OPTIONS: { value: AiSeatType; label: string; emoji: string }[] = [
  { value: 'window', label: 'Window seat',         emoji: '🪟' },
  { value: 'aisle',  label: 'Aisle seat',          emoji: '🚶' },
  { value: 'middle', label: 'Middle seat',         emoji: '👤' },
  { value: 'any',    label: 'Any best available',  emoji: '🎲' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onComplete: (pref: AiSeatPreference) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiSeatPreferenceCollector({ onComplete }: Props) {
  const [step, setStep] = useState<'position' | 'type'>('position');
  const [position, setPosition] = useState<AiSeatPosition | null>(null);

  const handlePositionSelect = (pos: AiSeatPosition) => {
    setPosition(pos);
    setStep('type');
  };

  const handleTypeSelect = (type: AiSeatType) => {
    onComplete({ position: position!, type });
  };

  const options = step === 'position' ? POSITION_OPTIONS : TYPE_OPTIONS;
  const title = step === 'position' ? 'Where would you like to sit?' : 'Which seat type do you prefer?';
  const subtitle = step === 'position' ? 'Select your preferred position' : 'Select your seat type';

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Armchair className="w-3 h-3 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-[#1ABC9C]">Seat Preference</span>
          {step === 'type' && (
            <span className="text-[11px] text-white/40 ml-auto">Step 2/2</span>
          )}
        </div>
        <p className="text-[13px] text-white/90 leading-relaxed">{title}</p>
        <p className="text-[11px] text-white/40 mt-0.5">{subtitle}</p>
      </div>

      {/* Selected position badge (when on step 2) */}
      {step === 'type' && position && (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg mx-1">
          <span className="text-[12px]">{POSITION_OPTIONS.find(p => p.value === position)?.emoji}</span>
          <span className="text-[11px] text-emerald-700 font-semibold">
            Position: {POSITION_OPTIONS.find(p => p.value === position)?.label}
          </span>
        </div>
      )}

      {/* Options */}
      <div className="grid grid-cols-2 gap-1.5 px-0.5">
        {options.map((opt, idx) => (
          <button
            key={opt.value}
            onClick={() => step === 'position' ? handlePositionSelect(opt.value as AiSeatPosition) : handleTypeSelect(opt.value as AiSeatType)}
            className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/90 border border-slate-200/80 hover:border-[#1ABC9C]/40 hover:shadow-sm transition-all text-left group"
          >
            <span className="text-sm flex-none">{opt.emoji}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-black text-[#1ABC9C] bg-[#1ABC9C]/10 w-4 h-4 rounded-full flex items-center justify-center flex-none">
                  {idx + 1}
                </span>
                <span className="text-[12px] font-semibold text-slate-700 group-hover:text-slate-900 truncate leading-tight">
                  {opt.label}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Instruction */}
      <p className="text-[12px] text-slate-400 text-center px-1">
        <span className="font-bold text-[#1ABC9C]">Tap</span> or type{' '}
        <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-[11px]">1–{options.length}</span>
      </p>
    </div>
  );
}
