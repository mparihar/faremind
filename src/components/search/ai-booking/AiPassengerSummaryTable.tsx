// ═══════════════════════════════════════════════
// AiPassengerSummaryTable
// Compact table showing all passengers with masked
// passport numbers. Used after all pax are collected.
// ═══════════════════════════════════════════════

'use client';

import { Check, Pencil, Users } from 'lucide-react';
import type { AiPassengerData } from '@/lib/ai-booking-types';

interface Props {
  passengers: AiPassengerData[];
  onConfirm: () => void;
  onEdit: (index: number) => void;
}

function maskPassport(num: string): string {
  if (num.length <= 3) return num;
  return '•'.repeat(num.length - 2) + num.slice(-2);
}

export default function AiPassengerSummaryTable({ passengers, onConfirm, onEdit }: Props) {
  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Users className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-[14px] font-bold text-[#1ABC9C]">Passenger Summary</span>
        </div>
        <p className="text-[15px] text-white/90 leading-relaxed">
          Please review all traveler details:
        </p>
      </div>

      {/* Passenger cards */}
      <div className="space-y-1.5 px-0.5">
        {passengers.map((pax, i) => (
          <div
            key={i}
            className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200/80 p-2.5"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-bold text-[#1ABC9C]">
                Traveler {i + 1}
                {i === 0 && <span className="text-slate-400 font-normal ml-1">(Primary)</span>}
              </span>
              <button
                onClick={() => onEdit(i)}
                className="flex items-center gap-0.5 text-[12px] text-slate-400 hover:text-[#1ABC9C] transition-colors"
              >
                <Pencil className="w-2.5 h-2.5" />
                Edit
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px]">
              <div>
                <span className="text-slate-400">Name: </span>
                <span className="font-semibold text-slate-700">{pax.firstName}{pax.middleName ? ` ${pax.middleName}` : ''} {pax.lastName}</span>
              </div>
              <div>
                <span className="text-slate-400">Gender: </span>
                <span className="font-semibold text-slate-700 capitalize">{pax.gender}</span>
              </div>
              <div>
                <span className="text-slate-400">DOB: </span>
                <span className="font-semibold text-slate-700">{pax.dateOfBirth}</span>
              </div>
              <div>
                <span className="text-slate-400">Nationality: </span>
                <span className="font-semibold text-slate-700">{pax.nationality}</span>
              </div>
              <div>
                <span className="text-slate-400">Passport: </span>
                <span className="font-semibold text-slate-700">{maskPassport(pax.passportNumber)}</span>
              </div>
              <div>
                <span className="text-slate-400">Expiry: </span>
                <span className="font-semibold text-slate-700">{pax.passportExpiry}</span>
              </div>
              {i === 0 && (
                <>
                  <div className="col-span-2">
                    <span className="text-slate-400">Email: </span>
                    <span className="font-semibold text-slate-700">{pax.email}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-slate-400">Phone: </span>
                    <span className="font-semibold text-slate-700">{pax.phone}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 px-0.5">
        <button
          onClick={onConfirm}
          className="flex-1 py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-emerald-500 text-white text-[14px] font-bold transition-all shadow-md shadow-[#1ABC9C]/20 flex items-center justify-center gap-1"
        >
          <Check className="w-3.5 h-3.5" />
          Yes, continue
        </button>
      </div>
    </div>
  );
}
