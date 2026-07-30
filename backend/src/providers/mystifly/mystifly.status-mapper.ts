/**
 * Mystifly Status Mapper
 *
 * Normalizes raw Mystifly provider status strings into the canonical
 * FareMind booking/ticketing statuses used in the database and UI.
 *
 * Mystifly returns status strings like "Ticket-in Process", "Ticketed",
 * "Not Booked", "Cancelled" — these must be mapped to our enums.
 */

// ─── Provider Status → DB Booking Status ──────────────────────────────────────

export type NormalizedBookingStatus =
  | 'CREATED'
  | 'PAYMENT_CAPTURED'
  | 'PROVIDER_BOOKING_IN_PROGRESS'
  | 'PROVIDER_BOOKED'
  | 'CONFIRMED'
  | 'TICKETING_PENDING'
  | 'TICKETED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'PROVIDER_BOOKING_FAILED'
  | 'NOT_BOOKED';

export type NormalizedTicketingStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'TICKETING_PENDING'
  | 'ISSUED'
  | 'PARTIALLY_ISSUED'
  | 'FAILED'
  | 'VOIDED';

/**
 * Maps Mystifly's raw booking/ticketing status string to our canonical booking status.
 * Case-insensitive, handles common variations.
 */
export function mapProviderBookingStatus(rawStatus: string | null | undefined): NormalizedBookingStatus {
  const s = (rawStatus || '').trim().toLowerCase();

  switch (s) {
    // Ticketed states
    case 'ticketed':
    case 'ticket issued':
    case 'ticket-issued':
    case 'tktissued':
    case 'tktcomplete':
    case 'tktcompleted':
      return 'TICKETED';

    // Ticketing in progress — this is the critical one.
    // Mystifly TripDetails returns "TktInProcess" (no space) — must be matched
    // here, otherwise it falls through to the CONFIRMED default and the booking
    // looks ticketed/voidable with no e-ticket issued.
    case 'ticket-in process':
    case 'ticket in process':
    case 'ticketing_pending':
    case 'ticket-in-process':
    case 'ticketinprocess':
    case 'tktinprocess':
    case 'tkt-in process':
    case 'tkt in process':
    case 'in process':
    case 'placed':
    case 'ticket placed':
    case 'order placed':
      return 'TICKETING_PENDING';

    // Booked but not ticketed
    case 'booked':
    case 'confirmed':
    case 'hold':
    case 'on hold':
      return 'CONFIRMED';

    // Not booked / failed
    case 'not booked':
    case 'not_booked':
    case 'notbooked':
    case 'failed':
    case 'booking failed':
      return 'NOT_BOOKED';

    // Cancelled
    case 'cancelled':
    case 'canceled':
    case 'voided':
    case 'void':
      return 'CANCELLED';

    default:
      console.warn(`[Mystifly StatusMapper] Unknown provider status: "${rawStatus}"`);
      return 'CONFIRMED'; // Safe default — don't lose the booking
  }
}

/**
 * Maps Mystifly's raw status to our canonical ticketing status.
 */
export function mapProviderTicketingStatus(rawStatus: string | null | undefined): NormalizedTicketingStatus {
  const s = (rawStatus || '').trim().toLowerCase();

  switch (s) {
    case 'ticketed':
    case 'ticket issued':
    case 'ticket-issued':
    case 'tktissued':
    case 'tktcomplete':
    case 'tktcompleted':
      return 'ISSUED';

    case 'ticket-in process':
    case 'ticket in process':
    case 'ticketing_pending':
    case 'ticket-in-process':
    case 'ticketinprocess':
    case 'tktinprocess':
    case 'tkt-in process':
    case 'tkt in process':
    case 'in process':
    case 'placed':
    case 'ticket placed':
    case 'order placed':
      return 'TICKETING_PENDING';

    case 'not booked':
    case 'not_booked':
    case 'failed':
    case 'booking failed':
      return 'FAILED';

    case 'voided':
    case 'void':
      return 'VOIDED';

    default:
      return 'IN_PROGRESS';
  }
}

/**
 * Determines if a provider status represents a terminal (final) state.
 */
export function isTerminalStatus(rawStatus: string | null | undefined): boolean {
  const mapped = mapProviderBookingStatus(rawStatus);
  return ['TICKETED', 'CANCELLED', 'NOT_BOOKED', 'COMPLETED'].includes(mapped);
}

/**
 * Determines if a provider status means we should keep polling.
 */
export function shouldPollStatus(rawStatus: string | null | undefined): boolean {
  const mapped = mapProviderBookingStatus(rawStatus);
  return mapped === 'TICKETING_PENDING' || mapped === 'CONFIRMED';
}

/**
 * Recommended next poll interval based on poll count. Escalating backoff, then a
 * long tail — airline ticketing can take hours, so instead of giving up we keep
 * polling every 30 minutes until the max poll age (see MAX_POLL_AGE_MS).
 * Ramp: 0s, 15s, 30s, 60s, 2m, 5m, 10m, 15m, 30m, then 30m thereafter.
 */
export function getNextPollIntervalMs(pollCount: number): number {
  const intervals = [
    0,            // Immediate
    15_000,       // 15 seconds
    30_000,       // 30 seconds
    60_000,       // 1 minute
    120_000,      // 2 minutes
    300_000,      // 5 minutes
    600_000,      // 10 minutes
    900_000,      // 15 minutes
    1_800_000,    // 30 minutes
  ];
  return pollCount < intervals.length ? intervals[pollCount] : 1_800_000; // long tail: every 30 min
}

/**
 * Poll count at which we flag ops that ticketing is taking longer than usual —
 * we fire a "still pending" notice ONCE but KEEP polling (no stop).
 */
export const SLOW_ALERT_POLLS = 7;

/**
 * Stop auto-polling only after a booking has been pending this long. Until then
 * the cron keeps polling (and auto-re-queues any record that was escalated under
 * the old short-window logic). 24h covers slow carrier ticketing.
 */
export const MAX_POLL_AGE_MS = 24 * 60 * 60 * 1000;

/** @deprecated Superseded by SLOW_ALERT_POLLS + MAX_POLL_AGE_MS. Kept for compatibility. */
export const MAX_AUTO_POLLS = 7;
