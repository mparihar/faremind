'use client';

/**
 * "You land here, you leave from there" — shown on the connection it applies to.
 *
 * FM0WD01L lands at JFK and departs from LGA on one ticket and one fare. Every
 * itinerary we produced called that "layover · JFK": one airport named for a gap
 * that spans two, which reads as "wait here" to someone who has to cross New
 * York with their bags and clear US immigration on the way.
 *
 * A single component rather than a badge re-typed on each screen, because the
 * failure mode of duplicating it is silent — a surface that maps a field name
 * wrong detects nothing and looks exactly like a trip with no changes. There is
 * one detector, one wording, and one place to change either.
 *
 * Placed AFTER the segment it follows, so it sits in the gap it describes.
 */

import { AlertTriangle } from 'lucide-react';
import {
  detectStoredConnectionChanges, airportChangeAt,
  airportChangeSegmentLabel, airportChangeSegmentDetail,
  type ConnectionChanges,
} from '@/lib/connection-changes';

/** Light for customer pages on white; dark for the slate consoles. */
type Tone = 'light' | 'dark';

const TONES: Record<Tone, { box: string; title: string; body: string; icon: string }> = {
  light: {
    box: 'bg-red-50 border-red-200',
    title: 'text-red-800',
    body: 'text-red-600',
    icon: 'text-red-500',
  },
  dark: {
    box: 'bg-red-500/10 border-red-500/25',
    title: 'text-red-300',
    body: 'text-red-400/90',
    icon: 'text-red-400',
  },
};

export function AirportChangeNotice({
  changes, afterSegment, tone = 'light', className = '',
}: {
  changes: ConnectionChanges;
  /** Index of the segment this gap follows. */
  afterSegment: number;
  tone?: Tone;
  className?: string;
}) {
  const change = airportChangeAt(changes, afterSegment);
  if (!change) return null;

  const t = TONES[tone];
  return (
    <div className={`flex items-start gap-2.5 px-3.5 py-2.5 my-2 rounded-xl border ${t.box} ${className}`}>
      <AlertTriangle size={14} className={`shrink-0 mt-0.5 ${t.icon}`} />
      <div className="min-w-0">
        <p className={`text-xs font-bold ${t.title}`}>{airportChangeSegmentLabel(change)}</p>
        <p className={`text-[10px] leading-relaxed mt-0.5 ${t.body}`}>
          {airportChangeSegmentDetail(change)}
        </p>
      </div>
    </div>
  );
}

/**
 * The same notice, for a list of STORED segments where the caller has no
 * ConnectionChanges to hand. Detects once per render from the segment array.
 */
export function StoredAirportChangeNotice({
  segments, afterSegment, tone = 'light', className = '',
}: {
  segments: Array<Record<string, unknown>> | null | undefined;
  afterSegment: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <AirportChangeNotice
      changes={detectStoredConnectionChanges(segments)}
      afterSegment={afterSegment}
      tone={tone}
      className={className}
    />
  );
}
