/**
 * Ask the backend to refund a booking that could not be made.
 *
 * Stripe refund logic lives on the backend — it owns the signed webhook that
 * reports whether a refund actually settled, and every other refund in the
 * platform already goes through it. This is the thin client so the checkout
 * route does not talk to Stripe directly.
 *
 * Never throws. It runs on a path that is already handling a failed booking, and
 * an exception here would replace "we refunded you" with a 500. A backend that
 * cannot be reached returns REFUND_PENDING, which is the truth: the money is
 * owed and has not moved.
 */
const BACKEND_URL = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');

export type BookingRefundOutcome =
  | 'REFUND_ISSUED' | 'REFUND_PENDING' | 'ALREADY_REFUNDED' | 'NOT_APPLICABLE';

export interface BookingRefundResult {
  outcome: BookingRefundOutcome;
  refundId: string | null;
  amount: number | null;
  currency: string | null;
  failureReason: string | null;
}

export async function refundBookingPayment(params: {
  paymentIntentId: string;
  reason: string;
  bookingRef?: string | null;
}): Promise<BookingRefundResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/payments/booking-refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        outcome: 'REFUND_PENDING', refundId: null, amount: null, currency: null,
        failureReason: `Backend refund returned ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    return await res.json();
  } catch (err) {
    return {
      outcome: 'REFUND_PENDING', refundId: null, amount: null, currency: null,
      failureReason: `Backend unreachable: ${(err as Error).message}`,
    };
  }
}
