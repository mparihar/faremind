/**
 * Which provider a booking, ticket or payment belongs to — named one way.
 *
 * The database stores `primaryProvider` lowercase ("mystifly"), booking_pnrs
 * repeats it, error codes prefix it uppercase ("MYSTIFLY_BOOKING_FAILED"), and
 * the UI wants it title-case ("Mystifly"). Every screen that has needed to say
 * "which provider" has re-derived that mapping, and a filter built on one
 * spelling silently matches nothing when handed another.
 *
 * Production is Mystifly-only today because that is what certification covers.
 * This exists so the segregation is already correct the day Duffel bookings
 * start arriving, rather than being retrofitted onto live data.
 */

export type ProviderId = 'duffel' | 'mystifly';

/** Every provider we book through, in the order they should be listed. */
export const PROVIDERS: readonly ProviderId[] = ['duffel', 'mystifly'] as const;

const LABELS: Record<ProviderId, string> = {
  duffel: 'Duffel',
  mystifly: 'Mystifly',
};

/** Canonical id from anything the system stores — or null if it says nothing. */
export function providerIdOf(value: unknown): ProviderId | null {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v.includes('duffel')) return 'duffel';
  if (v.includes('mystifly') || v.includes('myfarebox')) return 'mystifly';
  return null;
}

/** "Duffel" / "Mystifly" — what a human reads. Never invents a name. */
export function providerLabel(value: unknown): string | null {
  const id = providerIdOf(value);
  return id ? LABELS[id] : null;
}

/**
 * The provider behind a booking failure, when there is no booking to ask.
 *
 * A failed booking has no MasterBooking row, so the usual lookup has nothing to
 * join to. The error code carries it — MYSTIFLY_BOOKING_FAILED,
 * MYSTIFLY_REVALIDATION_FAILED — because the branch that raised it knew which
 * provider it was talking to.
 *
 * PROVIDER_ORDER_FAILED and UNEXPECTED_ERROR deliberately return null rather
 * than a guess: the first is raised on the Duffel path but reads as generic, and
 * support routing a ticket to the wrong provider's desk costs more than an
 * "Unassigned" label that tells the truth. Rows written from now on carry an
 * explicit provider and never reach this.
 */
export function providerFromErrorCode(errorCode: unknown): ProviderId | null {
  const code = String(errorCode ?? '').trim().toUpperCase();
  if (!code) return null;
  if (code.startsWith('MYSTIFLY')) return 'mystifly';
  if (code.startsWith('DUFFEL')) return 'duffel';
  return null;
}

/** What a support ticket belongs to. Explicit beats derived beats guessed. */
export function ticketProvider(ticket: {
  provider?: unknown;
  failureAudit?: { provider?: unknown; errorCode?: unknown } | null;
  bookingProvider?: unknown;
}): ProviderId | null {
  return (
    providerIdOf(ticket?.provider) ??
    providerIdOf(ticket?.failureAudit?.provider) ??
    providerIdOf(ticket?.bookingProvider) ??
    providerFromErrorCode(ticket?.failureAudit?.errorCode)
  );
}
