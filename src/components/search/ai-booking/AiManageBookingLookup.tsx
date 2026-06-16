/**
 * AiManageBookingLookup — Guest PNR + Last Name lookup form
 * Compact form for the AI Bot manage-booking guest flow.
 */

'use client';

import { useState } from 'react';
import { Search, AlertCircle, Loader2 } from 'lucide-react';

interface Props {
  onFound: (pnr: string, lastName: string) => void;
  onSignIn: () => void;
  loading: boolean;
  error: string | null;
}

export default function AiManageBookingLookup({ onFound, onSignIn, loading, error }: Props) {
  const [pnr, setPnr] = useState('');
  const [lastName, setLastName] = useState('');

  const canSubmit = pnr.trim().length >= 3 && lastName.trim().length >= 2 && !loading;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onFound(pnr.trim().toUpperCase(), lastName.trim());
  };

  return (
    <div className="space-y-3">
      {/* Sign In Option */}
      <button
        onClick={onSignIn}
        className="w-full px-4 py-3 rounded-xl border border-[#1ABC9C]/30 bg-[#1ABC9C]/5 text-left transition-all hover:bg-[#1ABC9C]/10 hover:border-[#1ABC9C]/50 group"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-bold text-slate-700">Sign in to view your bookings</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Access all your bookings with your account</p>
          </div>
          <span className="text-[11px] font-bold text-[#1ABC9C] group-hover:translate-x-0.5 transition-transform">→</span>
        </div>
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">or</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* PNR Lookup Form */}
      <form onSubmit={handleSubmit} className="space-y-2.5">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
            Airline PNR or Reference Number
          </label>
          <input
            type="text"
            value={pnr}
            onChange={(e) => setPnr(e.target.value.toUpperCase())}
            placeholder="e.g. ABC123"
            maxLength={20}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-800 placeholder-slate-300 outline-none focus:border-[#1ABC9C]/60 focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all"
            autoFocus
          />
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
            Passenger Last Name
          </label>
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="e.g. Anderson"
            maxLength={50}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] font-semibold text-slate-800 placeholder-slate-300 outline-none focus:border-[#1ABC9C]/60 focus:ring-1 focus:ring-[#1ABC9C]/20 transition-all"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-600 leading-snug">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[12px] font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-[#1ABC9C] to-emerald-500 text-white shadow-md shadow-[#1ABC9C]/20 hover:shadow-lg hover:shadow-[#1ABC9C]/30 active:scale-[0.98]"
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Looking up booking…
            </>
          ) : (
            <>
              <Search className="w-3.5 h-3.5" />
              Find Booking
            </>
          )}
        </button>
      </form>
    </div>
  );
}
