/**
 * Mystifly Audit Logger
 *
 * Records all Mystifly API interactions (request/response pairs)
 * as BookingProviderPayload entries for admin support debugging.
 *
 * Non-blocking — audit failures never affect the customer flow.
 */

import { prisma } from '../../lib/db';

export type AuditPayloadType =
  | 'SEARCH'
  | 'REVALIDATION'
  | 'BOOK_FLIGHT'
  | 'ORDER_TICKET'
  | 'TICKET_STATUS'
  | 'TRIP_DETAILS'
  | 'CANCELLATION'
  | 'FARE_RULES'
  | 'SEAT_MAP'
  | 'BOOKING_NOTES'
  | 'PTR_VOID_QUOTE'
  | 'PTR_VOID'
  | 'PTR_REFUND_QUOTE'
  | 'PTR_REFUND'
  | 'PTR_REISSUE_QUOTE'
  | 'PTR_REISSUE';

interface AuditLogParams {
  bookingId?: string;
  payloadType: AuditPayloadType;
  providerReference?: string;
  request?: unknown;
  response?: unknown;
  durationMs?: number;
  error?: string;
}

/**
 * Log a Mystifly API interaction to the database.
 *
 * Non-blocking — wraps in try/catch so audit failures never
 * propagate to the caller. Fire-and-forget.
 */
export async function logMystiflyAudit(params: AuditLogParams): Promise<void> {
  try {
    await prisma.bookingProviderPayload.create({
      data: {
        bookingId: params.bookingId || '',
        provider: 'MYSTIFLY',
        payloadType: params.payloadType,
        providerReference: params.providerReference,
        payloadJson: {
          request: params.request ?? null,
          response: params.response ?? null,
          durationMs: params.durationMs ?? null,
          error: params.error ?? null,
          timestamp: new Date().toISOString(),
        } as any,
      },
    });
  } catch (err) {
    // Never throw — audit is best-effort
    console.error('[Mystifly Audit] Failed to log:', (err as Error).message);
  }
}

/**
 * Log a revalidation snapshot to the dedicated table.
 */
export async function logRevalidationSnapshot(params: {
  bookingId?: string;
  searchFareSourceCode: string;
  revalidatedFareSourceCode?: string;
  searchTotalFare?: number;
  revalidatedTotalFare?: number;
  searchCurrency?: string;
  revalidatedCurrency?: string;
  priceChanged?: boolean;
  accepted?: boolean;
  rawRequest?: unknown;
  rawResponse?: unknown;
}): Promise<string | null> {
  try {
    const snapshot = await prisma.revalidationSnapshot.create({
      data: {
        bookingId: params.bookingId,
        searchFareSourceCode: params.searchFareSourceCode,
        revalidatedFareSourceCode: params.revalidatedFareSourceCode,
        searchTotalFare: params.searchTotalFare,
        revalidatedTotalFare: params.revalidatedTotalFare,
        searchCurrency: params.searchCurrency,
        revalidatedCurrency: params.revalidatedCurrency,
        priceChanged: params.priceChanged ?? false,
        priceDifference: params.revalidatedTotalFare != null && params.searchTotalFare != null
          ? params.revalidatedTotalFare - params.searchTotalFare
          : null,
        accepted: params.accepted ?? false,
        rawRequest: params.rawRequest as any,
        rawResponse: params.rawResponse as any,
        provider: 'MYSTIFLY',
      },
    });
    return snapshot.id;
  } catch (err) {
    console.error('[Mystifly Audit] Failed to log revalidation snapshot:', (err as Error).message);
    return null;
  }
}

/**
 * Create or acquire a booking attempt lock for idempotency.
 *
 * Returns the existing attempt if the key is already locked,
 * or creates a new locked attempt.
 */
export async function acquireBookingAttempt(params: {
  idempotencyKey: string;
  fareSourceCode: string;
  paymentIntentId?: string;
  bookingId?: string;
}): Promise<{ attempt: any; isNew: boolean }> {
  // Check for existing attempt
  const existing = await prisma.bookingAttempt.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });

  if (existing) {
    // If the previous attempt completed or failed, allow a new one
    // with a different key. If it's still in progress, reject.
    if (
      existing.status === 'LOCKED' ||
      existing.status === 'PENDING' ||
      existing.status === 'PAYMENT_CAPTURED' ||
      existing.status === 'PROVIDER_BOOKING_SENT'
    ) {
      // Check if lock has expired (stale lock protection - 5 minutes)
      if (existing.lockedUntil && new Date() > existing.lockedUntil) {
        // Stale lock — update and reacquire
        const updated = await prisma.bookingAttempt.update({
          where: { id: existing.id },
          data: {
            status: 'LOCKED',
            lockedAt: new Date(),
            lockedUntil: new Date(Date.now() + 5 * 60 * 1000),
            attemptNumber: existing.attemptNumber + 1,
          },
        });
        return { attempt: updated, isNew: false };
      }

      // Active lock — reject duplicate
      return { attempt: existing, isNew: false };
    }

    // Previous attempt in terminal state — allow retry (should use new key)
    return { attempt: existing, isNew: false };
  }

  // Create new attempt with lock
  const attempt = await prisma.bookingAttempt.create({
    data: {
      bookingId: params.bookingId,
      idempotencyKey: params.idempotencyKey,
      fareSourceCode: params.fareSourceCode,
      paymentIntentId: params.paymentIntentId,
      status: 'LOCKED',
      lockedAt: new Date(),
      lockedUntil: new Date(Date.now() + 5 * 60 * 1000), // 5 minute lock
    },
  });

  return { attempt, isNew: true };
}

/**
 * Update a booking attempt's status.
 */
export async function updateBookingAttempt(
  attemptId: string,
  data: {
    status?: string;
    providerUniqueId?: string;
    providerStatus?: string;
    paymentCaptured?: boolean;
    refundInitiated?: boolean;
    refundId?: string;
    errorMessage?: string;
    rawRequest?: unknown;
    rawResponse?: unknown;
    bookingId?: string;
    completedAt?: Date;
    failedAt?: Date;
  },
): Promise<void> {
  try {
    await prisma.bookingAttempt.update({
      where: { id: attemptId },
      data: {
        ...data,
        rawRequest: data.rawRequest as any,
        rawResponse: data.rawResponse as any,
      } as any,
    });
  } catch (err) {
    console.error('[Mystifly Audit] Failed to update booking attempt:', (err as Error).message);
  }
}
