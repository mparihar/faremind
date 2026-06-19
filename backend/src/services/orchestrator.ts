/**
 * Flight Search Orchestrator (Backend)
 *
 * Calls Duffel (NDC) + Amadeus (GDS) + Mystifly (Aggregator) in parallel,
 * normalizes, merges, deduplicates, and ranks results.
 */

import * as duffel from './duffel';
import * as amadeus from './amadeus';
import * as mystifly from './mystifly';
import { normalizeDuffelOffer, normalizeAmadeusOffer, normalizeMystiflyOffer, mergeAndRankFlights } from './normalizer';
import { aggregateProviderOffers, type AggregationStats } from './provider-aggregation';
import type { UnifiedFlight } from '../lib/types';




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
  // Mode 1: Static session ID (no CreateSession needed)
  const sessionId = process.env.MYSTIFLY_SESSION_ID || '';
  if (sessionId.length > 0) return true;

  // Mode 2: Dynamic session via credentials
  const user = process.env.MYSTIFLY_USERNAME || '';
  const pass = process.env.MYSTIFLY_PASSWORD || '';
  const acct = process.env.MYSTIFLY_ACCOUNT_NUMBER || '';
  return user.length > 0 && pass.length > 0 && acct.length > 0;
}

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
  aggregationStats?: AggregationStats;
}

async function searchDuffel(params: {
  origin: string; destination: string; date: string;
  returnDate?: string; adults: number; children?: number;
  infants?: number; cabin?: string;
}): Promise<ProviderResult> {
  const start = Date.now();
  if (!isDuffelConfigured()) {
    return { provider: 'duffel', flights: [], responseTimeMs: 0, error: 'Duffel API not configured', isMock: true };
  }
  try {
    const offers = await duffel.searchFlights({
      origin: params.origin, destination: params.destination,
      departureDate: params.date, returnDate: params.returnDate,
      adults: params.adults, children: params.children,
      infants: params.infants, cabinClass: params.cabin || undefined,
    });
    const flights = (Array.isArray(offers) ? offers : [])
      .map((offer: any) => { try { return normalizeDuffelOffer(offer); } catch { return null; } })
      .filter(Boolean) as UnifiedFlight[];
    return { provider: 'duffel', flights, responseTimeMs: Date.now() - start, isMock: false };
  } catch (error) {
    return { provider: 'duffel', flights: [], responseTimeMs: Date.now() - start, error: (error as Error).message, isMock: false };
  }
}

async function searchAmadeus(params: {
  origin: string; destination: string; date: string;
  returnDate?: string; adults: number; children?: number;
  infants?: number; cabin?: string;
}): Promise<ProviderResult> {
  const start = Date.now();
  if (!isAmadeusConfigured()) {
    return { provider: 'amadeus', flights: [], responseTimeMs: 0, error: 'Amadeus API not configured', isMock: true };
  }
  try {
    const response = await amadeus.searchFlights({
      origin: params.origin, destination: params.destination,
      departureDate: params.date, returnDate: params.returnDate,
      adults: params.adults, children: params.children,
      infants: params.infants, travelClass: params.cabin?.toUpperCase(),
      maxResults: 50,
    });
    const data = response as { data: any[]; dictionaries?: any };
    const flights = (data?.data || [])
      .map((offer: any) => { try { return normalizeAmadeusOffer(offer, data?.dictionaries); } catch { return null; } })
      .filter(Boolean) as UnifiedFlight[];
    return { provider: 'amadeus', flights, responseTimeMs: Date.now() - start, isMock: false };
  } catch (error) {
    return { provider: 'amadeus', flights: [], responseTimeMs: Date.now() - start, error: (error as Error).message, isMock: false };
  }
}

async function searchMystifly(params: {
  origin: string; destination: string; date: string;
  returnDate?: string; adults: number; children?: number;
  infants?: number; cabin?: string;
}): Promise<ProviderResult> {
  const start = Date.now();
  if (!isMystiflyConfigured()) {
    return { provider: 'mystifly', flights: [], responseTimeMs: 0, error: 'Mystifly API not configured', isMock: true };
  }
  try {
    const response = await mystifly.searchFlights({
      origin: params.origin, destination: params.destination,
      departureDate: params.date, returnDate: params.returnDate,
      adults: params.adults, children: params.children,
      infants: params.infants, cabinClass: params.cabin || 'economy',
    });
    const itineraries = response?.Data?.PricedItineraries || response?.PricedItineraries || [];
    const flights = (Array.isArray(itineraries) ? itineraries : [])
      .map((itin: any) => { try { return normalizeMystiflyOffer(itin); } catch { return null; } })
      .filter(Boolean) as UnifiedFlight[];
    return { provider: 'mystifly', flights, responseTimeMs: Date.now() - start, isMock: false };
  } catch (error) {
    return { provider: 'mystifly', flights: [], responseTimeMs: Date.now() - start, error: (error as Error).message, isMock: false };
  }
}

export async function searchFlights(params: {
  origin: string; destination: string; date: string;
  returnDate?: string; adults: number; children?: number;
  infants?: number; cabin?: string;
  providers?: ('duffel' | 'amadeus' | 'mystifly')[];
}): Promise<SearchResult> {
  const overallStart = Date.now();
  const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  const hasDuffel = isDuffelConfigured();
  const hasAmadeus = isAmadeusConfigured();
  const hasMystifly = isMystiflyConfigured();



  let providerResults: ProviderResult[];
  if (hasDuffel || hasAmadeus || hasMystifly) {
    const promises: Promise<ProviderResult>[] = [];
    if (hasDuffel && (!params.providers || params.providers.includes('duffel'))) promises.push(searchDuffel(params));
    if (hasAmadeus && (!params.providers || params.providers.includes('amadeus'))) promises.push(searchAmadeus(params));
    if (hasMystifly && (!params.providers || params.providers.includes('mystifly'))) promises.push(searchMystifly(params));
    providerResults = await Promise.all(promises);
  } else {

    providerResults = [];
  }

  const allFlights = providerResults.flatMap((r) => r.flights);
  const { flights: aggregatedFlights, stats: aggregationStats } = aggregateProviderOffers(allFlights);
  const rankedFlights = mergeAndRankFlights(aggregatedFlights);

  console.log(`[Search ${searchId}] Complete: ${rankedFlights.length} flights in ${Date.now() - overallStart}ms`);

  return { flights: rankedFlights, providers: providerResults, searchId, totalTimeMs: Date.now() - overallStart, usedMockData: false, aggregationStats };
}

export function getProviderStatus() {
  return {
    duffel: { configured: isDuffelConfigured(), type: 'NDC' as const, description: 'Direct airline connections' },
    amadeus: { configured: isAmadeusConfigured(), type: 'GDS' as const, description: 'Global Distribution System' },
    mystifly: { configured: isMystiflyConfigured(), type: 'GDS_AGGREGATOR' as const, description: 'GDS Aggregator (MyFareBox)' },
  };
}
