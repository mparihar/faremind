/**
 * Provider timestamps — one way to read them, one way to show them.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 *
 * Duffel, Amadeus and Mystifly all emit airport wall-clock time with no zone:
 *
 *     "DepartureDateTime": "2026-12-11T18:10:00"     // 18:10 on the BCN clock
 *
 * `new Date("2026-12-11T18:10:00")` reads that as *the machine's* local time.
 * The same string becomes a different instant on every server and every laptop:
 *
 *     machine in America/Chicago  →  2026-12-12T00:10:00Z   (6 h late)
 *     machine in UTC              →  2026-12-11T18:10:00Z   (right, by luck)
 *     machine in Asia/Kolkata     →  2026-12-11T12:40:00Z   (5.5 h early)
 *
 * FMP6VJN2 was booked through the Chicago branch and stored 00:10Z on the 12th
 * for a flight that leaves 18:10 on the 11th — a day out for any viewer east of
 * the Atlantic. That is not a display quirk; the wrong instant is in the row.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * A flight time is a wall clock, not an instant. Nobody wants "your flight is
 * at 17:10Z"; they want the number on the airport departure board, which is the
 * number the provider sent. So:
 *
 *     PARSE  — pin the provider's wall clock to UTC, verbatim, discarding any
 *              offset the string carries. 18:10 stores as 18:10Z.
 *     READ   — take hours/dates off the UTC accessors, never the local ones.
 *     RENDER — format with `timeZone: 'UTC'`, so 18:10Z prints as 18:10.
 *
 * Do all three and a BCN departure reads 18:10 in Barcelona, Bangalore, Boston
 * and on a Railway container — because no zone conversion ever happens. Skip any
 * one of them and the offset creeps back in at that step.
 *
 * ── What this is NOT for ─────────────────────────────────────────────────────
 *
 * Real instants — `createdAt`, `issuedAt`, payment and audit times — are genuine
 * points in time, already stored with a zone, and correctly shown in the
 * viewer's own timezone. Leave those on plain `new Date()` / `toLocaleString()`.
 * The distinction is the whole point: a flight leaves at 18:10 local everywhere,
 * a payment happened at one instant that renders differently everywhere.
 *
 * Mirrored byte-identical at `backend/src/lib/provider-time.ts`.
 */

/** Matches a trailing zone designator: `Z`, `+05:30`, `-0600`, `+02`. */
const ZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2}|[+-]\d{2})$/i;

/** Matches the wall-clock parts of an ISO-ish timestamp, zone optional. */
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?/;

/**
 * Parse a provider timestamp into a Date whose UTC face is the wall clock the
 * provider sent.
 *
 * Returns `null` for anything unparseable, so callers decide what a missing
 * time means rather than silently getting the epoch or `Invalid Date`. A Date
 * passed in is returned unchanged — values coming back out of Prisma have
 * already been through here on the way in.
 */
export function parseProviderDateTime(input: string | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== 'string') return null;

  const raw = input.trim();
  if (!raw) return null;

  const m = ISO_LIKE.exec(raw);
  if (!m) {
    // Not ISO-shaped (e.g. "Dec 11 2026"). Such strings carry no zone anyway and
    // Date already reads them as local; there is nothing better available.
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, y, mo, d, hh = '00', mi = '00', ss = '00', ms = '0'] = m;
  const at = Date.UTC(
    Number(y), Number(mo) - 1, Number(d),
    Number(hh), Number(mi), Number(ss), Number(ms.padEnd(3, '0')),
  );
  return Number.isNaN(at) ? null : new Date(at);
}

/**
 * True when the string carries its own zone.
 *
 * We still discard that zone when parsing — a `+05:30` departure is 09:00 on
 * the departure board and 09:00 is what a traveller needs — but a caller doing
 * genuine instant arithmetic may want to know it was there.
 */
export function hasExplicitZone(input: string | null | undefined): boolean {
  return typeof input === 'string' && ZONE_SUFFIX.test(input.trim());
}

/**
 * Parse, or fall back to a supplied default. For the many call sites that used
 * `new Date(x || Date.now())` and cannot accept null.
 */
export function parseProviderDateTimeOr(
  input: string | Date | null | undefined,
  fallback: Date,
): Date {
  return parseProviderDateTime(input) ?? fallback;
}

/**
 * The wall-clock hour, 0–23. `Infinity`-safe; returns `null` when unparseable
 * so time-of-day scoring can choose a neutral value rather than trusting a 0.
 */
export function providerHour(input: string | Date | null | undefined): number | null {
  const d = parseProviderDateTime(input);
  return d ? d.getUTCHours() : null;
}

/** The wall-clock minute, 0–59. */
export function providerMinute(input: string | Date | null | undefined): number | null {
  const d = parseProviderDateTime(input);
  return d ? d.getUTCMinutes() : null;
}

/** The calendar date the provider meant, as `YYYY-MM-DD`. */
export function providerDateOnly(input: string | Date | null | undefined): string | null {
  const d = parseProviderDateTime(input);
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Epoch milliseconds for duration and ordering arithmetic.
 *
 * Differences between two of these are the wall-clock gap, which is what
 * layovers and "sort by departure" have always meant here. `NaN` on bad input,
 * matching what `new Date(junk).getTime()` did, so a broken row stays visibly
 * broken instead of sorting as 1970.
 *
 * Use this rather than `new Date(x).getTime()` even where the offset used to
 * cancel out: now that stored times are UTC-pinned, mixing a stored value with
 * a freshly local-parsed one no longer cancels, and the error is ~one timezone.
 */
export function flightTimeMs(input: string | Date | null | undefined): number {
  const d = parseProviderDateTime(input);
  return d ? d.getTime() : NaN;
}

/**
 * Has this flight departed?
 *
 * Compares a wall clock against a real instant, so it is only as precise as the
 * airport's offset from UTC — up to ~14 h either way. That is fine for splitting
 * "upcoming" from "past" on a bookings list and is not a basis for anything
 * chargeable; cancellation windows must come from the provider, not from here.
 */
export function isFlightInPast(
  input: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const ms = flightTimeMs(input);
  return Number.isNaN(ms) ? false : ms < now.getTime();
}

// ── Rendering ────────────────────────────────────────────────────────────────
//
// Every formatter below pins `timeZone: 'UTC'`. That is not a preference for
// UTC; it is how the stored wall clock survives being printed. Without it the
// browser helpfully converts, and a Madrid customer sees 19:10 for an 18:10
// flight.

const UTC = 'UTC' as const;

// Signatures deliberately mirror toLocaleDateString(locale, options): these
// replace those calls one-for-one, and a transposed pair would be silent.

/** "Dec 11, 2026" */
export function formatFlightDate(
  input: string | Date | null | undefined,
  locale: string | string[] = 'en-US',
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const d = parseProviderDateTime(input);
  if (!d) return '';
  return d.toLocaleDateString(locale, { ...opts, timeZone: UTC });
}

/** "6:10 PM" */
export function formatFlightTime(
  input: string | Date | null | undefined,
  locale: string | string[] = 'en-US',
  opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' },
): string {
  const d = parseProviderDateTime(input);
  if (!d) return '';
  return d.toLocaleTimeString(locale, { ...opts, timeZone: UTC });
}

/** "Dec 11, 2026, 6:10 PM" */
export function formatFlightDateTime(
  input: string | Date | null | undefined,
  locale: string | string[] = 'en-US',
  opts: Intl.DateTimeFormatOptions = {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  },
): string {
  const d = parseProviderDateTime(input);
  if (!d) return '';
  return d.toLocaleString(locale, { ...opts, timeZone: UTC });
}

/** "18:10" — the 24-hour face, for compact tables and boarding-pass style rows. */
export function formatFlightTime24(input: string | Date | null | undefined): string {
  const d = parseProviderDateTime(input);
  if (!d) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
