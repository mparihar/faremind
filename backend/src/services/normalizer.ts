/**
 * Response Normalizer (Backend)
 *
 * Converts provider-specific responses (Duffel, Amadeus) into
 * the unified FareMind flight schema.
 */

import type { UnifiedFlight, FlightSegment, Provider } from '../lib/types';
import { calculateValueScore, getAirlineLogo, generateId } from '../lib/utils';
import type { DuffelOffer } from './duffel';

function parseDuration(isoDuration: string): number {
  if (!isoDuration) return 0;
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

  let totalDuration = offer.slices.reduce((sum, slice) => sum + parseDuration(slice.duration), 0);
  if (totalDuration === 0 && segments.length > 0) {
    const dep = new Date(segments[0].departure.time).getTime();
    const arr = new Date(segments[segments.length - 1].arrival.time).getTime();
    if (arr > dep) totalDuration = Math.round((arr - dep) / 60000);
  }
  const totalPrice = parseFloat(offer.total_amount);
  const stops = segments.length - offer.slices.length;
  const refundable = offer.conditions?.refund_before_departure?.allowed ?? false;

  let cabinClass: UnifiedFlight['cabinClass'] = 'economy';
  const firstSegment = offer.slices[0]?.segments[0];
  if (firstSegment?.passengers?.[0]?.cabin_class) {
    cabinClass = firstSegment.passengers[0].cabin_class.toLowerCase() as UnifiedFlight['cabinClass'];
  } else if ((offer.passengers as any)?.[0]?.cabin_class) {
    cabinClass = ((offer.passengers as any)[0].cabin_class || 'economy').toLowerCase() as UnifiedFlight['cabinClass'];
  }

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
  };
}

// ─── Amadeus normalizer ───

export function normalizeAmadeusOffer(offer: any, dictionaries?: any): UnifiedFlight {
  const carrierLookup = dictionaries?.carriers || {};
  const aircraftLookup = dictionaries?.aircraft || {};

  const segments: FlightSegment[] = offer.itineraries.flatMap((itin: any) =>
    itin.segments.map((seg: any) => ({
      id: generateId(),
      departure: {
        airport: seg.departure.iataCode,
        airportName: seg.departure.iataCode,
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
      aircraft: aircraftLookup[seg.aircraft?.code] || seg.aircraft?.code,
      operatingCarrier: seg.operating && seg.operating.carrierCode !== seg.carrierCode
        ? { code: seg.operating.carrierCode, name: carrierLookup[seg.operating.carrierCode] || seg.operating.carrierCode }
        : undefined,
    }))
  );

  const totalDuration = offer.itineraries.reduce((sum: number, itin: any) => sum + parseDuration(itin.duration), 0);
  const totalPrice = parseFloat(offer.price.grandTotal || offer.price.total);
  const stops = segments.length - 1;
  const mainCarrier = offer.validatingAirlineCodes[0];
  const fareDetails = offer.travelerPricings[0]?.fareDetailsBySegment[0];
  const cabinClass = (fareDetails?.cabin?.toLowerCase() || 'economy') as UnifiedFlight['cabinClass'];
  const checked = fareDetails?.includedCheckedBags?.quantity ?? 0;
  const refundable = offer.pricingOptions?.fareType?.includes('PUBLISHED') ?? false;

  return {
    id: generateId(),
    provider: 'amadeus' as Provider,
    providerOfferId: offer.id,
    airline: { code: mainCarrier, name: carrierLookup[mainCarrier] || mainCarrier },
    segments,
    totalPrice,
    currency: offer.price.currency,
    cabinClass,
    fareRules: { refundable, changeable: true },
    baggage: { carryOn: 1, checked },
    totalDuration,
    stops,
    valueScore: calculateValueScore(totalPrice, totalDuration, stops, refundable),
    fareClass: fareDetails?.class || undefined,
  };
}

// ─── Merge & Deduplicate ───

export function mergeAndRankFlights(flights: UnifiedFlight[]): UnifiedFlight[] {
  const seen = new Set<string>();
  const unique = flights.filter((f) => {
    const key = `${f.airline.code}-${f.segments[0]?.departure.time}-${f.segments[0]?.departure.airport}-${f.totalPrice}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    return a.totalPrice - b.totalPrice;
  });
}
