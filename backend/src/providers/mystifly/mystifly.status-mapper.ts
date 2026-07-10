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
      return 'TICKETED';

    // Ticketing in progress — this is the critical one
    case 'ticket-in process':
    case 'ticket in process':
    case 'ticketing_pending':
    case 'ticket-in-process':
    case 'ticketinprocess':
    case 'in process':
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
      return 'ISSUED';

    case 'ticket-in process':
    case 'ticket in process':
    case 'ticketing_pending':
    case 'ticket-in-process':
    case 'ticketinprocess':
    case 'in process':
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
 * Gets the recommended next poll interval based on poll count.
 * Follows escalating backoff: 0s, 15s, 30s, 60s, 2m, 5m, 10m
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
  ];

  if (pollCount >= intervals.length) {
    return -1; // Signal to escalate to manual review
  }

  return intervals[pollCount];
}

/**
 * Maximum number of automatic polls before escalating to manual review.
 */
export const MAX_AUTO_POLLS = 7;
