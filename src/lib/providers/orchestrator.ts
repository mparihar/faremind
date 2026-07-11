/**
 * Flight Search Orchestrator
 *
 * The core aggregation engine that:
 * 1. Calls Duffel (NDC) + Amadeus (GDS) + Mystifly (GDS Aggregator) in parallel
 * 2. Normalizes responses into the unified schema
 * 3. Merges, deduplicates, and ranks results
 * 4. Falls back to mock data if API keys are not configured
 * 5. Logs search analytics to the database
 *
 * Provider mode controlled by FLIGHT_PROVIDER_MODE env var:
 *   DUFFEL  → Only Duffel
 *   MYSTIFLY → Only Mystifly
 *   BOTH    → Duffel + Mystifly in parallel (default)
 *
 * This is the single source of truth for all flight search logic.
 */

import * as duffel from '@/lib/providers/duffel';
import * as amadeus from '@/lib/providers/amadeus';
import {
  normalizeDuffelOffer,
  normalizeAmadeusOffer,
  mergeAndRankFlights,
} from '@/lib/providers/normalizer';
import { normalizeDuffelRoundTripOffer } from '@/lib/providers/round-trip-normalizer';
import { searchMystiflyRoundTrip } from '@/lib/providers/mystifly-client';
import type { UnifiedFlight } from '@/lib/types';
import type { RoundTripOption } from '@/lib/round-trip-types';

// ─── Provider Mode (testing flag — easy to remove after testing) ───
// Values: 'DUFFEL' | 'MYSTIFLY' | 'BOTH' (default)

type ProviderMode = 'DUFFEL' | 'MYSTIFLY' | 'BOTH';

function getProviderMode(): ProviderMode {
  const raw = process.env.FLIGHT_PROVIDER_MODE;
  const mode = (raw || 'BOTH').toUpperCase().trim();
  if (mode === 'DUFFEL' || mode === 'MYSTIFLY' || mode === 'BOTH') {
    return mode;
  }
  return 'BOTH';
}



function shouldUseDuffel(): boolean {
  const mode = getProviderMode();
  return (mode === 'DUFFEL' || mode === 'BOTH') && isDuffelConfigured();
}

function shouldUseMystifly(): boolean {
  const mode = getProviderMode();
  return (mode === 'MYSTIFLY' || mode === 'BOTH') && isMystiflyConfigured();
}

// ─── Provider Availability Check ───

function isDuffelConfigured(): boolean {
  const token = process.env.DUFFEL_API_TOKEN || '';
  return token.length > 0 && !token.includes('your_token');
}

function isAmadeusConfigured(): boolean {
  const id = process.env.AMADEUS_CLIENT_ID || '';
  const secret = process.env.AMADEUS_CLIENT_SECRET || '';
  return id.length > 0 && !id.includes('your_') && secret.length > 0 && !secret.includes('your_');
}

function isMystiflyConfigured(): boolean {
  // If BACKEND_URL is set, Mystifly is available via the backend proxy
  // (credentials live on the backend, not the frontend)
  const backendUrl = process.env.BACKEND_URL || '';
  if (backendUrl.length > 0 && !backendUrl.includes('localhost')) return true;

  const sessionId = process.env.MYSTIFLY_SESSION_ID || '';
  if (sessionId.length > 0) return true;
  const user = process.env.MYSTIFLY_USERNAME || '';
  const pass = process.env.MYSTIFLY_PASSWORD || '';
  const acct = process.env.MYSTIFLY_ACCOUNT_NUMBER || '';
  return user.length > 0 && pass.length > 0 && acct.length > 0;
}

// ─── Provider Results ───

export interface ProviderResult {
  provider: 'duffel' | 'amadeus' | 'mystifly';
  flights: UnifiedFlight[];
  responseTimeMs: number;
  error?: string;
  isMock: boolean;
}

export interface SearchResult {
  flights: UnifiedFlight[];
  providers: ProviderResult[];
  searchId: string;
  totalTimeMs: number;
  usedMockData: boolean;
}

// ─── Duffel Search ───

async function searchDuffel(params: {
  origin: string;
  destination: string;
  date: string;
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabin?: string;
}): Promise<ProviderResult> {
  const start = Date.now();

  if (!isDuffelConfigured()) {
    return {
      provider: 'duffel',
      flights: [],
      responseTimeMs: 0,
      error: 'Duffel API not configured',
      isMock: true,
    };
  }

  try {
    const offers = await duffel.searchFlights({
      origin: params.origin,
      destination: params.destination,
      departureDate: params.date,
      returnDate: params.returnDate,
      adults: params.adults,
      children: params.children,
      infants: params.infants,
      cabinClass: params.cabin || undefined,
    });

    const flights = (Array.isArray(offers) ? offers : [])
      .map((offer: any) => {
        try {
          return normalizeDuffelOffer(offer);
        } catch (e) {
          console.warn('[Duffel] Failed to normalize offer:', (e as Error).message);
          return null;
        }
      })
      .filter(Boolean) as UnifiedFlight[];

    return {
      provider: 'duffel',
      flights,
      responseTimeMs: Date.now() - start,
      isMock: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Duffel] Search failed:', msg);
    return {
      provider: 'duffel',
      flights: [],
      responseTimeMs: Date.now() - start,
      error: msg,
      isMock: false,
    };
  }
}

// ─── Amadeus Search ───

async function searchAmadeus(params: {
  origin: string;
  destination: string;
  date: string;
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabin?: string;
}): Promise<ProviderResult> {
  const start = Date.now();

  if (!isAmadeusConfigured()) {
    return {
      provider: 'amadeus',
      flights: [],
      responseTimeMs: 0,
      error: 'Amadeus API not configured',
      isMock: true,
    };
  }

  try {
    const response = await amadeus.searchFlights({
      origin: params.origin,
      destination: params.destination,
      departureDate: params.date,
      returnDate: params.returnDate,
      adults: params.adults,
      children: params.children,
      infants: params.infants,
      travelClass: params.cabin?.toUpperCase(),
      maxResults: 50,
    });

    const data = response as { data: any[]; dictionaries?: any };
    const offers = data?.data || [];
    const dictionaries = data?.dictionaries;

    const flights = offers
      .map((offer: any) => {
        try {
          return normalizeAmadeusOffer(offer, dictionaries);
        } catch (e) {
          console.warn('[Amadeus] Failed to normalize offer:', (e as Error).message);
          return null;
        }
      })
      .filter(Boolean) as UnifiedFlight[];

    return {
      provider: 'amadeus',
      flights,
      responseTimeMs: Date.now() - start,
      isMock: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Amadeus] Search failed:', msg);
    return {
      provider: 'amadeus',
      flights: [],
      responseTimeMs: Date.now() - start,
      error: msg,
      isMock: false,
    };
  }
}

// ─── Main Orchestrator ───

export async function searchFlights(params: {
  origin: string;
  destination: string;
  date: string;
  returnDate?: string;
  adults: number;
  children?: number;
  infants?: number;
  cabin?: string;
}): Promise<SearchResult> {
  const overallStart = Date.now();
  const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  const mode = getProviderMode();

  const useDuffel = shouldUseDuffel();
  const hasAmadeus = isAmadeusConfigured();
  const useMystifly = shouldUseMystifly();
  const hasAnyProvider = useDuffel || hasAmadeus || useMystifly;


  let providerResults: ProviderResult[];

  if (hasAnyProvider) {
    const promises: Promise<ProviderResult>[] = [];
    if (useDuffel) promises.push(searchDuffel(params));
    if (hasAmadeus) promises.push(searchAmadeus(params));
    // Note: For one-way, Mystifly is handled via the backend proxy in the search route.
    // This orchestrator is used for one-way local fallback.
    providerResults = await Promise.all(promises);
  } else {

    providerResults = [];
  }

  const allFlights = providerResults.flatMap((r) => r.flights);
  const rankedFlights = mergeAndRankFlights(allFlights);
  const totalTimeMs = Date.now() - overallStart;


  return {
    flights: rankedFlights,
    providers: providerResults,
    searchId,
    totalTimeMs,
    usedMockData: false,
  };
}

// ─── Round-Trip Search ────────────────────────────────────────────────────────
// Separate from searchFlights() — does NOT touch the one-way pipeline.

export interface RoundTripSearchResult {
  options: RoundTripOption[];
  providers: ProviderResult[];
  searchId: string;
  totalTimeMs: number;
  usedMockData: boolean;
}

export async function searchRoundTripFlights(params: {
  origin: string;
  destination: string;
  date: string;
  returnDate: string;
  adults: number;
  children?: number;
  infants?: number;
  cabin?: string;
}): Promise<RoundTripSearchResult> {
  const overallStart = Date.now();
  const searchId = `rt_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const mode = getProviderMode();
  const useDuffel = shouldUseDuffel();
  const useMystifly = shouldUseMystifly();


  const options: RoundTripOption[] = [];
  const providerResults: ProviderResult[] = [];

  // ── Build parallel search promises ──
  const promises: Array<{ provider: string; promise: Promise<void> }> = [];

  // Duffel
  if (useDuffel) {
    promises.push({
      provider: 'duffel',
      promise: (async () => {
        const start = Date.now();
        try {
          // Omit cabin_class so Duffel returns offers for ALL available cabin
          // classes in a single API call — avoids rate-limiting (429) that occurs
          // when firing 4 parallel per-cabin requests.
          const raw = await duffel.searchFlights({
            origin: params.origin,
            destination: params.destination,
            departureDate: params.date,
            returnDate: params.returnDate,
            adults: params.adults,
            children: params.children,
            infants: params.infants,
            // cabinClass intentionally omitted → Duffel returns all classes
          });

          const normalized = (Array.isArray(raw) ? raw : [])
            .map((offer: any) => {
              try { return normalizeDuffelRoundTripOffer(offer); }
              catch (e) { console.warn('[RT Duffel] normalize failed:', (e as Error).message); return null; }
            })
            .filter((o): o is RoundTripOption => o !== null);

          options.push(...normalized);
          providerResults.push({ provider: 'duffel', flights: [], responseTimeMs: Date.now() - start, isMock: false });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[RT Duffel] search failed:', msg);
          providerResults.push({ provider: 'duffel', flights: [], responseTimeMs: Date.now() - start, error: msg, isMock: false });
        }
      })(),
    });
  }

  // Mystifly (via backend proxy)
  if (useMystifly) {
    promises.push({
      provider: 'mystifly',
      promise: (async () => {
        const start = Date.now();
        try {
          const result = await searchMystiflyRoundTrip({
            origin: params.origin,
            destination: params.destination,
            date: params.date,
            returnDate: params.returnDate,
            adults: params.adults,
            children: params.children,
            infants: params.infants,
            cabin: params.cabin,
          });

          if (result.error) {
            console.warn(`[RT Mystifly] Error: ${result.error}`);
            providerResults.push({ provider: 'mystifly', flights: [], responseTimeMs: result.responseTimeMs, error: result.error, isMock: false });
          } else {
            options.push(...result.options);
            providerResults.push({ provider: 'mystifly', flights: [], responseTimeMs: result.responseTimeMs, isMock: false });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[RT Mystifly] search failed:', msg);
          providerResults.push({ provider: 'mystifly', flights: [], responseTimeMs: Date.now() - start, error: msg, isMock: false });
        }
      })(),
    });
  }

  // Run all providers in parallel
  await Promise.allSettled(promises.map(p => p.promise));

  const totalTimeMs = Date.now() - overallStart;


  return { options, providers: providerResults, searchId, totalTimeMs, usedMockData: false };
}

// ─── Provider Status Check ───

export function getProviderStatus() {
  const mode = getProviderMode();
  return {
    duffel: {
      configured: isDuffelConfigured(),
      active: shouldUseDuffel(),
      type: 'NDC' as const,
      description: 'Direct airline connections',
    },
    amadeus: {
      configured: isAmadeusConfigured(),
      type: 'GDS' as const,
      description: 'Global Distribution System',
    },
    mystifly: {
      configured: isMystiflyConfigured(),
      active: shouldUseMystifly(),
      type: 'GDS_AGGREGATOR' as const,
      description: 'GDS Aggregator (MyFareBox)',
    },
    providerMode: mode,
  };
}
