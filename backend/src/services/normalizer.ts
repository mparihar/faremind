/**
 * Response Normalizer (Backend)
 *
 * Converts provider-specific responses (Duffel, Amadeus, Mystifly) into
 * the unified FareMind flight schema.
 */

import type { UnifiedFlight, FlightSegment, Provider } from '../lib/types';
import { calculateValueScore, getAirlineLogo, getAirlineName, generateId } from '../lib/utils';
import type { DuffelOffer } from './duffel';
import { fromCabinType } from './mystifly';

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
      flightNumber: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`.replace(/\s+/g, ''),
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
    offerExpiresAt: offer.expires_at || undefined,
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

// ─── Mystifly normalizer ───

/**
 * Normalizes a single Mystifly PricedItinerary into a UnifiedFlight.
 *
 * Mystifly response structure (typical):
 *   PricedItinerary {
 *     FareSourceCode: string (unique offer ID — critical for booking)
 *     ValidatingAirlineCode: string
 *     AirItineraryPricingInfo: {
 *       ItinTotalFare: { TotalFare: { Amount, CurrencyCode } }
 *       PTC_FareBreakdowns: [{ PassengerFare: { ... }, PassengerTypeQuantity: { ... } }]
 *     }
 *     OriginDestinationOptions: [{
 *       FlightSegments: [{
 *         DepartureAirportLocationCode, ArrivalAirportLocationCode,
 *         DepartureDateTime, ArrivalDateTime,
 *         MarketingAirlineCode, FlightNumber,
 *         OperatingAirline: { Code },
 *         JourneyDuration, CabinClassCode,
 *         Baggage, ...
 *       }]
 *     }]
 *   }
 */
export function normalizeMystiflyOffer(itinerary: any): UnifiedFlight {
  const fareSourceCode = itinerary.FareSourceCode || '';
  const validatingAirline = itinerary.ValidatingAirlineCode || '';

  // ── Parse segments ──
  const segments: FlightSegment[] = [];
  const odOptions = itinerary.OriginDestinationOptions || [];
  let sliceCount = odOptions.length;

  for (const od of odOptions) {
    const flightSegments = od.FlightSegments || od.flightSegments || [];
    for (const seg of flightSegments) {
      const marketingCode = seg.MarketingAirlineCode || seg.marketingAirlineCode || validatingAirline;
      const operatingCode = seg.OperatingAirline?.Code || seg.operatingAirline?.code || marketingCode;
      const flightNum = seg.FlightNumber || seg.flightNumber || '';

      segments.push({
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
        flightNumber: `${marketingCode}${flightNum}`.replace(/\s+/g, ''),
        duration: parseMystiflyDuration(seg.JourneyDuration || seg.journeyDuration),
        aircraft: seg.Equipment || seg.equipment || undefined,
        operatingCarrier: operatingCode !== marketingCode
          ? { code: operatingCode, name: getAirlineName(operatingCode) }
          : undefined,
      });
    }
  }

  // ── Parse pricing ──
  const pricingInfo = itinerary.AirItineraryPricingInfo || itinerary.airItineraryPricingInfo || {};
  const itinTotalFare = pricingInfo.ItinTotalFare || pricingInfo.itinTotalFare || {};
  const totalFare = itinTotalFare.TotalFare || itinTotalFare.totalFare || {};
  const totalPrice = parseFloat(totalFare.Amount || totalFare.amount || '0');
  const currency = totalFare.CurrencyCode || totalFare.currencyCode || 'USD';

  // ── Parse cabin class ──
  const firstSegRaw = odOptions[0]?.FlightSegments?.[0] || odOptions[0]?.flightSegments?.[0];
  const cabinCode = firstSegRaw?.CabinClassCode || firstSegRaw?.cabinClassCode || 'Y';
  const cabinClass = fromCabinType(cabinCode) as UnifiedFlight['cabinClass'];

  // ── Calculate total duration ──
  let totalDuration = 0;
  for (const seg of segments) {
    totalDuration += seg.duration;
  }
  if (totalDuration === 0 && segments.length > 0) {
    const dep = new Date(segments[0].departure.time).getTime();
    const arr = new Date(segments[segments.length - 1].arrival.time).getTime();
    if (arr > dep) totalDuration = Math.round((arr - dep) / 60000);
  }

  // ── Stops ──
  const stops = Math.max(0, segments.length - sliceCount);

  // ── Fare family / brand detection ──
  const fareFamily = (firstSegRaw?.FareFamily || firstSegRaw?.fareFamily || '').toUpperCase();
  const fareBasisCode = (firstSegRaw?.FareBasisCode || firstSegRaw?.fareBasisCode || '').toUpperCase();
  const isBasicFare = fareFamily.includes('BASIC') ||
    fareFamily.includes('LITE') ||
    fareFamily.includes('LIGHT') ||
    fareBasisCode.startsWith('G') || // Common basic economy fare basis prefix
    fareBasisCode.startsWith('N');   // Another common basic economy prefix

  // ── Baggage ──
  // IMPORTANT: Mystifly's CheckinBaggage reports the route's maximum allowance,
  // NOT what's included in the specific fare brand. For "Basic" economy fares
  // (e.g. DELTA MAIN BASIC, UA BASIC ECONOMY), checked bags are NOT included
  // even though Mystifly may report "1PC".
  const baggageStr = firstSegRaw?.Baggage || firstSegRaw?.baggage || '';
  let checked = 0;
  if (baggageStr && !isBasicFare) {
    // Only credit checked bag if fare is NOT a basic/lite brand
    const kgMatch = baggageStr.match(/(\d+)K/i);
    const pcMatch = baggageStr.match(/(\d+)P/i);
    if (pcMatch) checked = parseInt(pcMatch[1]);
    else if (kgMatch) checked = parseInt(kgMatch[1]) >= 20 ? 1 : 0;
  }
  // Basic fares: checked = 0 regardless of what Mystifly reports

  // ── Fare conditions ──
  const isRefundable = itinerary.IsRefundable === true ||
    itinerary.isRefundable === true ||
    pricingInfo.IsRefundable === true;
  // Basic fares are typically not changeable without fee
  const isChangeable = !isBasicFare;

  const refundable = isRefundable;

  return {
    id: generateId(),
    provider: 'mystifly' as Provider,
    providerOfferId: fareSourceCode, // Critical — used for revalidation & booking
    airline: {
      code: validatingAirline,
      name: validatingAirline,
      logo: getAirlineLogo(validatingAirline),
    },
    segments,
    totalPrice,
    currency,
    cabinClass,
    fareRules: {
      refundable,
      changeable: isChangeable,
    },
    baggage: { carryOn: 1, checked },
    totalDuration,
    stops,
    valueScore: calculateValueScore(totalPrice, totalDuration, stops, refundable),
    fareClass: firstSegRaw?.BookingClass || firstSegRaw?.bookingClass || undefined,
  };
}

/**
 * Parse Mystifly journey duration.
 * Can be in various formats: minutes as number, "HH:MM", ISO duration, etc.
 */
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

// ─── Merge & Deduplicate ───

export function mergeAndRankFlights(flights: UnifiedFlight[]): UnifiedFlight[] {
  const seen = new Set<string>();
  const unique = flights.filter((f) => {
    // Filter out invalid offers (no price, no duration, no segments)
    if (f.totalPrice <= 0 || f.totalDuration <= 0 || f.segments.length === 0) return false;

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
