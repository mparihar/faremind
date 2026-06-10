/**
 * Response Normalizer
 *
 * Converts provider-specific responses (Duffel, Amadeus) into
 * the unified FareMind flight schema. This is the core data
 * pipeline that makes multi-source aggregation possible.
 *
 * Handles REAL Duffel API v2 response shapes where:
 * - Baggage info is inside segment.passengers[].baggages
 * - Cabin class is in segment.passengers[].cabin_class
 * - Fare brand name is on the slice level
 */

import type { UnifiedFlight, FlightSegment, Provider } from '@/lib/types';
import { calculateValueScore, getAirlineLogo, generateId } from '@/lib/utils';
import type { DuffelOffer } from './duffel';

function parseDuration(isoDuration: string): number {
  if (!isoDuration) return 0;
  // Parse ISO 8601 duration (PT5H30M) to minutes
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return 0;
  return (parseInt(match[1] || '0') * 60) + parseInt(match[2] || '0');
}

export function normalizeDuffelOffer(offer: DuffelOffer): UnifiedFlight {
  const segments: FlightSegment[] = offer.slices.flatMap((slice) =>
    slice.segments.map((seg) => ({
      id: seg.id,
      departure: {
        airport: seg.origin.iata_code,
        airportName: seg.origin.name,
        city: seg.origin.city_name || seg.origin.city?.name || seg.origin.iata_code,
        time: seg.departing_at,
        terminal: seg.origin_terminal,
      },
      arrival: {
        airport: seg.destination.iata_code,
        airportName: seg.destination.name,
        city: seg.destination.city_name || seg.destination.city?.name || seg.destination.iata_code,
        time: seg.arriving_at,
        terminal: seg.destination_terminal,
      },
      airline: {
        code: seg.marketing_carrier.iata_code,
        name: seg.marketing_carrier.name,
        logo: seg.marketing_carrier.logo_symbol_url || getAirlineLogo(seg.marketing_carrier.iata_code),
      },
      flightNumber: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`,
      duration: parseDuration(seg.duration),
      aircraft: seg.aircraft?.name,
      operatingCarrier: seg.operating_carrier.iata_code !== seg.marketing_carrier.iata_code
        ? { code: seg.operating_carrier.iata_code, name: seg.operating_carrier.name }
        : undefined,
    }))
  );

  const totalDuration = offer.slices.reduce((sum, slice) => sum + parseDuration(slice.duration), 0);
  const totalPrice = parseFloat(offer.total_amount);
  const stops = segments.length - offer.slices.length; // stops per slice, not total segments
  const refundable = offer.conditions?.refund_before_departure?.allowed ?? false;

  // Cabin class: check segment-level passengers first, then top-level
  let cabinClass: UnifiedFlight['cabinClass'] = 'economy';
  const firstSegment = offer.slices[0]?.segments[0];
  if (firstSegment?.passengers?.[0]?.cabin_class) {
    cabinClass = firstSegment.passengers[0].cabin_class.toLowerCase() as UnifiedFlight['cabinClass'];
  } else if ((offer.passengers as any)?.[0]?.cabin_class) {
    cabinClass = ((offer.passengers as any)[0].cabin_class || 'economy').toLowerCase() as UnifiedFlight['cabinClass'];
  }

  // Baggage: check segment-level passengers first, then top-level
  let carryOn = 1;
  let checked = 0;
  const segBaggages = firstSegment?.passengers?.[0]?.baggages;
  if (segBaggages && segBaggages.length > 0) {
    carryOn = segBaggages.find((b) => b.type === 'carry_on')?.quantity ?? 1;
    checked = segBaggages.find((b) => b.type === 'checked')?.quantity ?? 0;
  } else {
    const topBaggages = (offer.passengers as any)?.[0]?.baggages;
    if (topBaggages) {
      carryOn = topBaggages.find((b: any) => b.type === 'carry_on')?.quantity ?? 1;
      checked = topBaggages.find((b: any) => b.type === 'checked')?.quantity ?? 0;
    }
  }

  // Fare brand name from slice
  const fareBrandName = offer.slices[0]?.fare_brand_name;
  const cabinMarketingName = firstSegment?.passengers?.[0]?.cabin_class_marketing_name;

  return {
    id: generateId(),
    provider: 'duffel' as Provider,
    providerOfferId: offer.id,
    airline: {
      code: offer.owner.iata_code,
      name: offer.owner.name,
      logo: offer.owner.logo_symbol_url || getAirlineLogo(offer.owner.iata_code),
    },
    segments,
    totalPrice,
    currency: offer.total_currency,
    cabinClass,
    fareRules: {
      refundable,
      changeable: offer.conditions?.change_before_departure?.allowed ?? false,
      cancellationFee: offer.conditions?.refund_before_departure?.penalty_amount
        ? parseFloat(offer.conditions.refund_before_departure.penalty_amount)
        : undefined,
      changeFee: offer.conditions?.change_before_departure?.penalty_amount
        ? parseFloat(offer.conditions.change_before_departure.penalty_amount)
        : undefined,
    },
    baggage: { carryOn, checked },
    totalDuration,
    stops: Math.max(0, stops),
    valueScore: calculateValueScore(totalPrice, totalDuration, stops, refundable),
    fareClass: fareBrandName || cabinMarketingName || undefined,
    offerExpiresAt: offer.expires_at || undefined,
  };
}

// ─── Amadeus → UnifiedFlight ───

interface AmadeusOffer {
  id: string;
  source: string;
  instantTicketingRequired: boolean;
  price: {
    total: string;
    currency: string;
    grandTotal: string;
  };
  pricingOptions: { fareType: string[] };
  validatingAirlineCodes: string[];
  itineraries: {
    duration: string; // ISO 8601 duration
    segments: {
      departure: { iataCode: string; terminal?: string; at: string };
      arrival: { iataCode: string; terminal?: string; at: string };
      carrierCode: string;
      number: string;
      aircraft: { code: string };
      operating?: { carrierCode: string };
      duration: string;
      numberOfStops: number;
    }[];
  }[];
  travelerPricings: {
    fareDetailsBySegment: {
      cabin: string;
      fareBasis: string;
      class: string;
      includedCheckedBags?: { quantity?: number; weight?: number };
    }[];
  }[];
}

interface AmadeusDictionaries {
  carriers?: Record<string, string>;
  aircraft?: Record<string, string>;
  locations?: Record<string, { cityCode: string; countryCode: string }>;
}

export function normalizeAmadeusOffer(
  offer: AmadeusOffer,
  dictionaries?: AmadeusDictionaries
): UnifiedFlight {
  const carrierLookup = dictionaries?.carriers || {};
  const aircraftLookup = dictionaries?.aircraft || {};

  const segments: FlightSegment[] = offer.itineraries.flatMap((itin) =>
    itin.segments.map((seg) => ({
      id: generateId(),
      departure: {
        airport: seg.departure.iataCode,
        airportName: seg.departure.iataCode, // Would be enriched from locations dict
        city: seg.departure.iataCode,
        time: seg.departure.at,
        terminal: seg.departure.terminal,
      },
      arrival: {
        airport: seg.arrival.iataCode,
        airportName: seg.arrival.iataCode,
        city: seg.arrival.iataCode,
        time: seg.arrival.at,
        terminal: seg.arrival.terminal,
      },
      airline: {
        code: seg.carrierCode,
        name: carrierLookup[seg.carrierCode] || seg.carrierCode,
      },
      flightNumber: `${seg.carrierCode} ${seg.number}`,
      duration: parseDuration(seg.duration),
      aircraft: aircraftLookup[seg.aircraft.code] || seg.aircraft.code,
      operatingCarrier: seg.operating && seg.operating.carrierCode !== seg.carrierCode
        ? {
            code: seg.operating.carrierCode,
            name: carrierLookup[seg.operating.carrierCode] || seg.operating.carrierCode,
          }
        : undefined,
    }))
  );

  const totalDuration = offer.itineraries.reduce((sum, itin) => sum + parseDuration(itin.duration), 0);
  const totalPrice = parseFloat(offer.price.grandTotal || offer.price.total);
  const stops = segments.length - 1;
  const mainCarrier = offer.validatingAirlineCodes[0];

  // Fare details
  const fareDetails = offer.travelerPricings[0]?.fareDetailsBySegment[0];
  const cabinClass = (fareDetails?.cabin?.toLowerCase() || 'economy') as UnifiedFlight['cabinClass'];
  const checked = fareDetails?.includedCheckedBags?.quantity ?? 0;

  // Refundability (simplified — real implementation checks fare rules)
  const refundable = offer.pricingOptions?.fareType?.includes('PUBLISHED') ?? false;

  return {
    id: generateId(),
    provider: 'amadeus' as Provider,
    providerOfferId: offer.id,
    airline: {
      code: mainCarrier,
      name: carrierLookup[mainCarrier] || mainCarrier,
    },
    segments,
    totalPrice,
    currency: offer.price.currency,
    cabinClass,
    fareRules: {
      refundable,
      changeable: true, // Most GDS fares are changeable with fee
    },
    baggage: {
      carryOn: 1,
      checked,
    },
    totalDuration,
    stops,
    valueScore: calculateValueScore(totalPrice, totalDuration, stops, refundable),
    fareClass: fareDetails?.class || undefined,
  };
}

// ─── Merge & Deduplicate ───

export function mergeAndRankFlights(flights: UnifiedFlight[]): UnifiedFlight[] {
  // Remove duplicates (same route + airline + time = likely same flight)
  const seen = new Set<string>();
  const unique = flights.filter((f) => {
    const key = `${f.airline.code}-${f.segments[0]?.departure.time}-${f.segments[0]?.departure.airport}-${f.totalPrice}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by value score descending, then price ascending
  return unique.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    return a.totalPrice - b.totalPrice;
  });
}
