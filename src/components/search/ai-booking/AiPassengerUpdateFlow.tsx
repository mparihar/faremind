/**
 * AiPassengerUpdateFlow — Passenger update sub-flow inside the AI Bot.
 * Select passenger → select fields → enter values → review → submit.
 */

'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Edit3, Check, XCircle, Loader2, ArrowLeft, Lock,
  Mail, Shield, ChevronRight, Info,
} from 'lucide-react';
import { useManageBookingStore } from '@/store/useManageBookingStore';
import {
  maskPassport,
  fmtCurrency,
  EDITABLE_PASSENGER_FIELDS,
  NON_EDITABLE_FIELDS,
} from '@/lib/ai-manage-booking-utils';

interface Props {
  bookingId: string;
  bookingReference: string;
  pnrCode: string | undefined;
  passengers: any[];
  onBack: () => void;
  onDone: () => void;
}

type UpdateStep =
  | 'select_passenger'
  | 'select_fields'
  | 'collect_data'
  | 'review'
  | 'submitting'
  | 'success'
  | 'failure';

export default function AiPassengerUpdateFlow({
  bookingId,
  bookingReference,
  pnrCode,
  passengers,
  onBack,
  onDone,
}: Props) {
  const store = useManageBookingStore();
  const [step, setStep] = useState<UpdateStep>('select_passenger');
  const [selectedPax, setSelectedPax] = useState<any>(null);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // ── Select Passenger ───────────────────────────────────────────────────────
  const handleSelectPassenger = (pax: any) => {
    setSelectedPax(pax);
    setSelectedFields([]);
    setFieldValues({});
    setStep('select_fields');
  };

  // ── Select Fields ──────────────────────────────────────────────────────────
  const toggleField = (key: string) => {
    setSelectedFields((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
    );
  };

  const handleFieldsConfirm = () => {
    if (selectedFields.length === 0) return;
    // Pre-populate with current values
    const initial: Record<string, string> = {};
    selectedFields.forEach((key) => {
      initial[key] = selectedPax?.[key] ?? '';
    });
    setFieldValues(initial);
    setStep('collect_data');
  };

  // ── Collect Data ───────────────────────────────────────────────────────────
  const handleDataChange = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const canReview = selectedFields.every((key) => fieldValues[key]?.trim());

  const handleReview = () => {
    if (!canReview) return;
    setStep('review');
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setStep('submitting');
    setError(null);
    try {
      const success = await store.updatePassenger(bookingId, selectedPax.id, fieldValues);
      if (success) {
        setStep('success');
      } else {
        setError('The airline/provider did not accept this update online.');
        setStep('failure');
      }
    } catch (e: any) {
      setError(e.message || 'Update could not be completed.');
      setStep('failure');
    }
  };

  const paxName = selectedPax ? `${selectedPax.firstName} ${selectedPax.lastName}` : '';

  // ── Render: Select Passenger ───────────────────────────────────────────────
  if (step === 'select_passenger') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2.5"
      >
        <p className="text-[11px] font-semibold text-slate-500 px-1">Select a passenger to update:</p>

        {passengers.map((pax, idx) => (
          <motion.button
            key={pax.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.06 }}
            onClick={() => handleSelectPassenger(pax)}
            className="w-full text-left px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-[#1ABC9C]/40 hover:bg-[#1ABC9C]/5 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#1ABC9C]/10 flex items-center justify-center">
                  <User className="w-3.5 h-3.5 text-[#1ABC9C]" />
                </div>
                <div>
                  <p className="text-[12px] font-bold text-slate-800">
                    {pax.firstName} {pax.lastName}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="capitalize">{(pax.passengerType || 'adult').toLowerCase()}</span>
                    {pax.ticketNumber && (
                      <>
                        <span>·</span>
                        <span className="text-[#1ABC9C] font-medium">Ticket: Confirmed</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#1ABC9C] transition-colors" />
            </div>
          </motion.button>
        ))}

        <button
          onClick={onBack}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold text-slate-500 hover:bg-slate-100 transition-all"
        >
          <ArrowLeft className="w-3 h-3" />
          Back
        </button>
      </motion.div>
    );
  }

  // ── Render: Select Fields ──────────────────────────────────────────────────
  if (step === 'select_fields') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2.5"
      >
        <div className="flex items-center gap-2 px-1">
          <User className="w-3.5 h-3.5 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-slate-800">{paxName}</span>
        </div>

        <p className="text-[11px] text-slate-500 px-1">What would you like to update?</p>

        {/* Editable fields */}
        <div className="space-y-1.5">
          {EDITABLE_PASSENGER_FIELDS.map((field) => {
            const isSelected = selectedFields.includes(field.key);
            const currentValue = selectedPax?.[field.key];
            const displayValue = field.key === 'passportNumber' ? maskPassport(currentValue) : currentValue;

            return (
              <button
                key={field.key}
                onClick={() => toggleField(field.key)}
                className={`w-full text-left px-3 py-2 rounded-lg border transition-all flex items-center justify-between ${
                  isSelected
                    ? 'border-[#1ABC9C]/50 bg-[#1ABC9C]/5'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                    isSelected ? 'border-[#1ABC9C] bg-[#1ABC9C]' : 'border-slate-300'
                  }`}>
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className="text-[11px] font-semibold text-slate-700">{field.label}</span>
                </div>
                {displayValue && (
                  <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{displayValue}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Non-editable notice */}
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
          <Lock className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-semibold text-slate-500 mb-0.5">
              Identity fields cannot be edited directly after booking.
            </p>
            <p className="text-[9px] text-slate-400">
              {NON_EDITABLE_FIELDS.join(', ')}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => setStep('select_passenger')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <button
            onClick={handleFieldsConfirm}
            disabled={selectedFields.length === 0}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-[#1ABC9C] to-emerald-500 shadow-md shadow-[#1ABC9C]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            Continue
          </button>
        </div>
      </motion.div>
    );
  }

  // ── Render: Collect Data ───────────────────────────────────────────────────
  if (step === 'collect_data') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="flex items-center gap-2 px-1">
          <Edit3 className="w-3.5 h-3.5 text-[#1ABC9C]" />
          <span className="text-[12px] font-bold text-slate-800">Update: {paxName}</span>
        </div>

        <div className="space-y-2.5">
          {selectedFields.map((key) => {
            const field = EDITABLE_PASSENGER_FIELDS.find((f) => f.key === key)!;
            return (
              <div key={key}>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
                  New {field.label}
                </label>
                <input
                  type={field.type || 'text'}
                  value={fieldValues[key] || ''}
                  onChange={(e) => handleDataChange(key, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-800 placeholder-slate-300 outline-none focus:border-[#1ABC9C]/60 focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all"
                />
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setStep('select_fields')}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
          >
            <ArrowLeft className="w-3 h-3" />
            Back
          </button>
          <button
            onClick={handleReview}
            disabled={!canReview}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-[#1ABC9C] to-emerald-500 shadow-md shadow-[#1ABC9C]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            Review Update
          </button>
        </div>
      </motion.div>
    );
  }

  // ── Render: Review ─────────────────────────────────────────────────────────
  if (step === 'review' || step === 'submitting') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="flex items-center gap-2 px-1">
          <Edit3 className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[13px] font-bold text-slate-800">Passenger Update Review</span>
        </div>

        <div className="px-3 py-3 rounded-xl border border-slate-200 bg-white space-y-2">
          <InfoRow label="Passenger" value={paxName} bold />

          <div className="pt-1.5 border-t border-slate-100">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Fields to Update</p>
            {selectedFields.map((key) => {
              const field = EDITABLE_PASSENGER_FIELDS.find((f) => f.key === key)!;
              const val = key === 'passportNumber' ? maskPassport(fieldValues[key]) : fieldValues[key];
              return (
                <div key={key} className="flex justify-between text-[11px] py-0.5">
                  <span className="text-slate-500">{field.label}</span>
                  <span className="font-semibold text-slate-700">{val}</span>
                </div>
              );
            })}
          </div>

          <div className="pt-1.5 border-t border-slate-100">
            <InfoRow label="FareMind Reference" value={bookingReference} />
            {pnrCode && <InfoRow label="Airline PNR" value={pnrCode} />}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setStep('collect_data')}
            disabled={step === 'submitting'}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={step === 'submitting'}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-[#1ABC9C] to-emerald-500 shadow-md shadow-[#1ABC9C]/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {step === 'submitting' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Updating…
              </>
            ) : (
              'Submit Update'
            )}
          </button>
        </div>
      </motion.div>
    );
  }

  // ── Render: Success ────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="px-4 py-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-[13px] font-bold text-emerald-700">
              Passenger Information Updated
            </span>
          </div>

          <div className="space-y-2 bg-white rounded-lg border border-emerald-200/50 px-3 py-2.5">
            <InfoRow label="Passenger" value={paxName} bold />
            <div className="pt-1.5 border-t border-slate-100">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Updated Information</p>
              {selectedFields.map((key) => {
                const field = EDITABLE_PASSENGER_FIELDS.find((f) => f.key === key)!;
                return (
                  <p key={key} className="text-[11px] text-emerald-600 font-medium">
                    ✓ {field.label}
                  </p>
                );
              })}
            </div>
            <div className="pt-1.5 border-t border-slate-100">
              <InfoRow label="FareMind Reference" value={bookingReference} />
              {pnrCode && <InfoRow label="Airline PNR" value={pnrCode} />}
              <InfoRow label="Status" value="Updated with provider" highlight />
            </div>
          </div>

          <div className="flex items-center gap-2 px-1">
            <Mail className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] text-emerald-600 font-medium">
              Email confirmation has been sent.
            </span>
          </div>
        </div>

        <button
          onClick={onDone}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-bold text-white bg-gradient-to-r from-[#1ABC9C] to-emerald-500 shadow-md shadow-[#1ABC9C]/20 transition-all active:scale-[0.98]"
        >
          Done
        </button>
      </motion.div>
    );
  }

  // ── Render: Failure ────────────────────────────────────────────────────────
  if (step === 'failure') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="px-4 py-4 rounded-xl border border-red-200 bg-red-50/50 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-[13px] font-bold text-red-700">
              Passenger Update Could Not Be Completed
            </span>
          </div>

          <div className="space-y-1.5 px-1">
            <div className="flex items-start gap-2">
              <Info className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-red-600 leading-snug">
                {error || 'The airline/provider did not accept this update online.'}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-red-600 leading-snug">
                Please contact FareMind Support.
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={onBack}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Booking
        </button>
      </motion.div>
    );
  }

  return null;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function InfoRow({ label, value, bold, highlight }: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-start text-[11px]">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className={`text-right ${bold ? 'font-bold text-slate-800' : highlight ? 'font-bold text-[#1ABC9C]' : 'font-semibold text-slate-600'}`}>
        {value}
      </span>
    </div>
  );
}
