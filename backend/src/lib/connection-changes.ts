/**
 * Connections that change airport or terminal.
 *
 * FM0WD01L is the case this exists for: DEL→JFK, then LGA→YYZ. One PNR, one
 * fare, and a taxi across New York in the middle with bags and a US immigration
 * queue. Nothing on the page said so.
 *
 * The scoring engine has had an AIRPORT_CHANGE warning, an AI-Pick block and a
 * 30-point penalty for a long time. They could never fire: the flag feeding them
 * was hard-coded `false` in one construction path, and in the other it was read
 * from `terminalChange`, which is a different thing entirely.
 *
 * ── Two different facts, kept apart ──────────────────────────────────────────
 *
 *   AIRPORT change   arrive JFK, depart LGA. Leave the airport, cross a city,
 *                    check in again. Warn, and withhold the AI Pick.
 *   TERMINAL change  arrive T4, depart T8, same airport. A walk or a shuttle.
 *                    Say it; do not block on it.
 *
 * Reporting a terminal change as an airport change overstates the harmless case
 * and, because one flag carried both, hid the serious one.
 */

export interface ConnectionChange {
  /** Where the inbound flight lands. */
  from: string;
  /** Where the onward flight leaves from. */
  to: string;
  /** Index of the layover, matching the gap after segment[i]. */
  afterSegment: number;
  /** Minutes between landing and the next departure, when both times are known. */
  connectionMinutes: number | null;
}

export interface ConnectionChanges {
  airportChanges: ConnectionChange[];
  terminalChanges: Array<{ airport: string; from: string; to: string; afterSegment: number }>;
  hasAirportChange: boolean;
  hasTerminalChange: boolean;
}

interface SegmentLike {
  departure?: { airport?: string | null; terminal?: string | null; time?: string | null } | null;
  arrival?: { airport?: string | null; terminal?: string | null; time?: string | null } | null;
}

const code = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** Minutes between two provider timestamps, or null when either is missing. */
function gapMinutes(arriveIso?: string | null, departIso?: string | null): number | null {
  if (!arriveIso || !departIso) return null;
  // Both are airport wall clocks; the difference across a change of airport in
  // the same city is still meaningful. See lib/provider-time.
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s.trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
  };
  const a = parse(arriveIso), d = parse(departIso);
  if (Number.isNaN(a) || Number.isNaN(d)) return null;
  const mins = Math.round((d - a) / 60000);
  return mins >= 0 ? mins : null;
}

/** Find every airport and terminal change across a list of ordered segments. */
export function detectConnectionChanges(segments: SegmentLike[] | null | undefined): ConnectionChanges {
  const airportChanges: ConnectionChange[] = [];
  const terminalChanges: ConnectionChanges['terminalChanges'] = [];
  const segs = Array.isArray(segments) ? segments : [];

  for (let i = 0; i < segs.length - 1; i++) {
    const arrives = code(segs[i]?.arrival?.airport);
    const leaves = code(segs[i + 1]?.departure?.airport);
    if (!arrives || !leaves) continue;

    if (arrives !== leaves) {
      airportChanges.push({
        from: arrives,
        to: leaves,
        afterSegment: i,
        connectionMinutes: gapMinutes(segs[i]?.arrival?.time, segs[i + 1]?.departure?.time),
      });
      continue;   // an airport change subsumes any terminal difference
    }

    const arrTerm = String(segs[i]?.arrival?.terminal ?? '').trim();
    const depTerm = String(segs[i + 1]?.departure?.terminal ?? '').trim();
    if (arrTerm && depTerm && arrTerm !== depTerm) {
      terminalChanges.push({ airport: arrives, from: arrTerm, to: depTerm, afterSegment: i });
    }
  }

  return {
    airportChanges,
    terminalChanges,
    hasAirportChange: airportChanges.length > 0,
    hasTerminalChange: terminalChanges.length > 0,
  };
}

/** Short label for a tile — space is tight, so name the airports and stop. */
export function airportChangeLabel(changes: ConnectionChanges): string | null {
  const first = changes.airportChanges[0];
  if (!first) return null;
  const more = changes.airportChanges.length - 1;
  return `Airport change ${first.from} → ${first.to}${more > 0 ? ` +${more} more` : ''}`;
}

/**
 * What the traveller has to do, for the confirmation and the itinerary email.
 *
 * Deliberately different from the search wording. Before booking it is a
 * warning they can act on by choosing another flight; afterwards it is
 * logistics they have to plan around, and telling them to "consider a different
 * flight" at that point is no use to anyone.
 */
export function airportChangeNotice(changes: ConnectionChanges): string | null {
  const first = changes.airportChanges[0];
  if (!first) return null;
  const hrs = first.connectionMinutes != null
    ? ` You have about ${Math.floor(first.connectionMinutes / 60)}h ${first.connectionMinutes % 60}m between flights.`
    : '';
  return (
    `Your connection changes airports: you arrive at ${first.from} and depart from ${first.to}. ` +
    `You will need to collect your bags, clear immigration if arriving internationally, ` +
    `and travel between the two airports yourself.${hrs}`
  );
}
