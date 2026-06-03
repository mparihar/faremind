'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useCheckoutStore } from '@/store/useCheckoutStore';

/**
 * Shape returned by /api/fees/compute (matches FeeComputeResult from fee-engine.ts)
 */
export interface ComputedFees {
  serviceFee: number;
  markupFee: number;
  protectionFee: number;
  protectionFeeTotal: number;
  insuranceFee: number;
  insuranceFeeTotal: number;
  // Product metadata from DB rules
  protectionProductName?: string;
  protectionDescription?: string;
  protectionCoverage?: string;
  protectionPercentage?: number;
  insuranceProductName?: string;
  insuranceDescription?: string;
  insuranceCoverage?: string;
}

/**
 * Build a cache key from the booking context so we only re-fetch when
 * fare, passengers, or currency change.
 */
function buildCacheKey(
  fareTotal: number,
  passengerCount: number,
  currency: string,
  cabin: string,
  fareClass: string,
): string {
  return `${fareTotal}|${passengerCount}|${currency}|${cabin}|${fareClass}`;
}

/**
 * React hook that loads commercial fees from the database via /api/fees/compute
 * and populates the checkout store's `computedFees` field.
 *
 * Call this hook at the top of any checkout page that displays pricing.
 * It will:
 *  1. Build a BookingContext from the current checkout store state
 *  2. Call /api/fees/compute
 *  3. On success, call store.setComputedFees(result)
 *  4. Skip re-fetching if the booking context hasn't changed
 */
export function useFeeLoader() {
  const store = useCheckoutStore();
  const lastKeyRef = useRef<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFees = useCallback(async () => {
    const { selectedFare, passengers, currency } = useCheckoutStore.getState();
    if (!selectedFare || passengers.length === 0) return;

    const cabin = selectedFare.cabin ?? 'economy';
    const fareClass = selectedFare.name ?? '';
    const farePerPerson = selectedFare.totalPrice ?? 0;
    const fareTotal = farePerPerson * passengers.length; // total for all travelers

    // Build cache key — skip if already fetched for this context
    const key = buildCacheKey(fareTotal, passengers.length, currency, cabin, fareClass);
    if (key === lastKeyRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const paxForEngine = passengers.map((p) => ({
        id: p.id,
        type: p.type || 'adult',
        baseFare: Math.round(farePerPerson),
      }));

      const resp = await fetch('/api/fees/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'duffel',
          tripType: 'ROUND_TRIP', // TODO: detect from store
          cabin: cabin.toLowerCase(),
          fareClass,
          passengers: paxForEngine,
          supplierFareTotal: fareTotal,
          bookingTotalBeforeFees: fareTotal,
          currency: currency || 'USD',
        }),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const raw = await resp.json();

      // Extract product metadata from charges ruleSnapshot
      const protCharge = raw.charges?.find((c: any) => c.chargeType === 'PRICE_DROP_PROTECTION');
      const insCharge = raw.charges?.find((c: any) => c.chargeType === 'TRAVEL_INSURANCE');

      const result: ComputedFees = {
        serviceFee: raw.serviceFee ?? 0,
        markupFee: raw.markupFee ?? 0,
        protectionFee: raw.protectionFee ?? 0,
        protectionFeeTotal: raw.protectionFeeTotal ?? 0,
        insuranceFee: raw.insuranceFee ?? 0,
        insuranceFeeTotal: raw.insuranceFeeTotal ?? 0,
        protectionProductName: protCharge?.ruleSnapshot?.productName ?? undefined,
        protectionDescription: protCharge?.ruleSnapshot?.productDescription ?? undefined,
        protectionCoverage: protCharge?.ruleSnapshot?.coverageSummary ?? undefined,
        protectionPercentage: protCharge?.percentageValue ?? undefined,
        insuranceProductName: insCharge?.ruleSnapshot?.productName ?? insCharge?.ruleSnapshot?.insuranceName ?? undefined,
        insuranceDescription: insCharge?.ruleSnapshot?.productDescription ?? insCharge?.ruleSnapshot?.insuranceDescription ?? undefined,
        insuranceCoverage: insCharge?.ruleSnapshot?.coverageSummary ?? undefined,
      };

      // Store the result — buildLocalPricing() will use it instead of hardcoded fallback
      useCheckoutStore.getState().setComputedFees(result);
      lastKeyRef.current = key;
    } catch (err: any) {
      console.warn('[useFeeLoader] Failed to load fees from DB, will use fallback:', err?.message);
      setError(err?.message ?? 'Failed to load fees');
      // Don't clear computedFees — let buildLocalPricing() use its fallback
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch on mount and when key dependencies change
  useEffect(() => {
    fetchFees();
  }, [
    store.selectedFare?.totalPrice,
    store.passengers.length,
    store.currency,
    fetchFees,
  ]);

  return { loading, error, retry: fetchFees };
}

/**
 * Standalone function (not a hook) to fetch computed fees for the AI booking flow.
 * Can be called from store actions or event handlers.
 */
export async function fetchComputedFeesForContext(ctx: {
  fareTotal: number;
  passengerCount: number;
  cabin: string;
  fareClass?: string;
  currency: string;
  tripType?: string;
}): Promise<ComputedFees | null> {
  try {
    const passengers = Array.from({ length: ctx.passengerCount }, (_, i) => ({
      id: `pax_${i}`,
      type: 'adult' as const,
      baseFare: Math.round(ctx.fareTotal / ctx.passengerCount),
    }));

    const resp = await fetch('/api/fees/compute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'duffel',
        tripType: ctx.tripType || 'ROUND_TRIP',
        cabin: ctx.cabin.toLowerCase(),
        fareClass: ctx.fareClass ?? '',
        passengers,
        supplierFareTotal: ctx.fareTotal,
        bookingTotalBeforeFees: ctx.fareTotal,
        currency: ctx.currency || 'USD',
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const result = await resp.json();

    // Extract product metadata from charges ruleSnapshot
    const protCharge = result.charges?.find((c: any) => c.chargeType === 'PRICE_DROP_PROTECTION');
    const insCharge = result.charges?.find((c: any) => c.chargeType === 'TRAVEL_INSURANCE');

    const fees: ComputedFees = {
      serviceFee: result.serviceFee ?? 0,
      markupFee: result.markupFee ?? 0,
      protectionFee: result.protectionFee ?? 0,
      protectionFeeTotal: result.protectionFeeTotal ?? 0,
      insuranceFee: result.insuranceFee ?? 0,
      insuranceFeeTotal: result.insuranceFeeTotal ?? 0,
      // Product metadata from DB
      protectionProductName: protCharge?.ruleSnapshot?.productName ?? undefined,
      protectionDescription: protCharge?.ruleSnapshot?.productDescription ?? undefined,
      protectionCoverage: protCharge?.ruleSnapshot?.coverageSummary ?? undefined,
      protectionPercentage: protCharge?.percentageValue ?? undefined,
      insuranceProductName: insCharge?.ruleSnapshot?.productName ?? insCharge?.ruleSnapshot?.insuranceName ?? undefined,
      insuranceDescription: insCharge?.ruleSnapshot?.productDescription ?? insCharge?.ruleSnapshot?.insuranceDescription ?? undefined,
      insuranceCoverage: insCharge?.ruleSnapshot?.coverageSummary ?? undefined,
    };

    return fees;
  } catch (err: any) {
    console.warn('[fetchComputedFees] Failed:', err?.message);
    return null;
  }
}
