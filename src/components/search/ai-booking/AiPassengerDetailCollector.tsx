// ═══════════════════════════════════════════════
// AiPassengerDetailCollector
// Conversational field-by-field passenger data
// collection inside the AI booking chatbot.
// ═══════════════════════════════════════════════

'use client';

import { useState, useRef, useEffect } from 'react';
import { Check, AlertCircle, User, ChevronRight, ChevronLeft, Mic } from 'lucide-react';
import type { AiPassengerData } from '@/lib/ai-booking-types';
import { PASSENGER_FIELD_ORDER, PASSENGER_FIELD_LABELS, SECONDARY_PASSENGER_FIELDS, COUNTRIES } from '@/lib/ai-booking-types';
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
} from '@/services/speechRecognitionService';

// ─── Validation ───────────────────────────────────────────────────────────────

function validateField(field: keyof AiPassengerData, value: string, passengerType?: 'adult' | 'child' | 'infant'): string | null {
  switch (field) {
    case 'firstName':
    case 'lastName':
      return value.trim() ? null : `${PASSENGER_FIELD_LABELS[field]} is required`;

    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Please enter a valid email address';

    case 'phone': {
      // Strip all non-digit characters (except leading +)
      const cleaned = value.trim().replace(/[^\d+]/g, '');
      const digits = cleaned.replace(/\D/g, '');
      
      if (digits.length < 10) {
        return 'Enter a valid phone number (10+ digits, e.g. 9725671234)';
      }
      if (digits.length > 15) {
        return 'Phone number is too long (max 15 digits)';
      }
      return null;
    }

    case 'gender':
      return ['male', 'female', 'other'].includes(value.toLowerCase())
        ? null
        : 'Enter: male, female, or other';

    case 'dateOfBirth': {
      const d = new Date(value);
      if (isNaN(d.getTime())) return 'Enter date as MM/DD/YYYY';
      if (d > new Date()) return 'Date cannot be in the future';
      if (d.getFullYear() < 1900) return 'Please enter a valid year';

      // Age-based validation for child and infant passengers
      if (passengerType === 'infant' || passengerType === 'child') {
        const today = new Date();
        let age = today.getFullYear() - d.getFullYear();
        const monthDiff = today.getMonth() - d.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) {
          age--;
        }

        if (passengerType === 'infant' && age >= 2) {
          return 'Infant must be under 2 years old at the time of travel';
        }
        if (passengerType === 'child' && (age < 2 || age > 11)) {
          return 'Child must be between 2 and 11 years old';
        }
      }

      if (passengerType === 'adult') {
        const today = new Date();
        let age = today.getFullYear() - d.getFullYear();
        const monthDiff = today.getMonth() - d.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < d.getDate())) {
          age--;
        }
        if (age < 12) {
          return 'Adult passenger must be at least 12 years old';
        }
      }

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

/**
 * Normalize phone number to E.164 format for Duffel/provider compatibility.
 * 10 digits → US (+1XXXXXXXXXX)
 * 11 digits starting with 1 → US (+1XXXXXXXXXX)
 * Otherwise → +{digits}
 */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 10) return `+${digits}`;
  if (digits.length >= 10) return `+${digits}`;
  return raw.trim(); // fallback — validation should catch invalid
}

function normalizeField(field: keyof AiPassengerData, value: string): string {
  switch (field) {
    case 'gender':
      return value.toLowerCase().trim() as string;
    case 'passportNumber':
      return value.toUpperCase().trim();
    case 'phone':
      return normalizePhone(value);
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
  passengerType?: 'adult' | 'child' | 'infant';  // for age validation
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
  passengerType = 'adult',
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
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported] = useState(() => typeof window !== 'undefined' && isSpeechRecognitionSupported());

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
    const err = validateField(currentField, normalized, passengerType);

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
        {currentField === 'phone' && (
          <p className="text-[13px] text-white/50 mt-0.5">Enter +country code followed by number (e.g. +1 9725671234)</p>
        )}
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
        {/* Animated voice button */}
        {voiceSupported && (
          <button
            onClick={async () => {
              if (isRecording) {
                stopListening();
                setIsRecording(false);
                return;
              }
              // Clear previous input before starting voice
              setInputValue('');
              setError(null);
              setIsRecording(true);
              try {
                const result = await startListening((interim) => {
                  setInputValue(interim);
                  setError(null);
                }, { singleShot: true });
                setIsRecording(false);
                if (result.transcript.trim()) {
                  setInputValue(result.transcript.trim());
                  setError(null);
                }
              } catch {
                setIsRecording(false);
              }
            }}
            title={isRecording ? 'Stop recording' : 'Voice input'}
            className={`flex-none w-8 h-8 rounded-full flex items-center justify-center transition-all relative ${
              isRecording
                ? 'text-red-500 ring-2 ring-red-400/40 bg-red-50'
                : 'text-slate-400 hover:text-[#1ABC9C] cursor-pointer'
            }`}
          >
            {isRecording ? (
              <Mic className="w-4 h-4 animate-pulse" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="relative z-10">
                <rect x="3" y="9" width="2" height="6" rx="1" fill="currentColor">
                  <animate attributeName="height" values="6;10;6" dur="1.2s" repeatCount="indefinite" />
                  <animate attributeName="y" values="9;7;9" dur="1.2s" repeatCount="indefinite" />
                </rect>
                <rect x="7.5" y="7" width="2" height="10" rx="1" fill="currentColor">
                  <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
                  <animate attributeName="y" values="7;10;7" dur="0.9s" repeatCount="indefinite" />
                </rect>
                <rect x="12" y="5" width="2" height="14" rx="1" fill="currentColor">
                  <animate attributeName="height" values="14;6;14" dur="1.1s" repeatCount="indefinite" />
                  <animate attributeName="y" values="5;9;5" dur="1.1s" repeatCount="indefinite" />
                </rect>
                <rect x="16.5" y="8" width="2" height="8" rx="1" fill="currentColor">
                  <animate attributeName="height" values="8;14;8" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="y" values="8;5;8" dur="1.4s" repeatCount="indefinite" />
                </rect>
                <rect x="21" y="10" width="2" height="4" rx="1" fill="currentColor">
                  <animate attributeName="height" values="4;10;4" dur="0.8s" repeatCount="indefinite" />
                  <animate attributeName="y" values="10;7;10" dur="0.8s" repeatCount="indefinite" />
                </rect>
              </svg>
            )}
          </button>
        )}
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
