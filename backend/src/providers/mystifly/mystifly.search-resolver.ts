/**
 * Mystifly Search Version Resolver
 *
 * Determines which Mystifly search API version to use
 * for a given route/fare type combination.
 *
 * API versions:
 *   v1   — Legacy, basic search
 *   v2   — Improved response format  
 *   v2.2 — Latest, supports advanced filters (default)
 *
 * The resolver checks ProviderFareInventoryRule records to see
 * if a specific route or airline has a version override.
 * Falls back to the default (v2.2).
 */

import { prisma } from '../../lib/db';

export type MystiflySearchVersion = 'v1' | 'v2' | 'v2.2';

export interface SearchVersionConfig {
  version: MystiflySearchVersion;
  fareType: string;
  target: string;
  holdAllowed: boolean;
  holdDurationMinutes: number | null;
  matchedRuleName: string | null;
}

// Default configuration when no rule matches
const DEFAULT_CONFIG: SearchVersionConfig = {
  version: 'v2.2',
  fareType: 'Public',
  target: (process.env.MYSTIFLY_TARGET || 'Test'),
  holdAllowed: false,
  holdDurationMinutes: null,
  matchedRuleName: null,
};

/**
 * Resolve the search version and fare type for a given route.
 *
 * Checks ProviderFareInventoryRule table in priority order:
 *   1. Exact origin+destination match
 *   2. Airline-specific match
 *   3. Fare-type-only match
 *   4. Default (v2.2, Public)
 */
export async function resolveSearchConfig(params: {
  origin?: string;
  destination?: string;
  airlineCode?: string;
}): Promise<SearchVersionConfig> {
  try {
    // Find all active Mystifly rules, ordered by priority (highest first)
    const rules = await prisma.providerFareInventoryRule.findMany({
      where: {
        provider: 'MYSTIFLY',
        isActive: true,
      },
      orderBy: { priority: 'desc' },
    });

    if (rules.length === 0) {
      return DEFAULT_CONFIG;
    }

    // Try to find the most specific matching rule
    for (const rule of rules) {
      // Exact route match (highest specificity)
      if (
        rule.originAirport && rule.destinationAirport &&
        params.origin && params.destination &&
        rule.originAirport.toUpperCase() === params.origin.toUpperCase() &&
        rule.destinationAirport.toUpperCase() === params.destination.toUpperCase()
      ) {
        return ruleToConfig(rule);
      }
    }

    // Airline-specific match
    for (const rule of rules) {
      if (
        rule.airlineCode && params.airlineCode &&
        rule.airlineCode.toUpperCase() === params.airlineCode.toUpperCase() &&
        !rule.originAirport && !rule.destinationAirport
      ) {
        return ruleToConfig(rule);
      }
    }

    // Fare-type-only match (broadest)
    for (const rule of rules) {
      if (!rule.originAirport && !rule.destinationAirport && !rule.airlineCode) {
        return ruleToConfig(rule);
      }
    }

    return DEFAULT_CONFIG;
  } catch (err) {
    console.warn('[SearchVersionResolver] Error resolving config, using defaults:', (err as Error).message);
    return DEFAULT_CONFIG;
  }
}

function ruleToConfig(rule: any): SearchVersionConfig {
  return {
    version: (rule.searchVersion || 'v2.2') as MystiflySearchVersion,
    fareType: rule.fareType || 'Public',
    target: rule.target || DEFAULT_CONFIG.target,
    holdAllowed: rule.holdAllowed ?? false,
    holdDurationMinutes: rule.holdDurationMinutes,
    matchedRuleName: rule.ruleName,
  };
}

/**
 * Get the API path for a given search version.
 */
export function getSearchApiPath(version: MystiflySearchVersion): string {
  switch (version) {
    case 'v1':   return '/api/v1/Search/Flight';
    case 'v2':   return '/api/v2/Search/Flight';
    case 'v2.2': return '/api/v2.2/Search/Flight';
    default:     return '/api/v2.2/Search/Flight';
  }
}

/**
 * Map the fareType to Mystifly's PricingSourceType.
 */
export function toPricingSourceType(fareType: string): 'Public' | 'Private' | 'All' {
  const ft = (fareType || '').toLowerCase();
  if (ft === 'private') return 'Private';
  if (ft === 'public') return 'Public';
  return 'All';
}
