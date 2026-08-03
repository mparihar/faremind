/**
 * How a cancellation gives the money back — named for what it actually is.
 *
 * A VOID and a REFUND are different mechanisms with different rules:
 *
 *   VOID    the ticket is cancelled before/just after issuance, inside the
 *           airline's void window. The full fare comes back regardless of
 *           whether the fare is refundable. Voiding fee is usually zero.
 *
 *   REFUND  the ticket is surrendered after the void window. Only a refundable
 *           fare returns money, less the airline's penalty.
 *
 * The cancel quote used to report a pre-issuance void as FULL_REFUND, which
 * labelled a non-refundable fare "Fully Refundable" — the amount was right, the
 * word was not, and it hid what happens if the void does not complete. VOIDABLE
 * keeps the good news (full amount back) while naming the mechanism honestly.
 */

export type Refundability =
  | 'FULL_REFUND'
  | 'PARTIAL_REFUND'
  | 'VOIDABLE'
  | 'NON_REFUNDABLE'
  | (string & {});

/** 'good' — full amount back · 'warn' — partial · 'bad' — nothing back. */
export type RefundabilityTone = 'good' | 'warn' | 'bad';

export function refundabilityLabel(r: Refundability | null | undefined): string {
  switch (r) {
    case 'FULL_REFUND':    return 'Fully Refundable';
    case 'PARTIAL_REFUND': return 'Partially Refundable';
    case 'VOIDABLE':       return 'Voidable — no fee';
    default:               return 'Non-refundable';
  }
}

export function refundabilityTone(r: Refundability | null | undefined): RefundabilityTone {
  switch (r) {
    // A void returns everything, so it reads as good news — it is simply not a
    // claim about the fare being refundable.
    case 'FULL_REFUND':
    case 'VOIDABLE':       return 'good';
    case 'PARTIAL_REFUND': return 'warn';
    default:               return 'bad';
  }
}
