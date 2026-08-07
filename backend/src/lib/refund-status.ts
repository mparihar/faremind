/**
 * Where a failed booking's money currently is.
 *
 * A booking failure opens a support ticket, and the only question anyone
 * triaging that queue is actually asking is "does somebody have to do something
 * about this money". Four places were answering it independently — the confirm
 * route deciding the ticket's priority and queue, the Stripe webhook deciding
 * whether to reopen it, the queue list badge, and the ticket detail panel — and
 * they did not agree.
 *
 * The disagreement that mattered: REFUND_PENDING means two opposite things.
 * Stripe accepting a refund that has not settled yet is money in flight, which
 * needs watching and nothing else. A refund call that failed is money still in
 * our account, which needs a human. The confirm route called both of them
 * "MANUAL REFUND REQUIRED (auto-refund failed: unknown)", so the manual-refund
 * queue filled with refunds that were fine — and a queue that cries wolf stops
 * being read, which is how the ones that were real get missed.
 *
 * One classifier now, so a state cannot mean different things on different
 * screens.
 */

export type RefundState =
  /** The card was never charged. There is no money to chase. */
  | 'NOT_CHARGED'
  /** Stripe confirmed the money is back on the original card. Done. */
  | 'REFUNDED'
  /** Stripe accepted the refund; it has not settled. Watch, do not act. */
  | 'IN_FLIGHT'
  /** The customer is owed money that has not been sent. Someone must act. */
  | 'OWED'
  /** Charged, with no refund recorded either way. Unknown, so treat as owed. */
  | 'UNRESOLVED'
  /** Charged, and correctly kept — no refund is due. */
  | 'NOT_APPLICABLE';

/** The fields a BookingFailureAudit carries about the money. */
export interface RefundFacts {
  stripePaymentIntentId?: string | null;
  refundStatus?: string | null;
  refundId?: string | null;
  refundFailureReason?: string | null;
}

export function classifyRefund(facts: RefundFacts | null | undefined): RefundState {
  if (!facts) return 'UNRESOLVED';

  // No payment intent means the booking failed before capture. Saying "not
  // refunded" about a card that was never charged sends staff to phone a
  // customer who was never billed.
  if (!facts.stripePaymentIntentId) return 'NOT_CHARGED';

  switch (facts.refundStatus) {
    case 'REFUND_ISSUED':
    case 'ALREADY_REFUNDED':
      return 'REFUNDED';

    case 'NOT_APPLICABLE':
      return 'NOT_APPLICABLE';

    case 'REFUND_FAILED':
      return 'OWED';

    case 'REFUND_PENDING':
      // A recorded failure reason is definitive: it did not go through, whether
      // the call never left or Stripe reversed it afterwards. Otherwise a refund
      // id means Stripe is holding it and it is moving; no id means the call
      // never landed and nothing is coming.
      if (facts.refundFailureReason) return 'OWED';
      return facts.refundId ? 'IN_FLIGHT' : 'OWED';

    default:
      // Charged, and nothing has claimed responsibility. Money with no plan is
      // the state most worth surfacing, so it is never treated as settled.
      return 'UNRESOLVED';
  }
}

/** Does this need to stay on someone's screen? */
export function needsAttention(state: RefundState): boolean {
  return state === 'IN_FLIGHT' || state === 'OWED' || state === 'UNRESOLVED';
}

/**
 * Which support queue this belongs in.
 *
 * Kept apart deliberately: MANUAL_REFUND_REQUIRED is a work queue someone has to
 * clear, REFUND_MONITORING is a watch list that empties itself when the webhook
 * confirms. Merging them is what made the work queue untrustworthy.
 */
export function refundQueue(state: RefundState): string | null {
  if (state === 'OWED' || state === 'UNRESOLVED') return 'MANUAL_REFUND_REQUIRED';
  if (state === 'IN_FLIGHT') return 'REFUND_MONITORING';
  return null;
}

/** Short badge text, shared by the queue list and the ticket detail panel. */
export function refundLabel(state: RefundState): string | null {
  switch (state) {
    case 'REFUNDED':       return 'Refunded';
    case 'IN_FLIGHT':      return 'Refund in flight';
    case 'OWED':           return 'Refund owed';
    case 'UNRESOLVED':     return 'Unresolved';
    case 'NOT_CHARGED':    return 'Not charged';
    case 'NOT_APPLICABLE': return null;   // nothing to say
  }
}

/** One line of staff-facing explanation. Never shown to a customer. */
export function refundDetail(state: RefundState): string {
  switch (state) {
    case 'REFUNDED':
      return 'Confirmed by Stripe — the full amount is back on the original card.';
    case 'IN_FLIGHT':
      return 'Accepted by Stripe, not yet settled. This closes itself when the webhook confirms — no manual refund needed.';
    case 'OWED':
      return 'The refund did not go through. The customer is still owed this money and it must be refunded by hand.';
    case 'UNRESOLVED':
      return 'The card was charged and no refund has been recorded. Confirm in Stripe before closing this ticket.';
    case 'NOT_CHARGED':
      return 'The card was never charged — the booking failed before payment was captured.';
    case 'NOT_APPLICABLE':
      return 'No refund is owed on this booking.';
  }
}
