'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Search, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * Find the booking a servicing request applies to.
 *
 * There are two codes a person actually holds:
 *
 *   FareMind reference   FM9IPA4E     printed on our confirmation and emails
 *   Airline PNR          EOROKA       what the airline and the boarding pass show
 *
 * Either one finds the booking; both together are cross-checked and rejected if
 * they disagree. Mystifly's reference is not asked for and not displayed — the
 * backend maps to it from whichever code was entered.
 *
 * Shared by the agent and admin consoles so the two cannot drift; they differ
 * only in which authenticated endpoint `resolve` posts to.
 */

export interface ServicingTarget {
  bookingId: string;
  fareMindRef: string;
  airlinePnr: string | null;
  route: string | null;
  departureDate: string | null;
  passengerCount: number;
  bookingStatus: string;
  ticketingStatus: string | null;
  paymentStatus: string | null;
  provider: string | null;
  serviceable: boolean;
  matchedBy: string;
}

const keyOf = (ref: string, pnr: string) =>
  `${ref.trim().toUpperCase()}|${pnr.trim().toUpperCase()}`;

export default function BookingFinder({
  resolve,
  target,
  onTarget,
  initialReference = '',
  initialAirlinePnr = '',
}: {
  /** POSTs { reference, airlinePnr } to the console's own authenticated resolver. */
  resolve: (body: { reference: string; airlinePnr: string }) => Promise<Response>;
  target: ServicingTarget | null;
  onTarget: (t: ServicingTarget | null) => void;
  initialReference?: string;
  initialAirlinePnr?: string;
}) {
  const [reference, setReference] = useState(initialReference);
  const [airlinePnr, setAirlinePnr] = useState(initialAirlinePnr);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The codes the current target was resolved from. Editing either one away from
  // these drops the target, so a quote can never be executed against a booking
  // other than the one on screen.
  const resolvedFor = useRef<string>('');

  useEffect(() => {
    if (keyOf(reference, airlinePnr) !== resolvedFor.current) {
      onTarget(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, airlinePnr]);

  async function find() {
    const ref = reference.trim();
    const pnr = airlinePnr.trim();
    if (!ref && !pnr) {
      setError('Enter the FareMind reference or the airline PNR.');
      return;
    }
    setLoading(true);
    setError(null);
    onTarget(null);
    try {
      const res = await resolve({ reference: ref, airlinePnr: pnr });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `Lookup failed (HTTP ${res.status})`);
      } else {
        const found: ServicingTarget = data.booking;
        // Show the codes exactly as the booking holds them, and remember that
        // pair so the effect above does not immediately clear what we just found.
        const nextPnr = found.airlinePnr || pnr;
        resolvedFor.current = keyOf(found.fareMindRef, nextPnr);
        setReference(found.fareMindRef);
        setAirlinePnr(nextPnr);
        onTarget(found);
      }
    } catch (e: any) {
      setError(e?.message || 'Lookup failed');
    }
    setLoading(false);
  }

  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); find(); }
  };

  const inputClass =
    'w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm font-mono tracking-wide uppercase placeholder:normal-case placeholder:tracking-normal focus:outline-none focus:border-[#1ABC9C]';

  return (
    <div className="space-y-3 mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
            FM Ref
          </label>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={onEnter}
            placeholder="e.g. FM9IPA4E"
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">
            Airline PNR
          </label>
          <input
            value={airlinePnr}
            onChange={(e) => setAirlinePnr(e.target.value)}
            onKeyDown={onEnter}
            placeholder="e.g. EOROKA"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={find}
          disabled={loading || (!reference.trim() && !airlinePnr.trim())}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1ABC9C]/15 border border-[#1ABC9C]/20 text-[#1ABC9C] text-sm font-bold hover:bg-[#1ABC9C]/25 disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find Booking
        </button>
        <p className="text-[11px] text-slate-500">
          Enter either code — or both. The Mystifly reference is not a search field; it is resolved internally.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {target && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-white font-bold">
                {target.fareMindRef}
                <span className="text-slate-500 font-normal mx-2">·</span>
                <span className="text-slate-400 font-normal">Airline PNR </span>
                <span className="font-mono">{target.airlinePnr || 'not issued yet'}</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {[
                  target.route,
                  `${target.passengerCount} traveller${target.passengerCount === 1 ? '' : 's'}`,
                  target.bookingStatus,
                  target.ticketingStatus,
                ].filter(Boolean).join('  ·  ')}
              </p>
              {!target.serviceable && (
                <p className="text-[11px] text-amber-300 mt-1">
                  This booking carries no provider reference, so Post-Ticketing Requests cannot act on it.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
