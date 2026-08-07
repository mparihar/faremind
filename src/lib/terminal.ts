/**
 * Airport terminals, said the same way everywhere.
 *
 * Every itinerary surface renders terminals its own way or not at all — the
 * confirmation page prints "· T3", the email and account pages print
 * "Terminal 3", the PDF and the agent console printed nothing. That was
 * survivable while the data was absent (Mystifly's search response carries no
 * terminal, so every booking stored null), but the moment TripDetails starts
 * filling them the differences become visible: the same leg reads "T3" on one
 * screen, "Terminal 3" on the next and nowhere on the ticket the passenger
 * actually carries.
 *
 * A terminal is a wayfinding instruction. It is the difference between arriving
 * at JFK Terminal 8 and walking to the wrong building with bags, so it belongs
 * on every surface that claims to show the itinerary.
 */

/** A terminal we can actually show, or null. */
export function terminalOf(value: unknown): string | null {
  // "0" is a real terminal — Singapore and several others use it — so this
  // cannot be a truthiness check on the raw value.
  const t = String(value ?? '').trim();
  if (!t) return null;
  // Providers sometimes send the word as well as the number ("Terminal 3",
  // "TERMINAL B"). Strip it so we do not print "Terminal Terminal 3".
  const stripped = t.replace(/^\s*(terminal|term\.?|t)\s*[:\-]?\s*/i, '').trim();
  return stripped || t;
}

/** "Terminal 3" — for prose, emails, PDFs, detail panels. */
export function terminalLabel(value: unknown): string | null {
  const t = terminalOf(value);
  return t ? `Terminal ${t}` : null;
}

/** "T3" — for dense tiles where the word does not fit. */
export function terminalShort(value: unknown): string | null {
  const t = terminalOf(value);
  return t ? `T${t}` : null;
}

/**
 * "DEL T3 → JFK T8" — a leg's routing with terminals attached.
 *
 * A terminal on its own is not information; "T8" only means something next to
 * JFK. Compact surfaces that list flight number and cabin but no routing get
 * both from this, in one string, so the terminal can never appear detached from
 * the airport it belongs to.
 *
 * Accepts either field convention: the stored row's originAirport /
 * originTerminal, or the normalised offer's departure.airport /
 * departure.terminal.
 */
export function segmentRouteWithTerminals(seg: SegmentLike | null | undefined): string | null {
  const s = seg ?? {};
  const from = String(s.originAirport ?? s.departure?.airport ?? '').trim();
  const to = String(s.destinationAirport ?? s.arrival?.airport ?? '').trim();
  if (!from || !to) return null;

  const fromT = terminalShort(s.originTerminal ?? s.departure?.terminal);
  const toT = terminalShort(s.destinationTerminal ?? s.arrival?.terminal);
  return `${from}${fromT ? ` ${fromT}` : ''} → ${to}${toT ? ` ${toT}` : ''}`;
}

/**
 * One end of a leg. `terminal` is writable because the book path fills it in on
 * the objects it is about to persist.
 */
export interface EndpointLike {
  airport?: unknown;
  terminal?: string | null;
}

/** A segment in either convention — the stored row's, or the normalised offer's. */
export interface SegmentLike {
  originAirport?: unknown;
  destinationAirport?: unknown;
  originTerminal?: unknown;
  destinationTerminal?: unknown;
  departure?: EndpointLike | null;
  arrival?: EndpointLike | null;
}

interface JourneyLike { segments?: SegmentLike[] | null }
interface RoundTripLike {
  outboundJourney?: JourneyLike | null;
  returnJourney?: JourneyLike | null;
}

/** What the provider published for one leg. */
export interface SegmentTerminal {
  origin: string;
  destination: string;
  originTerminal: string | null;
  destinationTerminal: string | null;
}

/**
 * Write provider terminals onto the offer segments about to be persisted.
 *
 * Matched by route rather than position: a round trip's segments are held in two
 * separate arrays here and arrive from the provider as one flat list, so index
 * `1` means different legs on the two sides. Pairing them positionally would put
 * the outbound's terminal on the return — worse than showing none, because a
 * wrong terminal is acted on.
 *
 * Identical routes flown twice (a same-day turnaround) consume from a queue in
 * provider order, so the second occurrence gets the second terminal.
 *
 * Mutates in place: the caller persists these objects and returns them to the
 * confirmation page, and both need the terminal.
 */
export function applySegmentTerminals(
  sourceFlight: JourneyLike | null | undefined,
  sourceRoundTrip: RoundTripLike | null | undefined,
  terminals: SegmentTerminal[] | null | undefined,
): number {
  if (!Array.isArray(terminals) || terminals.length === 0) return 0;

  const key = (o: unknown, d: unknown) =>
    `${String(o ?? '').trim().toUpperCase()}->${String(d ?? '').trim().toUpperCase()}`;

  const pool = new Map<string, SegmentTerminal[]>();
  for (const t of terminals) {
    const k = key(t.origin, t.destination);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(t);
  }

  const segmentLists = [
    sourceFlight?.segments,
    sourceRoundTrip?.outboundJourney?.segments,
    sourceRoundTrip?.returnJourney?.segments,
  ].filter((l): l is SegmentLike[] => Array.isArray(l));

  let applied = 0;
  for (const segs of segmentLists) {
    for (const seg of segs) {
      const bucket = pool.get(key(seg?.departure?.airport, seg?.arrival?.airport));
      const t = bucket?.shift();
      if (!t) continue;
      if (t.originTerminal && seg.departure) { seg.departure.terminal = t.originTerminal; applied++; }
      if (t.destinationTerminal && seg.arrival) { seg.arrival.terminal = t.destinationTerminal; applied++; }
    }
  }
  return applied;
}

/**
 * A gate is not a terminal, and neither implies the other.
 *
 * Gates are assigned hours before departure and change; a terminal is stable
 * enough to plan around. Showing a stale gate as though it were current is worse
 * than showing none, so callers pass gate only where it is knowingly live.
 */
export function terminalAndGate(terminal: unknown, gate?: unknown): string | null {
  const t = terminalLabel(terminal);
  const g = String(gate ?? '').trim();
  if (t && g) return `${t} · Gate ${g}`;
  return t ?? (g ? `Gate ${g}` : null);
}
