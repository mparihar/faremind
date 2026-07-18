/**
 * Limit Order Validator — Shared Lifecycle Rules
 *
 * Enforces two mandatory product constraints:
 * 1. Travel Booking Window: departure within 180 days
 * 2. Limit Order Validity: expires 90 days after creation
 *
 * Used by: Customer portal, Agent portal, AI assistant, internal tools, API
 */

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_TRAVEL_WINDOW_DAYS = 180;
export const DEFAULT_VALIDITY_DAYS = 90;
export const DEFAULT_PURGE_DELAY_HOURS = 24;
export const DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS = 24;
export const POLICY_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface TravelWindowValidation {
  valid: boolean;
  maximumAllowedDepartureDate: string; // ISO date string YYYY-MM-DD
  code: string;
  message: string;
}

export interface PolicySnapshot {
  maximumTravelWindowDays: number;
  limitOrderValidityDays: number;
  autoRenewEnabled: false;
  renewalAllowed: false;
  purgeDelayHours: number;
  minPurchaseLeadTimeHours: number;
  policyVersion: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Travel Booking Window Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that a departure date is within the allowed travel booking window.
 * Uses calendar-day logic (not fixed seconds) to avoid DST issues.
 */
export function validateTravelBookingWindow(
  requestedDepartureDate: Date | string,
  orderCreatedAt?: Date,
  configuredTravelWindowDays: number = DEFAULT_TRAVEL_WINDOW_DAYS,
): TravelWindowValidation {
  const createdAt = orderCreatedAt || new Date();
  const depDate = typeof requestedDepartureDate === 'string'
    ? new Date(requestedDepartureDate)
    : requestedDepartureDate;

  // Calculate maximum allowed departure date using calendar days
  const maxDate = new Date(createdAt);
  maxDate.setDate(maxDate.getDate() + configuredTravelWindowDays);
  // Set to end of day for inclusive comparison
  maxDate.setHours(23, 59, 59, 999);

  const maximumAllowedDepartureDate = maxDate.toISOString().split('T')[0];

  // Check if departure is in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (depDate < today) {
    return {
      valid: false,
      maximumAllowedDepartureDate,
      code: 'LIMIT_ORDER_DEPARTURE_IN_PAST',
      message: 'The departure date cannot be in the past.',
    };
  }

  // Check if departure is beyond the window
  if (depDate > maxDate) {
    return {
      valid: false,
      maximumAllowedDepartureDate,
      code: 'LIMIT_ORDER_TRAVEL_DATE_OUTSIDE_WINDOW',
      message: `Limit Orders are available only for flights departing within the next ${configuredTravelWindowDays} days.`,
    };
  }

  return {
    valid: true,
    maximumAllowedDepartureDate,
    code: 'VALID',
    message: 'Departure date is within the travel booking window.',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Expiration Computation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the expiration timestamp for a limit order.
 * Uses calendar-day addition to avoid DST inconsistencies.
 */
export function computeExpiresAt(
  createdAt: Date,
  validityDays: number = DEFAULT_VALIDITY_DAYS,
): Date {
  const expiresAt = new Date(createdAt);
  expiresAt.setDate(expiresAt.getDate() + validityDays);
  return expiresAt;
}

/**
 * Compute the purge timestamp (when the order is permanently deleted).
 */
export function computePurgeAt(
  expiresAt: Date,
  purgeDelayHours: number = DEFAULT_PURGE_DELAY_HOURS,
): Date {
  const purgeAt = new Date(expiresAt);
  purgeAt.setHours(purgeAt.getHours() + purgeDelayHours);
  return purgeAt;
}

/**
 * Check if an order's departure date is too close for safe purchase.
 */
export function isDepartureTooClose(
  departureDate: Date,
  minLeadTimeHours: number = DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS,
): boolean {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() + minLeadTimeHours);
  return departureDate <= cutoff;
}

/**
 * Compute days remaining until expiration.
 */
export function computeDaysRemaining(expiresAt: Date): number {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

/**
 * Build the policy snapshot to store at order creation.
 */
export function buildPolicySnapshot(overrides?: Partial<PolicySnapshot>): PolicySnapshot {
  return {
    maximumTravelWindowDays: DEFAULT_TRAVEL_WINDOW_DAYS,
    limitOrderValidityDays: DEFAULT_VALIDITY_DAYS,
    autoRenewEnabled: false,
    renewalAllowed: false,
    purgeDelayHours: DEFAULT_PURGE_DELAY_HOURS,
    minPurchaseLeadTimeHours: DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS,
    policyVersion: POLICY_VERSION,
    ...overrides,
  };
}

/**
 * Check if a limit order is expired (for use in guards).
 */
export function isOrderExpired(order: { status: string; expiresAt: Date | string | null }): boolean {
  if (['EXPIRED', 'CANCELLED', 'BOOKED', 'FAILED'].includes(order.status)) return true;
  if (!order.expiresAt) return false;
  const expiresAt = typeof order.expiresAt === 'string' ? new Date(order.expiresAt) : order.expiresAt;
  return new Date() >= expiresAt;
}

/**
 * Get the maximum selectable departure date for the date picker.
 */
export function getMaxDepartureDate(travelWindowDays: number = DEFAULT_TRAVEL_WINDOW_DAYS): string {
  const max = new Date();
  max.setDate(max.getDate() + travelWindowDays);
  return max.toISOString().split('T')[0];
}

/**
 * Get today's date string for min date picker value.
 */
export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}
