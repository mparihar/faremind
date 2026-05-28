// ═══════════════════════════════════════════════
// AiPassengerDetailCollector
// Conversational field-by-field passenger data
// collection inside the AI booking chatbot.
// ═══════════════════════════════════════════════

'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, AlertCircle, User, ChevronRight, ChevronLeft } from 'lucide-react';
import type { AiPassengerData } from '@/lib/ai-booking-types';
import { PASSENGER_FIELD_ORDER, PASSENGER_FIELD_LABELS, SECONDARY_PASSENGER_FIELDS, COUNTRIES } from '@/lib/ai-booking-types';

// ─── Validation ───────────────────────────────────────────────────────────────

function validateField(field: keyof AiPassengerData, value: string): string | null {
  switch (field) {
    case 'firstName':
    case 'lastName':
      return value.trim() ? null : `${PASSENGER_FIELD_LABELS[field]} is required`;

    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Please enter a valid email address';

    case 'phone':
      return value.trim().length >= 5 ? null : 'Please enter a valid phone number';

    case 'gender':
      return ['male', 'female', 'other'].includes(value.toLowerCase())
        ? null
        : 'Enter: male, female, or other';

    case 'dateOfBirth': {
      const d = new Date(value);
      if (isNaN(d.getTime())) return 'Enter date as MM/DD/YYYY';
      if (d > new Date()) return 'Date cannot be in the future';
      if (d.getFullYear() < 1900) return 'Please enter a valid year';
      return null;
    }

    case 'nationality':
    case 'passportCountry':
      return value.trim().length >= 2 ? null : 'Please enter a valid country or nationality';

    case 'passportNumber':
      return value.trim().length >= 5 ? null : 'Enter a valid passport number';

    case 'passportExpiry': {
      const exp = new Date(value);
      if (isNaN(exp.getTime())) return 'Enter date as MM/DD/YYYY';
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (exp < today) return 'Passport is expired';
      const sixMonths = new Date(today);
      sixMonths.setMonth(sixMonths.getMonth() + 6);
      if (exp < sixMonths) return 'Must be valid for at least 6 months';
      return null;
    }

    default:
      return null;
  }
}

function normalizeField(field: keyof AiPassengerData, value: string): string {
  switch (field) {
    case 'gender':
      return value.toLowerCase().trim() as string;
    case 'passportNumber':
      return value.toUpperCase().trim();
    case 'nationality':
    case 'passportCountry': {
      // Capitalize first letter of each word
      return value.trim().replace(/\b\w/g, c => c.toUpperCase());
    }
    default:
      return value.trim();
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  passenger: AiPassengerData;
  passengerIndex?: number;      // 0-based
  passengerLabel?: string;      // e.g. "Traveler 1"
  passengerCount?: number;      // total count
  fieldOrder?: (keyof AiPassengerData)[];
  onFieldUpdate: (field: keyof AiPassengerData, value: string) => void;
  onComplete: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AiPassengerDetailCollector({
  passenger,
  passengerIndex = 0,
  passengerLabel,
  passengerCount = 1,
  fieldOrder,
  onFieldUpdate,
  onComplete,
}: Props) {
  const fields = fieldOrder ?? PASSENGER_FIELD_ORDER;
  const [currentFieldIdx, setCurrentFieldIdx] = useState(0);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [completedFields, setCompletedFields] = useState<Map<keyof AiPassengerData, string>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const currentField = fields[currentFieldIdx] as keyof AiPassengerData | undefined;
  const isAllDone = currentFieldIdx >= fields.length;

  useEffect(() => {
    if (inputRef.current && !isAllDone) {
      inputRef.current.focus();
    }
  }, [currentFieldIdx, isAllDone]);

  const handleSubmitField = () => {
    if (!currentField) return;

    const normalized = normalizeField(currentField, inputValue);
    const err = validateField(currentField, normalized);

    if (err) {
      setError(err);
      return;
    }

    setError(null);
    onFieldUpdate(currentField, normalized);
    setCompletedFields(prev => new Map(prev).set(currentField, normalized));
    setInputValue('');
    setCurrentFieldIdx(prev => prev + 1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmitField();
    }
  };

  const handleGoBack = () => {
    if (currentFieldIdx <= 0) return;
    const prevIdx = currentFieldIdx - 1;
    const prevField = fields[prevIdx] as keyof AiPassengerData;
    const prevValue = completedFields.get(prevField) ?? '';

    // Remove previous field from completed
    setCompletedFields(prev => {
      const next = new Map(prev);
      next.delete(prevField);
      return next;
    });

    setCurrentFieldIdx(prevIdx);
    setInputValue(prevValue);
    setError(null);
  };

  // ── Render completed summary ────────────────────────────────────────────────
  if (isAllDone) {
    return (
      <div className="space-y-3">
        {/* Summary card */}
        <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-emerald-200 p-3">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-600" strokeWidth={3} />
            </div>
            <span className="text-[15px] font-bold text-emerald-700">Passenger details confirmed</span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {fields.map(field => {
              const val = completedFields.get(field) ?? passenger[field];
              if (!val) return null;
              const display = field === 'passportNumber'
                ? `${val.slice(0, 2)}${'•'.repeat(Math.max(0, val.length - 4))}${val.slice(-2)}`
                : val;
              return (
                <div key={field} className="py-0.5">
                  <p className="text-[12px] text-slate-400 uppercase tracking-wider font-medium">
                    {PASSENGER_FIELD_LABELS[field].split(' (')[0]}
                  </p>
                  <p className="text-[14px] text-slate-700 font-semibold truncate">{display}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Continue button */}
        <button
          onClick={onComplete}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[15px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20"
        >
          Continue
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ── Render current field prompt ─────────────────────────────────────────────
  const progress = Math.round((currentFieldIdx / PASSENGER_FIELD_ORDER.length) * 100);

  return (
    <div className="space-y-2.5">
      {/* Progress bar */}
      <div className="flex items-center gap-2 px-1">
        <div className="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#1ABC9C] to-emerald-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[13px] text-slate-400 font-medium flex-none">
          {currentFieldIdx + 1}/{PASSENGER_FIELD_ORDER.length}
        </span>
      </div>

      {/* Completed fields (collapsed) */}
      {completedFields.size > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {Array.from(completedFields.entries()).map(([field, val]) => (
            <span key={field} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200/50">
              <Check className="w-2.5 h-2.5 text-emerald-500" strokeWidth={3} />
              <span className="text-[12px] text-emerald-700 font-medium truncate max-w-[90px]">
                {field === 'passportNumber' ? '•••' + val.slice(-3) : val}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Question prompt */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <User className="w-3.5 h-3.5 text-[#1ABC9C]" />
          <span className="text-[13px] font-bold text-[#1ABC9C]">Passenger Info</span>
        </div>
        <p className="text-[15px] text-white/90 leading-relaxed">
          Please enter your <span className="font-bold text-white">{PASSENGER_FIELD_LABELS[currentField]}</span>:
        </p>
        {currentField === 'gender' && (
          <p className="text-[13px] text-white/50 mt-0.5">Type: male, female, or other</p>
        )}
        {(currentField === 'nationality' || currentField === 'passportCountry') && (
          <p className="text-[13px] text-white/50 mt-0.5">
            e.g. India, United States, Germany…
          </p>
        )}
        {(currentField === 'dateOfBirth' || currentField === 'passportExpiry') && (
          <p className="text-[13px] text-white/50 mt-0.5">Format: MM/DD/YYYY</p>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-1.5 px-1">
        {currentFieldIdx > 0 && (
          <button
            onClick={handleGoBack}
            className="flex-none w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 flex items-center justify-center transition-all"
            title="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <input
          ref={inputRef}
          type={
            currentField === 'email' ? 'email' :
            currentField === 'phone' ? 'tel' :
            (currentField === 'dateOfBirth' || currentField === 'passportExpiry') ? 'date' :
            'text'
          }
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          placeholder={PASSENGER_FIELD_LABELS[currentField]}
          className="flex-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 text-[15px] placeholder-slate-400 focus:outline-none focus:border-[#1ABC9C]/50 transition-colors min-w-0"
        />
        <button
          onClick={handleSubmitField}
          disabled={!inputValue.trim()}
          className="flex-none w-8 h-8 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-50 border border-red-200 rounded-lg mx-1">
          <AlertCircle className="w-3 h-3 text-red-500 flex-none" />
          <span className="text-[14px] text-red-600">{error}</span>
        </div>
      )}
    </div>
  );
}
