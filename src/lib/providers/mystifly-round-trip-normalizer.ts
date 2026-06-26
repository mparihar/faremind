/**
 * Mystifly Round-Trip Normalizer
 *
 * Converts a Mystifly PricedItinerary that has 2 OriginDestinationOptions
 * (outbound + return) into a RoundTripOption.
 *
 * This mirrors what round-trip-normalizer.ts does for Duffel offers.
 */

import type { CabinClass, FlightSegment } from '@/lib/types';
import type { JourneySegment, Layover, RoundTripOption } from '@/lib/round-trip-types';
import { generateId, getAirlineLogo, getAirlineName } from '@/lib/utils';

// ── Cabin mapping (same as backend/src/services/mystifly.ts) ──

const CABIN_REVERSE_MAP: Record<string, string> = {
  Y: 'economy',
  S: 'premium_economy',
  C: 'business',
  J: 'business',
  F: 'first',
  P: 'first',
};

function fromCabinType(cabinType: string): string {
  return CABIN_REVERSE_MAP[cabinType] || 'economy';
}

// ── Duration parser ──

function parseMystiflyDuration(duration: any): number {
  if (!duration) return 0;
  if (typeof duration === 'number') return duration;
  const str = String(duration);

  // Try HH:MM format
  const hmMatch = str.match(/^(\d+):(\d+)$/);
  if (hmMatch) return parseInt(hmMatch[1]) * 60 + parseInt(hmMatch[2]);

  // Try ISO duration PT5H30M
  const isoMatch = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (isoMatch) return (parseInt(isoMatch[1] || '0') * 60) + parseInt(isoMatch[2] || '0');

  // Try plain minutes
  const mins = parseInt(str);
  return isNaN(mins) ? 0 : mins;
}

// ── OriginDestinationOption → JourneySegment ──

function odToJourney(
  od: any,
  direction: 'outbound' | 'return',
  validatingAirline: string,
): JourneySegment {
  const flightSegments = od.FlightSegments || od.flightSegments || [];

  // Build normalized segments
  const segments: FlightSegment[] = flightSegments.map((seg: any) => {
    const marketingCode = seg.MarketingAirlineCode || seg.marketingAirlineCode || validatingAirline;
    const operatingCode = seg.OperatingAirline?.Code || seg.operatingAirline?.code || marketingCode;
    const flightNum = seg.FlightNumber || seg.flightNumber || '';

    return {
      id: generateId(),
      departure: {
        airport: seg.DepartureAirportLocationCode || seg.departureAirportLocationCode || '',
        airportName: seg.DepartureAirportLocationCode || '',
        city: seg.DepartureAirportLocationCode || '',
        time: seg.DepartureDateTime || seg.departureDateTime || '',
        terminal: seg.DepartureTerminal || seg.departureTerminal || undefined,
      },
      arrival: {
        airport: seg.ArrivalAirportLocationCode || seg.arrivalAirportLocationCode || '',
        airportName: seg.ArrivalAirportLocationCode || '',
        city: seg.ArrivalAirportLocationCode || '',
        time: seg.ArrivalDateTime || seg.arrivalDateTime || '',
        terminal: seg.ArrivalTerminal || seg.arrivalTerminal || undefined,
      },
      airline: {
        code: marketingCode,
        name: getAirlineName(marketingCode),
        logo: getAirlineLogo(marketingCode),
      },
      flightNumber: `${marketingCode} ${flightNum}`,
      duration: parseMystiflyDuration(seg.JourneyDuration || seg.journeyDuration),
      aircraft: seg.Equipment || seg.equipment || undefined,
      operatingCarrier: operatingCode !== marketingCode
        ? { code: operatingCode, name: getAirlineName(operatingCode) }
        : undefined,
    };
  });

  // Duration: sum segment durations + layover gaps
  let durationMinutes = 0;
  if (segments.length > 0) {
    const dep = new Date(segments[0].departure.time).getTime();
    const arr = new Date(segments[segments.length - 1].arrival.time).getTime();
    if (arr > dep) durationMinutes = Math.round((arr - dep) / 60000);
  }
  // Fallback to sum of individual durations
  if (durationMinutes === 0) {
    durationMinutes = segments.reduce((sum, s) => sum + s.duration, 0);
  }

  // Layovers from gaps between consecutive segments
  const layovers: Layover[] = segments.slice(0, -1).map((seg, i) => {
    const arrMs = new Date(seg.arrival.time).getTime();
    const depMs = new Date(segments[i + 1].departure.time).getTime();
    return {
      airport: seg.arrival.airport,
      airportName: seg.arrival.airportName,
      durationMinutes: Math.max(0, Math.round((depMs - arrMs) / 60000)),
      terminalChange: seg.arrival.terminal !== segments[i + 1].departure.terminal,
    };
  });

  const stopAirports = segments.slice(0, -1).map(s => s.arrival.airport);
  const airlineCodes = [...new Set(segments.map(s => s.airline.code))];
  const airlineNames = [...new Set(segments.map(s => s.airline.name))];
  const flightNumbers = segments.map(s => s.flightNumber);

  return {
    direction,
    departureAirport: segments[0]?.departure.airport ?? '',
    arrivalAirport: segments[segments.length - 1]?.arrival.airport ?? '',
    departureTime: segments[0]?.departure.time ?? '',
    arrivalTime: segments[segments.length - 1]?.arrival.time ?? '',
    durationMinutes,
    stops: Math.max(0, segments.length - 1),
    stopAirports,
    airlineCodes,
    airlineNames,
    flightNumbers,
    layovers,
    segments,
  };
}

// ── Public API ──

/**
 * Convert a Mystifly PricedItinerary (round-trip, 2 OD options) into a RoundTripOption.
 * Returns null if the itinerary doesn't have exactly 2 origin-destination options.
 */
export function normalizeMystiflyRoundTripOffer(itinerary: any): RoundTripOption | null {
  const odOptions = itinerary.OriginDestinationOptions || [];
  if (odOptions.length < 2) return null;

  const fareSourceCode = itinerary.FareSourceCode || '';
  const validatingAirline = itinerary.ValidatingAirlineCode || '';

  const outbound = odToJourney(odOptions[0], 'outbound', validatingAirline);
  const ret = odToJourney(odOptions[1], 'return', validatingAirline);

  const allCodes = [...new Set([...outbound.airlineCodes, ...ret.airlineCodes])];
  const allNames = [...new Set([...outbound.airlineNames, ...ret.airlineNames])];

  // Cabin class from first segment
  const firstSeg = odOptions[0]?.FlightSegments?.[0] || odOptions[0]?.flightSegments?.[0];
  const cabinCode = firstSeg?.CabinClassCode || firstSeg?.cabinClassCode || 'Y';
  const cabinClass = fromCabinType(cabinCode) as CabinClass;

  // Pricing
  const pricingInfo = itinerary.AirItineraryPricingInfo || itinerary.airItineraryPricingInfo || {};
  const itinTotalFare = pricingInfo.ItinTotalFare || pricingInfo.itinTotalFare || {};
  const totalFare = itinTotalFare.TotalFare || itinTotalFare.totalFare || {};
  const totalPrice = parseFloat(totalFare.Amount || totalFare.amount || '0');
  const currency = totalFare.CurrencyCode || totalFare.currencyCode || 'USD';

  // Baggage
  const baggageStr = firstSeg?.Baggage || firstSeg?.baggage || '';
  let checked = 0;
  if (baggageStr) {
    const pcMatch = baggageStr.match(/(\d+)P/i);
    const kgMatch = baggageStr.match(/(\d+)K/i);
    if (pcMatch) checked = parseInt(pcMatch[1]);
    else if (kgMatch) checked = parseInt(kgMatch[1]) >= 20 ? 1 : 0;
  }

  // Fare conditions
  const isRefundable = itinerary.IsRefundable === true ||
    itinerary.isRefundable === true ||
    pricingInfo.IsRefundable === true;

  // Filter out invalid itineraries
  if (totalPrice <= 0) return null;

  return {
    id: generateId(),
    providerOfferId: fareSourceCode,
    provider: 'mystifly',
    outboundJourney: outbound,
    returnJourney: ret,
    totalPrice,
    currency,
    totalDurationMinutes: outbound.durationMinutes + ret.durationMinutes,
    totalStops: outbound.stops + ret.stops,
    maxStopsOneWay: Math.max(outbound.stops, ret.stops),
    airlines: allNames,
    airlineCodes: allCodes,
    bookingProvider: validatingAirline,
    cabinClass,
    fareRules: {
      refundable: isRefundable,
      changeable: undefined as unknown as boolean, // Mystifly search API doesn't provide changeability
    },
    baggage: { carryOn: 1, checked },
  };
}
