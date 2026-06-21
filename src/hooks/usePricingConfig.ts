'use client';

import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────

export interface ServiceFeeConfig {
  model: string;       // 'FIXED_PER_BOOKING' | 'FIXED_PER_TRAVELER' | 'PERCENTAGE_OF_FARE' | etc.
  fixedAmount: number | null;
  percentageValue: number | null;
}

export interface FareTierConfig {
  id: string;
  name: string;
  cabin: string;
  priceMultiplier: number;
  displayOrder: number;
  carryOn: boolean;
  carryOnPieces: number;
  carryOnWeightKg: number | null;
  checkedBags: number;
  checkedWeightKg: number | null;
  extraBagFeeUsd: number | null;
  refundable: boolean;
  refundFeeUsd: number | null;
  changeable: boolean;
  changeFeeUsd: number | null;
  seatSelection: string;
  seatSelectionFeeUsd: number | null;
  upgradeable: boolean;
  loungeAccess: boolean;
  priorityBoarding: boolean;
  milesEarning: string;
}

export interface PricingConfig {
  serviceFee: ServiceFeeConfig | null;
  fareTiers: FareTierConfig[];
  taxRate: number | null;
  extraBagFeeUsd: number | null;
}

// ─── Defaults (used before API responds) ──────────────────

const DEFAULTS: PricingConfig = {
  serviceFee: null,
  fareTiers: [],
  taxRate: null,
  extraBagFeeUsd: null,
};

// ─── Global cache (avoid re-fetching on every mount) ──────

let cachedConfig: PricingConfig | null = null;
let fetchPromise: Promise<PricingConfig> | null = null;

async function fetchPricingConfig(): Promise<PricingConfig> {
  try {
    const res = await fetch('/api/pricing-config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[usePricingConfig] Failed to fetch pricing config:', err);
    return DEFAULTS;
  }
}

function getOrFetch(): Promise<PricingConfig> {
  if (cachedConfig) return Promise.resolve(cachedConfig);
  if (!fetchPromise) {
    fetchPromise = fetchPricingConfig().then(data => {
      cachedConfig = data;
      fetchPromise = null;
      return data;
    });
  }
  return fetchPromise;
}

// ─── Hook ─────────────────────────────────────────────────

export function usePricingConfig() {
  const [config, setConfig] = useState<PricingConfig>(cachedConfig ?? DEFAULTS);
  const [loading, setLoading] = useState(!cachedConfig);

  useEffect(() => {
    if (cachedConfig) {
      setConfig(cachedConfig);
      setLoading(false);
      return;
    }
    let cancelled = false;
    getOrFetch().then(data => {
      if (!cancelled) {
        setConfig(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { ...config, loading };
}

// ─── Helper: compute service fee from config ──────────────

/**
 * Compute service fee amount based on the DB-configured rule.
 * @param fareTotal - total fare for all passengers (before service fee)
 * @param travelerCount - number of travelers
 * @param config - service fee configuration from DB
 * @returns computed service fee in dollars (integer)
 */
export function computeServiceFee(
  fareTotal: number,
  travelerCount: number,
  config: ServiceFeeConfig | null,
): number {
  if (!config) return 0;
  switch (config.model) {
    case 'FIXED_PER_BOOKING':
      return Math.round(config.fixedAmount ?? 0);
    case 'FIXED_PER_TRAVELER':
      return Math.round((config.fixedAmount ?? 0) * travelerCount);
    case 'PERCENTAGE_OF_FARE':
      return Math.round(fareTotal * ((config.percentageValue ?? 0) / 100));
    case 'PERCENTAGE_OF_BOOKING_TOTAL':
      return Math.round(fareTotal * ((config.percentageValue ?? 0) / 100));
    case 'HYBRID':
      return Math.round(
        (config.fixedAmount ?? 0) * travelerCount +
        fareTotal * ((config.percentageValue ?? 0) / 100),
      );
    default:
      return 0;
  }
}

/** Force-refresh the cache (e.g., after admin updates a config). */
export function invalidatePricingConfig() {
  cachedConfig = null;
  fetchPromise = null;
}

/**
 * Returns the pricing config in the shape buildLocalPricing expects.
 * Usage: const pricingConfig = useBuildPricingConfig();
 *        const pricing = buildLocalPricing(store, pricingConfig);
 */
export function useBuildPricingConfig() {
  const { serviceFee, taxRate, extraBagFeeUsd } = usePricingConfig();
  return { serviceFee, taxRate, extraBagFeeUsd };
}
