/**
 * ═══════════════════════════════════════════════
 * FareMind — Money helpers (decimal-safe)
 * ═══════════════════════════════════════════════
 *
 * All payment math is done in integer MINOR UNITS (cents) to avoid
 * floating-point drift. Never multiply/add decimal dollar amounts directly.
 *
 * Stripe wants minor units; our DB stores Decimal(x,2) dollars. Convert at the
 * boundaries with these helpers only.
 */

/** Dollars (number|string|Decimal-like) → integer minor units (cents). */
export function toMinorUnits(amount: number | string): number {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error(`Invalid money amount: ${amount}`);
  // Round via string to dodge 0.1+0.2 style drift.
  return Math.round(Number(n.toFixed(2)) * 100);
}

/** Integer minor units (cents) → dollars number with 2dp. */
export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100;
}

/** Validate a positive money amount, returning it rounded to 2dp. Throws otherwise. */
export function assertPositiveAmount(amount: unknown, label = 'amount'): number {
  const n = typeof amount === 'string' ? Number(amount) : (amount as number);
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`A positive ${label} is required.`);
  }
  return Number(n.toFixed(2));
}

/** Currency-formatted string for emails/UI. */
export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `${(currency || 'USD').toUpperCase()} ${amount.toFixed(2)}`;
  }
}
