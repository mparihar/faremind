'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';

export type BookedSortOrder = 'asc' | 'desc';

/**
 * Sort a booking list by the date the booking was made.
 *
 * Lists used to be ordered by departure, which answers "what flies next" but
 * not "where is the booking I just made" — a trip booked this morning sat below
 * one booked months ago. Booking date puts the newest where people look for it,
 * and the toggle covers the other direction for anyone working the oldest first.
 *
 * One control, three consoles, so the ordering means the same thing in each.
 */
export default function BookedDateSort({
  order,
  onChange,
  className = '',
  tone = 'dark',
}: {
  order: BookedSortOrder;
  onChange: (next: BookedSortOrder) => void;
  className?: string;
  /** 'dark' for the admin and agent consoles, 'light' for the customer account. */
  tone?: 'dark' | 'light';
}) {
  const next = order === 'desc' ? 'asc' : 'desc';
  const label = order === 'desc' ? 'Newest first' : 'Oldest first';

  const styles = tone === 'dark'
    ? 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white hover:border-slate-600'
    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300';

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      // Say what it will do, not just what it shows — the arrow alone leaves
      // people guessing which way is which.
      title={`Sorted by booking date, ${label.toLowerCase()}. Click to show ${next === 'desc' ? 'newest' : 'oldest'} first.`}
      aria-label={`Sort by booking date. Currently ${label.toLowerCase()}. Activate to sort ${next === 'desc' ? 'newest' : 'oldest'} first.`}
      className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all ${styles} ${className}`}
    >
      {order === 'desc' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
      <span>Booked · {label}</span>
    </button>
  );
}
