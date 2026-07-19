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

// ─── Cancellation Errors ──────────────────────────────────────────────────────

export type CancellationErrorType =
  | 'TRANSIENT'           // 500/502/503 — safe to retry
  | 'NOT_ELIGIBLE'        // Void/refund window closed, fare rules prevent it
  | 'ALREADY_CANCELLED'   // PNR already cancelled at airline level
  | 'INVALID_PNR'         // PNR not found or expired in provider system
  | 'TIMEOUT'             // Gateway timeout from Mystifly API
  | 'UNKNOWN';            // Unclassified error

/**
 * Structured cancellation error with classification.
 *
 * Wraps raw Mystifly API / PTR errors into an actionable category
 * so routes and frontend can show appropriate messages and decide
 * whether a retry is safe.
 */
export class MystiflyCancellationError extends Error {
  public readonly errorType: CancellationErrorType;
  public readonly providerErrorCode?: string;
  public readonly rawResponse?: unknown;
  public readonly httpStatus?: number;

  constructor(
    message: string,
    opts: {
      errorType?: CancellationErrorType;
      providerErrorCode?: string;
      rawResponse?: unknown;
      httpStatus?: number;
    } = {},
  ) {
    super(message);
    this.name = 'MystiflyCancellationError';
    this.providerErrorCode = opts.providerErrorCode;
    this.rawResponse = opts.rawResponse;
    this.httpStatus = opts.httpStatus;

    // Auto-classify if not explicitly provided
    this.errorType = opts.errorType ?? MystiflyCancellationError.classify(message, opts.httpStatus, opts.providerErrorCode);
  }

  /** Network-level or server error — safe to retry */
  get isTransient(): boolean {
    return this.errorType === 'TRANSIENT' || this.errorType === 'TIMEOUT';
  }

  /** Business logic rejection — do NOT retry */
  get isPermanent(): boolean {
    return this.errorType === 'NOT_ELIGIBLE' ||
           this.errorType === 'ALREADY_CANCELLED' ||
           this.errorType === 'INVALID_PNR';
  }

  /** Customer-safe error message */
  get customerMessage(): string {
    switch (this.errorType) {
      case 'TRANSIENT':
        return 'The airline\'s system is temporarily unavailable. Please try again in a few minutes.';
      case 'TIMEOUT':
        return 'The airline\'s system took too long to respond. Please try again.';
      case 'NOT_ELIGIBLE':
        return 'This booking is not eligible for cancellation at this time. Please contact FareMind Support for assistance.';
      case 'ALREADY_CANCELLED':
        return 'This booking has already been cancelled with the airline.';
      case 'INVALID_PNR':
        return 'The booking reference could not be found in the airline\'s system. Please contact FareMind Support.';
      default:
        return 'We couldn\'t process this cancellation. A support ticket has been created and our team will assist you shortly.';
    }
  }

  /** Map this error to an HTTP status code for the API response */
  get suggestedHttpStatus(): number {
    switch (this.errorType) {
      case 'TRANSIENT':
      case 'TIMEOUT':
        return 502;
      case 'ALREADY_CANCELLED':
        return 409;
      case 'INVALID_PNR':
        return 404;
      case 'NOT_ELIGIBLE':
        return 422;
      default:
        return 502;
    }
  }

  /** Error code for the frontend */
  get responseCode(): string {
    switch (this.errorType) {
      case 'TRANSIENT':
      case 'TIMEOUT':
        return 'PROVIDER_TEMPORARILY_UNAVAILABLE';
      case 'NOT_ELIGIBLE':
        return 'NOT_ELIGIBLE';
      case 'ALREADY_CANCELLED':
        return 'ALREADY_CANCELLED';
      case 'INVALID_PNR':
        return 'INVALID_PNR';
      default:
        return 'PROVIDER_CANCEL_FAILED';
    }
  }

  /**
   * Classify a raw Mystifly error message into an actionable category.
   */
  static classify(
    message: string,
    httpStatus?: number,
    providerErrorCode?: string,
  ): CancellationErrorType {
    const msg = (message || '').toLowerCase();

    // HTTP status-based classification
    if (httpStatus === 504 || /gateway\s*timeout/i.test(msg)) return 'TIMEOUT';
    if (httpStatus && [500, 502, 503].includes(httpStatus)) return 'TRANSIENT';

    // Transient server errors
    if (/\(50[023]\)|internal server error|service unavailable|bad gateway/i.test(msg)) return 'TRANSIENT';
    if (/timeout|timed?\s*out|econnreset|econnrefused|socket hang up|network/i.test(msg)) return 'TIMEOUT';

    // Already cancelled
    if (/already\s*(been\s*)?cancel|booking.*cancel|pnr.*cancel|status.*cancel/i.test(msg)) return 'ALREADY_CANCELLED';

    // PNR not found
    if (/not\s*found|invalid.*unique|invalid.*pnr|no\s*record|pnr.*expired|booking.*not.*exist/i.test(msg)) return 'INVALID_PNR';

    // Not eligible for cancellation
    if (/not\s*eligible|cannot\s*(be\s*)?cancel|not\s*allow|void.*not.*eligible|void.*window|not\s*voidable|cannot\s*void|refund\s*not\s*available/i.test(msg)) return 'NOT_ELIGIBLE';

    // Provider error code classification
    if (providerErrorCode) {
      const code = providerErrorCode.toUpperCase();
      if (['ERCNL01', 'ERCNL02'].includes(code)) return 'NOT_ELIGIBLE';
      if (code === 'ERCNL03') return 'ALREADY_CANCELLED';
    }

    return 'UNKNOWN';
  }

  /**
   * Factory: wrap any caught error into a MystiflyCancellationError.
   */
  static from(err: unknown, context?: string): MystiflyCancellationError {
    if (err instanceof MystiflyCancellationError) return err;

    const message = err instanceof Error ? err.message : String(err);
    const prefix = context ? `${context}: ` : '';

    // Extract HTTP status if available from MystiflyApiError
    const httpStatus = (err as any)?.status ?? undefined;
    const providerErrorCode = (err as any)?.errorType ?? (err as any)?.providerErrorCode ?? undefined;
    const rawResponse = (err as any)?.rawResponse ?? undefined;

    return new MystiflyCancellationError(`${prefix}${message}`, {
      httpStatus,
      providerErrorCode,
      rawResponse,
    });
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
