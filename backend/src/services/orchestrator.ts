/**
 * Flight Search Orchestrator (Backend)
 *
 * Calls Duffel (NDC) + Amadeus (GDS) + Mystifly (Aggregator) in parallel,
 * normalizes, and merges all results using APPEND-ONLY aggregation.
 * No offers are removed or deduplicated at the aggregation layer.
 *
 * Provider mode controlled by FLIGHT_PROVIDER_MODE env var:
 *   DUFFEL  → Only Duffel
 *   MYSTIFLY → Only Mystifly
 *   BOTH    → Duffel + Mystifly in parallel (default)
 */

import * as duffel from './duffel';
import * as amadeus from './amadeus';
import * as mystifly from './mystifly';
import { normalizeDuffelOffer, normalizeAmadeusOffer, normalizeMystiflyOffer, mergeAndRankFlights } from './normalizer';
import { aggregateProviderOffers, type AggregationStats } from './provider-aggregation';
import type { UnifiedFlight } from '../lib/types';

// ─── Provider Mode (controlled by FLIGHT_PROVIDER_MODE env var) ───
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

function shouldUseDuffel(): boolean {
  const mode = getProviderMode();
  return (mode === 'DUFFEL' || mode === 'BOTH') && isDuffelConfigured();
}

function shouldUseMystifly(): boolean {
  const mode = getProviderMode();
  return (mode === 'MYSTIFLY' || mode === 'BOTH') && isMystiflyConfigured();
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
  legs?: { origin: string; destination: string; departureDate: string }[];
}): Promise<ProviderResult> {
  const start = Date.now();
  if (!isMystiflyConfigured()) {
    return { provider: 'mystifly', flights: [], responseTimeMs: 0, error: 'Mystifly API not configured', isMock: true };
  }
  try {
    // Resolve search version and fare type from admin-configured rules
    let searchVersion: string = 'v2.2';
    let pricingSource: 'Public' | 'Private' | 'All' = 'All';
    try {
      const { resolveSearchConfig, toPricingSourceType } = await import('../providers/mystifly');
      const config = await resolveSearchConfig({
        origin: params.origin,
        destination: params.destination,
      });
      searchVersion = config.version;
      pricingSource = toPricingSourceType(config.fareType);
      if (config.matchedRuleName) {
        console.log(`[Mystifly] Route ${params.origin}→${params.destination} matched rule "${config.matchedRuleName}" → ${searchVersion}, ${pricingSource}`);
      }
    } catch {
      // Fallback to defaults if resolver fails
    }

    const response = await mystifly.searchFlights({
      origin: params.origin, destination: params.destination,
      departureDate: params.date, returnDate: params.returnDate,
      adults: params.adults, children: params.children,
      infants: params.infants, cabinClass: params.cabin || 'economy',
      pricingSource,
      searchVersion,
      legs: params.legs,
    });

    const rawData = response?.Data || response || {};
    const itineraries = rawData?.PricedItineraries || response?.PricedItineraries || [];

    // ── v2.2 denormalization ──────────────────────────────
    // v2.2 uses reference-based structure: each itinerary has SegmentRef, FareRef,
    // ItineraryRef pointing to separate lists. We denormalize here into the flat
    // v1 format that normalizeMystiflyOffer expects.
    const segmentList  = rawData?.FlightSegmentList || [];
    const faresList    = rawData?.FlightFaresList || [];
    const itinRefList  = rawData?.ItineraryReferenceList || [];
    const penaltiesList = rawData?.PenaltiesInfoList || [];
    const isV2Format   = segmentList.length > 0 && faresList.length > 0;

    let denormalized: any[];

    if (isV2Format) {
      // Build lookup maps by ref index
      const segMap  = new Map<number, any>();
      for (const s of segmentList) segMap.set(s.SegmentRef, s);
      const fareMap = new Map<number, any>();
      for (const f of faresList) fareMap.set(f.FareRef, f);
      const itinRefMap = new Map<number, any>();
      for (const r of itinRefList) itinRefMap.set(r.ItineraryRef, r);
      const penaltiesMap = new Map<number, any>();
      for (const p of penaltiesList) penaltiesMap.set(p.PenaltiesInfoRef, p);

      denormalized = itineraries.map((itin: any) => {
        try {
          const ods = itin.OriginDestinations || [];
          const fare = fareMap.get(itin.FareRef);
          const penalties = penaltiesMap.get(itin.PenaltiesInfoRef);

          // Group segments by LegIndicator (0 = outbound, 1 = return, etc.)
          const legGroups = new Map<string, any[]>();
          for (const od of ods) {
            const leg = od.LegIndicator || '0';
            if (!legGroups.has(leg)) legGroups.set(leg, []);
            const seg = segMap.get(od.SegmentRef);
            const itinRef = itinRefMap.get(od.ItineraryRef);
            if (seg) {
              // Merge itinerary reference data (cabin, baggage) onto segment
              legGroups.get(leg)!.push({
                ...seg,
                MarketingAirlineCode: seg.MarketingCarriercode || seg.MarketingCarrierCode || '',
                FlightNumber: seg.MarketingFlightNumber || '',
                OperatingAirline: { Code: seg.OperatingCarrierCode || '' },
                CabinClassCode: itinRef?.CabinClassCode || 'Y',
                // Pass through EXACT API baggage value — no interpretation here
                Baggage: itinRef?.CheckinBaggage?.[0]?.Value || '',
                CabinBaggage: itinRef?.CabinBaggage?.[0]?.Value || '',
                SeatsRemaining: itinRef?.SeatsRemaining,
                FareBasisCode: itinRef?.FareBasisCodes || '',
                FareFamily: itinRef?.FareFamily || '',
              });
            }
          }

          // Build OriginDestinationOptions (what normalizer expects)
          const originDestinationOptions: any[] = [];
          const sortedLegs = [...legGroups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
          for (const [, segs] of sortedLegs) {
            originDestinationOptions.push({ FlightSegments: segs });
          }

          // Build pricing in v1 format
          let totalAmount = 0;
          let currency = fare?.Currency || 'USD';
          if (fare?.PassengerFare) {
            for (const pf of fare.PassengerFare) {
              totalAmount += parseFloat(pf.TotalFare || '0') * (pf.Quantity || 1);
            }
          }

          // Extract LIVE penalties from API — no guessing
          const penaltyDetail = penalties?.Penaltydetails?.[0];
          const refundAllowed = penaltyDetail?.RefundAllowed === true;
          const changeAllowed = penaltyDetail?.ChangeAllowed === true;
          const changePenaltyAmount = parseFloat(penaltyDetail?.ChangePenaltyAmount || '0');
          const refundPenaltyAmount = parseFloat(penaltyDetail?.RefundPenaltyAmount || '0');
          const penaltyCurrency = penaltyDetail?.Currency || '';

          return {
            FareSourceCode: itin.FareSourceCode,
            ValidatingAirlineCode: itin.ValidatingCarrier || '',
            OriginDestinationOptions: originDestinationOptions,
            AirItineraryPricingInfo: {
              ItinTotalFare: {
                TotalFare: { Amount: String(totalAmount), CurrencyCode: currency },
              },
              // LIVE from API — not hardcoded
              IsRefundable: refundAllowed,
            },
            IsRefundable: refundAllowed,
            // Pass live penalty data to normalizer
            _penalties: {
              refundAllowed,
              changeAllowed,
              changePenaltyAmount,
              refundPenaltyAmount,
              penaltyCurrency,
            },
            Provider: itin.Provider || 'MYSTIFLY',
          };
        } catch {
          return null;
        }
      }).filter(Boolean);

      console.log(`[Mystifly] v2.2 denormalized: ${denormalized.length} itineraries (from ${itineraries.length} raw, ${segmentList.length} segments, ${faresList.length} fares)`);
    } else {
      // v1 format — already flat, pass through as-is
      denormalized = Array.isArray(itineraries) ? itineraries : [];
    }

    const flights = denormalized
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
  legs?: { origin: string; destination: string; departureDate: string }[];
}): Promise<SearchResult> {
  const overallStart = Date.now();
  const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  const providerMode = getProviderMode();
  const hasDuffel = shouldUseDuffel();
  const hasAmadeus = isAmadeusConfigured();
  const hasMystifly = shouldUseMystifly();

  const isMultiCity = params.legs && params.legs.length > 0;
  console.log(`[Search ${searchId}] Provider mode: ${providerMode} → duffel=${hasDuffel} amadeus=${hasAmadeus} mystifly=${hasMystifly}${isMultiCity ? ` [MULTI-CITY: ${params.legs!.length} legs]` : ''}`);

  let providerResults: ProviderResult[];
  if (hasDuffel || hasAmadeus || hasMystifly) {
    const promises: Promise<ProviderResult>[] = [];
    // For multi-city, only Mystifly supports it currently
    if (isMultiCity) {
      if (hasMystifly && (!params.providers || params.providers.includes('mystifly'))) {
        promises.push(searchMystifly(params));
      }
      // Duffel multi-city to be added later
    } else {
      if (hasDuffel && (!params.providers || params.providers.includes('duffel'))) promises.push(searchDuffel(params));
      if (hasAmadeus && (!params.providers || params.providers.includes('amadeus'))) promises.push(searchAmadeus(params));
      if (hasMystifly && (!params.providers || params.providers.includes('mystifly'))) promises.push(searchMystifly(params));
    }
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
