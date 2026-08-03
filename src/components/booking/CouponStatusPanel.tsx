'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Receipt, Ticket } from 'lucide-react';
import { apiUrl } from '@/lib/api-client';

/**
 * Per-segment coupon state + provider credit notes for a Mystifly booking.
 *
 * One component for both the customer's manage-booking view and the agent console, so
 * the two cannot drift — they read the same backend endpoints
 * (/api/manage-booking/:id/coupon-status and /credit-notes) and render the same thing.
 * Credit notes are back-office detail, so they are opt-in via `showCreditNotes` and
 * shown on the agent side only.
 */

interface CouponSegment {
  origin: string;
  destination: string;
  flightNumber: string;
  travelDate: string | null;
  couponStatus: string;
  warning: string | null;
  rbdClass: string | null;
  baggage: string | null;
}

interface CouponTicket {
  eTicketNumber: string;
  ticketIssueDate: string | null;
  segments: CouponSegment[];
}

export default function CouponStatusPanel({
  bookingId,
  showCreditNotes = false,
  authHeaders,
}: {
  bookingId: string;
  showCreditNotes?: boolean;
  authHeaders?: Record<string, string>;
}) {
  const [data, setData] = useState<any>(null);
  const [notes, setNotes] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(apiUrl(`/api/manage-booking/${encodeURIComponent(bookingId)}/coupon-status`), {
          headers: { 'Content-Type': 'application/json', ...(authHeaders || {}) },
        });
        const j = await res.json();
        if (!cancelled) {
          if (!res.ok) setError(j?.error || `HTTP ${res.status}`);
          else setData(j);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load ticket status');
      }
      if (!cancelled) setLoading(false);

      if (showCreditNotes) {
        try {
          const res = await fetch(apiUrl(`/api/manage-booking/${encodeURIComponent(bookingId)}/credit-notes`), {
            headers: { 'Content-Type': 'application/json', ...(authHeaders || {}) },
          });
          const j = await res.json();
          if (!cancelled && res.ok) setNotes(j);
        } catch { /* non-critical */ }
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId, showCreditNotes, authHeaders]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm p-4">
        <Loader2 size={14} className="animate-spin" /> Loading ticket status…
      </div>
    );
  }

  if (error) {
    return <p className="text-amber-400 text-sm p-4">Ticket status unavailable: {error}</p>;
  }

  // Duffel and other providers have no coupon concept — say so rather than render empty.
  if (data && data.supported === false) {
    return <p className="text-slate-500 text-sm p-4">{data.reason}</p>;
  }

  const tickets: CouponTicket[] = data?.tickets || [];
  if (tickets.length === 0) {
    return <p className="text-slate-500 text-sm p-4">No coupon information has been issued for this booking yet.</p>;
  }

  const eligible = data?.eligibleForServicing;

  return (
    <div className="space-y-4">
      {/* Servicing eligibility — the airline's own verdict, not our inference. */}
      <div className={`rounded-xl border p-3 flex items-start gap-2 ${eligible ? 'border-emerald-400/25 bg-emerald-400/10' : 'border-amber-400/25 bg-amber-400/10'}`}>
        {eligible
          ? <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />
          : <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />}
        <div>
          {/* Three states, not two: open, closed, and not reported. "N/A" used to
              be counted as closed, so an unreported ticket read as ineligible. */}
          <p className={`text-sm font-bold ${eligible ? 'text-emerald-300' : 'text-amber-300'}`}>
            {data.couponsUnreported
              ? 'The airline did not report coupon status for this booking.'
              : eligible
                ? 'All coupons are open — this ticket can be refunded, voided or changed.'
                : 'Some coupons are no longer open.'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {data.couponsUnreported
              ? 'Eligibility could not be checked from coupon data — the fare rules still apply.'
              : `${data.openSegmentCount} of ${data.segmentCount} segment${data.segmentCount === 1 ? '' : 's'} open.`}
          </p>
          {!eligible && (data.warnings || []).map((w: string, i: number) => (
            <p key={i} className="text-[11px] text-amber-300/90 mt-1">{w}</p>
          ))}
        </div>
      </div>

      {tickets.map((t) => (
        <div key={t.eTicketNumber} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Ticket size={13} className="text-slate-500" />
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">E-Ticket</span>
            <span className="text-sm font-mono text-white">{t.eTicketNumber}</span>
            {t.ticketIssueDate && <span className="text-[11px] text-slate-500">issued {t.ticketIssueDate}</span>}
          </div>
          <div className="space-y-1.5">
            {t.segments.map((sg, i) => {
              const unreported = !sg.couponStatus || /^(n\/?a|unknown|none|-)$/i.test(sg.couponStatus.trim());
              const open = /open/i.test(sg.couponStatus);
              return (
                <div key={i} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-white font-medium">
                    {sg.origin} → {sg.destination}
                    <span className="text-slate-500 font-normal ml-2">
                      {sg.flightNumber ? `#${sg.flightNumber}` : ''}
                      {sg.travelDate ? ` · ${String(sg.travelDate).slice(0, 10)}` : ''}
                    </span>
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${open ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-700/50 text-slate-400'}`}>
                    {unreported ? 'NOT REPORTED' : sg.couponStatus}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {showCreditNotes && notes?.supported && (notes.creditNotes || []).length > 0 && (
        <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Receipt size={13} className="text-slate-500" />
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Provider Credit Notes</span>
          </div>
          {notes.creditNotes.map((c: any) => (
            <div key={c.number} className="flex items-center justify-between text-sm py-0.5">
              <span className="text-slate-400 font-mono text-xs">#{c.number}</span>
              <span className="text-white">{c.amount?.toFixed(2)} {c.currency}</span>
              <span className="text-xs text-slate-400">{c.status}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-700 pt-1 mt-1 text-sm font-bold text-white">
            <span>Total credited</span><span>{notes.totalAmount?.toFixed(2)} {notes.currency}</span>
          </div>
        </div>
      )}
    </div>
  );
}
