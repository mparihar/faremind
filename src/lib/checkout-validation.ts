/**
 * ═══════════════════════════════════════════════
 * FareMind — Checkout Pricing Validation
 * ═══════════════════════════════════════════════
 *
 * Server-side module that validates checkout pricing and computes the
 * financial breakdown separating:
 *   - Provider payable (sent to Duffel/Mystifly)
 *   - FareMind revenue (markup + service fee)
 *   - Third-party vendor payables (insurance, protection vendors)
 *   - Customer grand total
 *
 * Used by the booking confirmation endpoint to ensure the frontend
 * total matches the backend source-of-truth before calling the provider.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FinancialBreakdown {
  /** Raw provider offer amount (Duffel total_amount / Mystifly TotalFare) */
  providerTotalFare: number;

  /** FareMind markup applied on top of provider fare */
  markupAmount: number;

  /** FareMind service fee (per-traveler or flat) */
  serviceFeeAmount: number;

  /** Provider seat service costs (Duffel seat add-ons) */
  seatServiceTotal: number;

  /** Meal service costs */
  mealServiceTotal: number;

  /** Extra baggage costs */
  baggageServiceTotal: number;

  /** Price drop protection fee charged to customer */
  priceProtectionAmount: number;

  /** Travel insurance premium charged to customer */
  travelInsuranceAmount: number;

  /**
   * FareMind retained revenue = markup + serviceFee
   * (protection revenue is separate if FareMind owns the product)
   */
  fareMindRevenueTotal: number;

  /**
   * Third-party vendor payable = insurance vendor payable + protection vendor payable
   * For now, this equals the full insurance/protection amounts.
   * When vendor split is configured, this can be adjusted.
   */
  thirdPartyPayableTotal: number;

  /**
   * Total sent to provider = providerTotalFare + seatServiceTotal
   * This is the ONLY amount that should appear in the provider order payment.
   */
  providerPayableTotal: number;

  /**
   * Customer grand total = providerPayableTotal + fareMindRevenue + thirdPartyPayable
   */
  customerGrandTotal: number;
}

export interface PricingValidationResult {
  valid: boolean;
  delta: number;
  error?: string;
  errorCode?: 'PRICING_MISMATCH';
}

export interface ProviderPriceCheckResult {
  valid: boolean;
  storedFare: number | null;
  revalidatedFare: number;
  deltaPct: number;
  error?: string;
  errorCode?: 'PROVIDER_PRICE_CHANGED';
}

// ─── Financial Breakdown ──────────────────────────────────────────────────────

/**
 * Computes the complete financial breakdown for a checkout.
 *
 * The key principle: the provider API receives ONLY `providerPayableTotal`.
 * Everything else (markup, fees, insurance) stays with FareMind.
 */
export function computeFinancialBreakdown(params: {
  providerTotalFare: number;
  markupAmount: number;
  serviceFeeAmount: number;
  seatServiceTotal: number;
  mealServiceTotal: number;
  baggageServiceTotal: number;
  priceProtectionAmount: number;
  travelInsuranceAmount: number;
}): FinancialBreakdown {
  const {
    providerTotalFare,
    markupAmount,
    serviceFeeAmount,
    seatServiceTotal,
    mealServiceTotal,
    baggageServiceTotal,
    priceProtectionAmount,
    travelInsuranceAmount,
  } = params;

  const fareMindRevenueTotal = round2(markupAmount + serviceFeeAmount);
  const thirdPartyPayableTotal = round2(travelInsuranceAmount + priceProtectionAmount);
  const providerPayableTotal = round2(providerTotalFare + seatServiceTotal);
  const customerGrandTotal = round2(
    providerPayableTotal + fareMindRevenueTotal + thirdPartyPayableTotal
    + mealServiceTotal + baggageServiceTotal
  );

  return {
    providerTotalFare,
    markupAmount,
    serviceFeeAmount,
    seatServiceTotal,
    mealServiceTotal,
    baggageServiceTotal,
    priceProtectionAmount,
    travelInsuranceAmount,
    fareMindRevenueTotal,
    thirdPartyPayableTotal,
    providerPayableTotal,
    customerGrandTotal,
  };
}

// ─── Pricing Validation ───────────────────────────────────────────────────────

/**
 * Validates that the frontend-submitted total matches the backend-computed total.
 *
 * If the delta exceeds `toleranceDollars`, returns an error. This prevents
 * price tampering from the client side.
 *
 * @param frontendTotal - The `pricing.total` submitted by the frontend
 * @param backendTotal  - The `customerGrandTotal` computed by the backend
 * @param toleranceDollars - Maximum allowed difference (default $0.50)
 */
export function validateCheckoutPricing(
  frontendTotal: number,
  backendTotal: number,
  toleranceDollars: number = 0.50,
): PricingValidationResult {
  const delta = Math.abs(frontendTotal - backendTotal);

  if (delta > toleranceDollars) {
    return {
      valid: false,
      delta,
      error:
        `Pricing mismatch: frontend total $${frontendTotal.toFixed(2)} vs ` +
        `backend total $${backendTotal.toFixed(2)} (delta: $${delta.toFixed(2)}, ` +
        `tolerance: $${toleranceDollars.toFixed(2)})`,
      errorCode: 'PRICING_MISMATCH',
    };
  }

  return { valid: true, delta };
}

// ─── Provider Price-Change Guard ──────────────────────────────────────────────

/**
 * Checks if the provider fare has changed since the user selected the offer.
 *
 * Compares the stored `providerTotalFare` (from the search/markup phase) with
 * the revalidated fare from the fresh offer fetch. If the difference exceeds
 * `maxDeltaPct`, the checkout should be blocked.
 *
 * @param storedFare      - The providerTotalFare stored when user selected the offer
 * @param revalidatedFare - The total_amount from the fresh GET /air/offers/:id
 * @param maxDeltaPct     - Maximum allowed change percentage (default 1%)
 */
export function checkProviderPriceChange(
  storedFare: number | null,
  revalidatedFare: number,
  maxDeltaPct: number = 1.0,
): ProviderPriceCheckResult {
  // If no stored fare available, we can't compare — allow
  if (storedFare === null || storedFare <= 0) {
    return {
      valid: true,
      storedFare,
      revalidatedFare,
      deltaPct: 0,
    };
  }

  const priceDelta = revalidatedFare - storedFare; // positive = increase, negative = decrease
  const deltaPct = (Math.abs(priceDelta) / storedFare) * 100;

  // Only reject price INCREASES — a price drop benefits the user
  if (priceDelta > 0 && deltaPct > maxDeltaPct) {
    return {
      valid: false,
      storedFare,
      revalidatedFare,
      deltaPct,
      error:
        `Provider price increased: stored $${storedFare.toFixed(2)} → ` +
        `revalidated $${revalidatedFare.toFixed(2)} (${deltaPct.toFixed(1)}% increase, ` +
        `max allowed: ${maxDeltaPct}%)`,
      errorCode: 'PROVIDER_PRICE_CHANGED',
    };
  }

  if (priceDelta < 0) {
  }

  return { valid: true, storedFare, revalidatedFare, deltaPct };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
