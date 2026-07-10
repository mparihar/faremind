/**
 * Mystifly Provider Module — Barrel Export
 *
 * New modular architecture for Mystifly/MyFareBox integration.
 * The original mystifly.ts in services/ remains the API client.
 * These modules add:
 *   - Status normalization (Ticket-in-Process → TICKETING_PENDING)
 *   - Structured error classes
 *   - Audit logging with revalidation snapshots
 *   - Booking idempotency
 *
 * Usage:
 *   import { mapProviderBookingStatus } from '../providers/mystifly';
 *   import { MystiflyBookingError } from '../providers/mystifly';
 */

export {
  mapProviderBookingStatus,
  mapProviderTicketingStatus,
  isTerminalStatus,
  shouldPollStatus,
  getNextPollIntervalMs,
  MAX_AUTO_POLLS,
  type NormalizedBookingStatus,
  type NormalizedTicketingStatus,
} from './mystifly.status-mapper';

export {
  MystiflyApiError,
  MystiflyRevalidationError,
  MystiflyBookingError,
  MystiflyTicketingError,
  MystiflyPtrError,
  BookingIdempotencyError,
} from './mystifly.errors';

export {
  logMystiflyAudit,
  logRevalidationSnapshot,
  acquireBookingAttempt,
  updateBookingAttempt,
  type AuditPayloadType,
} from './mystifly.audit';

export {
  resolveSearchConfig,
  getSearchApiPath,
  toPricingSourceType,
  type MystiflySearchVersion,
  type SearchVersionConfig,
} from './mystifly.search-resolver';
