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
    baseFare: offer.base_amount ? parseFloat(offer.base_amount) : undefined,
    taxAmount: offer.tax_amount ? parseFloat(offer.tax_amount) : undefined,
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
// ── Tax code → human-readable label mapping ──
const TAX_CODE_LABELS: Record<string, string> = {
  YQF: 'Carrier-Imposed Fuel Surcharge', YQI: 'Carrier-Imposed Surcharge',
  YRI: 'Carrier-Imposed Fuel Surcharge', YRF: 'Carrier-Imposed Surcharge',
  US: 'US Transportation Tax', US2: 'US Transportation Tax',
  P2: 'Aviation Security Fee', AY: 'Passenger Civil Aviation Security Fee',
  XA: 'APHIS User Fee', XY: 'Immigration User Fee', XY2: 'Immigration User Fee',
  YC: 'Customs User Fee', XF: 'Passenger Facility Charge',
  IN: 'India User Development Fee', IN7: 'India GST',
  CJ: 'Security Charge', RN: 'Government Tax',
  GB: 'UK Air Passenger Duty', UB: 'UK Passenger Service Charge',
  QX: 'Service Charge', WY: 'Passenger Service Charge',
  TP: 'Airport Tax', OI: 'Insurance Surcharge',
  FR: 'France Aviation Tax', DE: 'Germany Aviation Tax',
};

export function normalizeMystiflyOffer(itinerary: any): UnifiedFlight {
  // v2.2 denormalized: FSC at root. v1 flat: FSC inside AirItineraryPricingInfo.
  const fareSourceCode = itinerary.FareSourceCode
    || itinerary.AirItineraryPricingInfo?.FareSourceCode
    || '';
  if (!fareSourceCode) {
    throw new Error(`Missing FareSourceCode — flight cannot be booked. Itin keys: ${Object.keys(itinerary).join(', ')}`);
  }
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

  // Extract actual base fare and taxes from Mystifly API.
  // Strategy 1: ItinTotalFare.BaseFare + ItinTotalFare.TotalTax (standard structure)
  // Strategy 2: PTC_FareBreakdowns[0].PassengerFare (per-pax breakdown)
  // Strategy 3: Derive tax = TotalFare - BaseFare if BaseFare exists but TotalTax doesn't
  const baseFareObj = itinTotalFare.BaseFare || itinTotalFare.baseFare || {};
  const totalTaxObj = itinTotalFare.TotalTax || itinTotalFare.totalTax || {};
  let parsedBaseFare = parseFloat(baseFareObj.Amount || baseFareObj.amount || '');
  let parsedTaxAmount = parseFloat(totalTaxObj.Amount || totalTaxObj.amount || '');

  // Fallback: try PTC_FareBreakdowns if ItinTotalFare doesn't have BaseFare/TotalTax
  if ((isNaN(parsedBaseFare) || isNaN(parsedTaxAmount)) && pricingInfo.PTC_FareBreakdowns) {
    const breakdowns = Array.isArray(pricingInfo.PTC_FareBreakdowns) ? pricingInfo.PTC_FareBreakdowns : [];
    // Sum across all passenger types
    let sumBase = 0, sumTax = 0;
    for (const bd of breakdowns) {
      const paxFare = bd.PassengerFare || bd.passengerFare || {};
      const paxCount = bd.PassengerTypeQuantity?.Quantity || bd.PassengerTypeQuantity?.quantity || 1;
      const bdBase = parseFloat(paxFare.BaseFare?.Amount || paxFare.baseFare?.Amount || '');
      const bdTax = parseFloat(paxFare.TotalTax?.Amount || paxFare.totalTax?.Amount || paxFare.Taxes?.Amount || '');
      if (!isNaN(bdBase)) sumBase += bdBase * paxCount;
      if (!isNaN(bdTax)) sumTax += bdTax * paxCount;
    }
    if (!isNaN(sumBase) && sumBase > 0 && isNaN(parsedBaseFare)) parsedBaseFare = sumBase;
    if (!isNaN(sumTax) && sumTax > 0 && isNaN(parsedTaxAmount)) parsedTaxAmount = sumTax;
  }

  // Fallback: derive tax from TotalFare - BaseFare
  if (!isNaN(parsedBaseFare) && isNaN(parsedTaxAmount) && totalPrice > 0 && parsedBaseFare < totalPrice) {
    parsedTaxAmount = Math.round((totalPrice - parsedBaseFare) * 100) / 100;
  }

  const providerBaseFare = !isNaN(parsedBaseFare) ? parsedBaseFare : undefined;
  const providerTaxAmount = !isNaN(parsedTaxAmount) ? parsedTaxAmount : undefined;

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

  // ── Baggage — use EXACT API data, no interpretation ──
  // Mystifly v2.2 provides per-fare-brand baggage (e.g. 0PC for Basic Economy,
  // 1PC for Economy Classic, 2PC for Main). We trust the API value as-is.
  const baggageStr = firstSegRaw?.Baggage || firstSegRaw?.baggage || '';
  let checked = 0;
  if (baggageStr) {
    const kgMatch = baggageStr.match(/(\d+)K/i);
    const pcMatch = baggageStr.match(/(\d+)P/i);
    if (pcMatch) checked = parseInt(pcMatch[1]);
    else if (kgMatch) checked = parseInt(kgMatch[1]) >= 20 ? 1 : 0;
  }

  // ── Fare conditions — use LIVE API penalties data when available ──
  const penalties = itinerary._penalties;
  let isRefundable: boolean;
  let isChangeable: boolean;
  let changeFee: number | undefined;
  let cancellationFee: number | undefined;

  if (penalties) {
    // v2.2 path: live data from PenaltiesInfoList
    isRefundable = penalties.refundAllowed === true;
    isChangeable = penalties.changeAllowed === true;
    // Only surface penalty AMOUNTS when they're in the same currency as the fare.
    // Mystifly returns penalties in the airline's filing currency (often INR) while
    // the fare is in USD, and there is no FX rate in the response — so exposing the
    // raw number as USD produced bogus fees like "$65,100". When currencies differ,
    // keep the refundable/changeable FLAGS but omit the amount (the real fee is
    // confirmed at cancellation). Empty/unknown penalty currency is treated as a match.
    const penaltyCcy = (penalties.penaltyCurrency || '').toString().toUpperCase();
    const fareCcy = (currency || 'USD').toString().toUpperCase();
    const sameCurrency = !penaltyCcy || penaltyCcy === fareCcy;
    changeFee = (sameCurrency && penalties.changePenaltyAmount > 0) ? penalties.changePenaltyAmount : undefined;
    cancellationFee = (sameCurrency && penalties.refundPenaltyAmount > 0) ? penalties.refundPenaltyAmount : undefined;
  } else {
    // v1 fallback
    isRefundable = itinerary.IsRefundable === true ||
      itinerary.isRefundable === true ||
      pricingInfo.IsRefundable === true;
    isChangeable = false; // Unknown — don't claim it
  }
  // ── Tax breakdown — pass through provider tax line items ──
  const rawTaxBreakUp: Array<{ Amount: string; TaxCode: string }> = pricingInfo._taxBreakUp || [];
  const taxBreakdown = rawTaxBreakUp
    .filter(t => parseFloat(t.Amount || '0') > 0)
    .map(t => ({
      code: t.TaxCode,
      amount: Math.round(parseFloat(t.Amount || '0') * 100) / 100,
      label: TAX_CODE_LABELS[t.TaxCode] || t.TaxCode,
    }));

  // ── Fare source (Public/Private) — from Mystifly FareType field ──
  const rawFareType = (
    itinerary.FareType
    || itinerary.fareType
    || pricingInfo.FareType
    || pricingInfo.fareType
    || ''
  ).toString().toLowerCase();
  const fareSource: 'public' | 'private' | undefined =
    rawFareType === 'private' ? 'private'
    : rawFareType === 'public' ? 'public'
    : undefined;

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
    baseFare: providerBaseFare,
    taxAmount: providerTaxAmount,
    taxBreakdown: taxBreakdown.length > 0 ? taxBreakdown : undefined,
    providerTotalFare: totalPrice, // Raw provider fare — no markup
    currency,
    cabinClass,
    fareRules: {
      refundable: isRefundable,
      changeable: isChangeable,
      changeFee,
      cancellationFee,
    },
    baggage: { carryOn: 1, checked },
    totalDuration,
    stops,
    valueScore: calculateValueScore(totalPrice, totalDuration, stops, isRefundable),
    fareClass: firstSegRaw?.BookingClass || firstSegRaw?.bookingClass || undefined,
    fareSource,
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
  // Sort: put 'branded' (v2.2) first so richer data wins dedup over 'lowest' (v1).
  // v2.2 has penalties, refundable status, fare family, baggage from PenaltiesInfoList.
  // v1 has none of that — it only has price + flight info.
  const sorted = [...flights].sort((a, b) => {
    if (a.fareType === 'branded' && b.fareType !== 'branded') return -1;
    if (a.fareType !== 'branded' && b.fareType === 'branded') return 1;
    return 0;
  });

  const seen = new Map<string, number>(); // key → index in unique[]
  const unique: UnifiedFlight[] = [];

  for (const f of sorted) {
    // Filter out invalid offers (no price, no duration, no segments)
    if (f.totalPrice <= 0 || f.totalDuration <= 0 || f.segments.length === 0) continue;

    const key = `${f.airline.code}-${f.segments[0]?.departure.time}-${f.segments[0]?.departure.airport}-${f.totalPrice}-${f.fareRules.refundable ? 'R' : 'NR'}`;

    if (seen.has(key)) {
      // Duplicate found — check if this flight has richer data and should replace
      const existingIdx = seen.get(key)!;
      const existing = unique[existingIdx];
      // Prefer: refundable > non-refundable, branded > lowest
      const incomingScore = (f.fareRules.refundable ? 2 : 0) + (f.fareType === 'branded' ? 1 : 0);
      const existingScore = (existing.fareRules.refundable ? 2 : 0) + (existing.fareType === 'branded' ? 1 : 0);
      if (incomingScore > existingScore) {
        unique[existingIdx] = f; // Replace with richer data
      }
    } else {
      seen.set(key, unique.length);
      unique.push(f);
    }
  }

  // Debug: log fareType distribution after dedup
  const ftCounts: Record<string, number> = {};
  for (const f of unique) {
    const ft = f.fareType || 'untagged';
    ftCounts[ft] = (ftCounts[ft] || 0) + 1;
  }

  return unique.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    return a.totalPrice - b.totalPrice;
  });
}
