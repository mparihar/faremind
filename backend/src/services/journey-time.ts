/**
 * MIRROR of src/lib/journey-time.ts — keep the two byte-identical below this header.
 *
 * Dockerfile.backend copies only backend/, prisma/ and the root package files,
 * so the backend cannot import across into src/ at runtime: doing so crashed the
 * container on startup and took production search down with a 502.
 *
 * Journey timing across timezones.
 *
 * Providers send local airport times with no offset. `new Date("…T23:30:00")`
 * therefore reads as local-to-the-viewer, so subtracting a departure from an
 * arrival in a different zone silently drops the difference between the two
 * clocks. DEL→YYZ showed 15h09m for a 24h39m journey; the same trip back showed
 * 34h03m for 24h33m.
 *
 * Everything here returns null rather than a guess when the zone is unknown, so
 * callers keep their previous behaviour instead of printing a confident wrong
 * number.
 *
 * Layovers need no correction — both sides are the same airport, so the offset
 * cancels — but they run through the same helper so there is one way to do it.
 */
import { airportTimeZone } from './airport-timezones';

/** Cache: repeated `Intl.DateTimeFormat` construction is the expensive part. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(zone);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(zone, f);
    return f;
  } catch {
    return null;   // not a zone this runtime knows
  }
}

/** The parts of a naive local timestamp, or null if it is not one we can read. */
function parseLocal(iso: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(iso ?? '').trim());
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] };
}

/**
 * The UTC instant of a local airport time.
 *
 * Works by guessing UTC, asking the zone what local time that instant is, and
 * correcting by the difference. Run twice because the first correction can step
 * across a DST boundary and change the offset.
 */
export function airportEpochMs(localIso: string, zone: string): number | null {
  const p = parseLocal(localIso);
  const f = formatterFor(zone);
  if (!p || !f) return null;

  const target = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const parts = f.formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const drift = target - asLocal;
    if (drift === 0) break;
    guess += drift;
  }
  return guess;
}

export interface TimedPoint {
  /** Local time as the provider sent it, no offset. */
  time?: string | null;
  airport?: string | null;
  /** Country from our airport table, when the code alone is not enough. */
  country?: string | null;
}

/**
 * Minutes between two points, honouring each end's timezone.
 *
 * Returns null when either zone is unknown, either time is unreadable, or the
 * result is negative — all cases where the caller should keep its own value.
 */
export function elapsedMinutes(from: TimedPoint, to: TimedPoint): number | null {
  const fromZone = airportTimeZone(from.airport, from.country);
  const toZone = airportTimeZone(to.airport, to.country);
  if (!fromZone || !toZone) return null;
  if (!from.time || !to.time) return null;

  const a = airportEpochMs(from.time, fromZone);
  const b = airportEpochMs(to.time, toZone);
  if (a == null || b == null) return null;

  const minutes = Math.round((b - a) / 60000);
  return minutes >= 0 ? minutes : null;
}

/**
 * Journey duration from first departure to last arrival, timezone-aware.
 * Null when it cannot be computed — the caller keeps its existing figure.
 */
export function journeyDurationMinutes(
  segments: Array<{ departure?: TimedPoint; arrival?: TimedPoint }>,
): number | null {
  if (!segments?.length) return null;
  const first = segments[0]?.departure;
  const last = segments[segments.length - 1]?.arrival;
  if (!first || !last) return null;
  return elapsedMinutes(first, last);
}
