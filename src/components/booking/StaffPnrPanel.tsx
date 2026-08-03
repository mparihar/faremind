'use client';

import React from 'react';

/**
 * The two booking codes, told apart — staff surfaces only.
 *
 * A booking carries two record locators, and they had been collapsed into one
 * "PNR Codes" list that printed Mystifly's reference under the label "MASTER
 * AIRLINE PNR". They are not the same thing and are not interchangeable:
 *
 *   Airline PNR   EOROKA        the airline's own locator. What the passenger
 *                               quotes at check-in and what airline support
 *                               recognises. Null until the airline publishes it.
 *
 *   MF Ref        MF35498526    Mystifly's booking reference. Internal: it drives
 *                               our provider servicing calls and means nothing to
 *                               a passenger or an airline desk.
 *
 * Render this on agent and admin screens only. Nothing customer-facing should
 * show the MF Ref — see src/lib/booking-identifiers.ts, which strips it from
 * notifications for the same reason.
 */

export interface StaffPnrRow {
  pnrCode?: string | null;
  pnrType?: string | null;
  airlinePnr?: string | null;
  airlineCode?: string | null;
  airlineName?: string | null;
  providerOrderId?: string | null;
}

export interface StaffPnrBooking {
  /** MasterBooking.airlinePnr — the trip-level airline locator. */
  airlinePnr?: string | null;
  /** mystiflyMfRef / masterPnr / mystiflyBookingReference. */
  mfRef?: string | null;
  /** Per-carrier rows: codeshare and multi-airline trips carry one each. */
  pnrs?: StaffPnrRow[] | null;
}

/** `MF` + digits is Mystifly's shape. Used to tell the two codes apart. */
const isMfShaped = (v: unknown) => /^MF\d+$/i.test(String(v ?? '').trim());

interface Chip { code: string; label?: string | null }

/** Airline locators across the booking and its per-carrier rows, de-duplicated. */
function airlineChips(b: StaffPnrBooking): Chip[] {
  const seen = new Map<string, Chip>();
  const add = (code?: string | null, label?: string | null) => {
    const v = String(code ?? '').trim();
    // An MF-shaped value in an airline field is the old mislabelling — never
    // present it as the airline's code.
    if (!v || isMfShaped(v)) return;
    const key = v.toUpperCase();
    if (!seen.has(key)) seen.set(key, { code: v, label: label || null });
  };

  add(b.airlinePnr);
  for (const p of b.pnrs ?? []) {
    add(p.airlinePnr, p.airlineName || p.airlineCode);
    // Rows typed AIRLINE_PNR hold the locator in pnrCode itself.
    if (p.pnrType === 'AIRLINE_PNR') add(p.pnrCode, p.airlineName || p.airlineCode);
  }
  return [...seen.values()];
}

/** Mystifly references across the booking and its rows, de-duplicated. */
function mfChips(b: StaffPnrBooking): string[] {
  const seen = new Set<string>();
  const add = (v?: string | null) => {
    const s = String(v ?? '').trim();
    if (isMfShaped(s)) seen.add(s.toUpperCase());
  };
  add(b.mfRef);
  for (const p of b.pnrs ?? []) { add(p.pnrCode); add(p.providerOrderId); }
  return [...seen];
}

const CHIP =
  'px-3 py-1.5 rounded-lg bg-slate-800/60 text-xs font-mono text-white border border-white/[0.06]';

export default function StaffPnrPanel({
  booking,
  className = '',
}: {
  booking: StaffPnrBooking;
  className?: string;
}) {
  const airline = airlineChips(booking);
  const mf = mfChips(booking);

  return (
    <div className={className}>
      <div>
        <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">Airline PNR</p>
        {airline.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {airline.map((c) => (
              <span key={c.code} className={CHIP}>
                {c.code}
                {c.label && <span className="text-slate-500 text-[10px] ml-1.5">({c.label})</span>}
              </span>
            ))}
          </div>
        ) : (
          // Its absence is information: the airline has not published a locator
          // yet, which is normal before ticketing settles.
          <p className="text-slate-500 text-xs">Not issued by the airline yet</p>
        )}
      </div>

      {mf.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] text-slate-500 uppercase font-bold mb-2">
            MF Ref <span className="text-slate-600 font-semibold">· Mystifly, internal</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {mf.map((code) => (
              <span key={code} className={CHIP}>{code}</span>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-1.5">
            Our provider reference. Never quote it to a customer or an airline desk.
          </p>
        </div>
      )}
    </div>
  );
}
