/**
 * Mystifly Structured Error Classes
 *
 * Extends the base MystiflyApiError from mystifly.ts with
 * granular error types for different failure scenarios.
 * Used by the checkout flow to determine the correct customer message.
 */

// Re-export the base error class
export { MystiflyApiError } from '../../services/mystifly';

// ─── Revalidation Errors ──────────────────────────────────────────────────────

export class MystiflyRevalidationError extends Error {
  constructor(
    message: string,
    public readonly fareSourceCode: string,
    public readonly providerErrorCode?: string,
    public readonly providerErrorMessage?: string,
    public readonly rawResponse?: unknown,
  ) {
    super(message);
    this.name = 'MystiflyRevalidationError';
  }

  /** Fare is genuinely no longer available — customer must re-search */
  get isFareUnavailable(): boolean {
    return this.providerErrorCode === 'ERREV01' || 
           this.message.toLowerCase().includes('no longer available');
  }

  /** Price changed — can potentially proceed with new price */
  get isPriceChanged(): boolean {
    return this.providerErrorCode === 'ERREV02' ||
           this.message.toLowerCase().includes('price changed');
  }
}

// ─── Booking Errors ───────────────────────────────────────────────────────────

export class MystiflyBookingError extends Error {
  constructor(
    message: string,
    public readonly fareSourceCode: string,
    public readonly providerErrorCode?: string,
    public readonly providerErrorMessage?: string,
    public readonly rawResponse?: unknown,
  ) {
    super(message);
    this.name = 'MystiflyBookingError';
  }

  /** Duplicate booking detected — must not retry */
  get isDuplicate(): boolean {
    return this.providerErrorCode === 'ERBUK04' ||
           this.message.toLowerCase().includes('duplicate');
  }

  /** Insufficient balance — admin must top up Mystifly account */
  get isInsufficientBalance(): boolean {
    return this.providerErrorCode === 'ERBUK06' ||
           this.message.toLowerCase().includes('insufficient');
  }

  /** Validation error — bad passenger data, missing fields, etc. */
  get isValidation(): boolean {
    return this.providerErrorCode === 'ERBUK01' ||
           this.providerErrorCode === 'ERBUK02';
  }
}

// ─── Ticketing Errors ─────────────────────────────────────────────────────────

export class MystiflyTicketingError extends Error {
  constructor(
    message: string,
    public readonly uniqueId: string,
    public readonly providerStatus?: string,
    public readonly providerErrorCode?: string,
    public readonly rawResponse?: unknown,
  ) {
    super(message);
    this.name = 'MystiflyTicketingError';
  }

  /** "Ticket-in Process" — not an error, just needs polling */
  get isTicketingPending(): boolean {
    const s = (this.providerStatus || '').toLowerCase();
    return s.includes('ticket-in process') || s.includes('in process');
  }
}

// ─── PTR Errors ───────────────────────────────────────────────────────────────

export class MystiflyPtrError extends Error {
  constructor(
    message: string,
    public readonly requestType: string,
    public readonly providerErrorCode?: string,
    public readonly rawResponse?: unknown,
  ) {
    super(message);
    this.name = 'MystiflyPtrError';
  }
}

// ─── Idempotency Errors ───────────────────────────────────────────────────────

export class BookingIdempotencyError extends Error {
  constructor(
    message: string,
    public readonly idempotencyKey: string,
    public readonly existingAttemptId?: string,
  ) {
    super(message);
    this.name = 'BookingIdempotencyError';
  }
}
