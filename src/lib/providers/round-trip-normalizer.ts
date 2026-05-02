/**
 * Round-Trip Normalizer
 *
 * Converts a Duffel offer that has exactly 2 slices (outbound + return)
 * into a RoundTripOption.  The one-way normalizer is NOT touched.
 */

import type { DuffelOffer, DuffelSlice } from './duffel';
import type { CabinClass } from '@/lib/types';
import type { JourneySegment, Layover, RoundTripOption } from '@/lib/round-trip-types';
import { generateId } from '@/lib/utils';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDuration(iso: string): number {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return parseInt(m[1] || '0') * 60 + parseInt(m[2] || '0');
}

// ─── Slice → JourneySegment ──────────────────────────────────────────────────

function sliceToJourney(slice: DuffelSlice, direction: 'outbound' | 'return'): JourneySegment {
  const segs = slice.segments;

  // Duration: prefer slice-level field, fall back to time diff
  let durationMinutes = parseDuration(slice.duration);
  if (durationMinutes === 0 && segs.length > 0) {
    const dep = new Date(segs[0].departing_at).getTime();
    const arr = new Date(segs[segs.length - 1].arriving_at).getTime();
    if (arr > dep) durationMinutes = Math.round((arr - dep) / 60000);
  }

  // Layovers from connection gaps between consecutive segments
  const layovers: Layover[] = segs.slice(0, -1).map((seg, i) => ({
    airport: seg.destination.iata_code,
    airportName: seg.destination.name,
    durationMinutes: Math.max(
      0,
      Math.round(
        (new Date(segs[i + 1].departing_at).getTime() - new Date(seg.arriving_at).getTime()) / 60000
      )
    ),
    terminalChange: seg.destination_terminal !== segs[i + 1].origin_terminal
  }));

  const stopAirports = segs.slice(0, -1).map((s) => s.destination.iata_code);
  const airlineCodes = [...new Set(segs.map((s) => s.marketing_carrier.iata_code))];
  const airlineNames = [...new Set(segs.map((s) => s.marketing_carrier.name))];
  const flightNumbers = segs.map((s) => `${s.marketing_carrier.iata_code}${s.marketing_carrier_flight_number || ''}`);

  const normalizedSegments = segs.map((s, idx) => ({
    id: s.id,
    departure: {
      airport: s.origin.iata_code,
      airportName: s.origin.name,
      city: s.origin.city_name || s.origin.name,
      time: s.departing_at,
      terminal: s.origin_terminal,
      gate: `G${10 + idx * 5}`, // Mocking gate since not in Duffel API
    },
    arrival: {
      airport: s.destination.iata_code,
      airportName: s.destination.name,
      city: s.destination.city_name || s.destination.name,
      time: s.arriving_at,
      terminal: s.destination_terminal,
      gate: `G${12 + idx * 5}`, // Mocking gate
    },
    airline: {
      code: s.marketing_carrier.iata_code,
      name: s.marketing_carrier.name,
    },
    flightNumber: `${s.marketing_carrier.iata_code}${s.marketing_carrier_flight_number}`,
    duration: parseDuration(s.duration),
    aircraft: s.aircraft?.name,
    amenities: {
      wifi: true,
      power: true,
      entertainment: true,
    }
  }));

  return {
    direction,
    departureAirport: segs[0].origin.iata_code,
    arrivalAirport: segs[segs.length - 1].destination.iata_code,
    departureTime: segs[0].departing_at,
    arrivalTime: segs[segs.length - 1].arriving_at,
    durationMinutes,
    stops: segs.length - 1,
    stopAirports,
    airlineCodes,
    airlineNames,
    flightNumbers,
    layovers,
    segments: normalizedSegments,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns null when the offer is not a round-trip (< 2 slices).
 * The one-way normalizer handles those instead.
 */
export function normalizeDuffelRoundTripOffer(offer: DuffelOffer): RoundTripOption | null {
  if (!offer.slices || offer.slices.length < 2) return null;

  const outbound = sliceToJourney(offer.slices[0], 'outbound');
  const ret = sliceToJourney(offer.slices[1], 'return');

  const allCodes = [...new Set([...outbound.airlineCodes, ...ret.airlineCodes])];
  const allNames = [...new Set([...outbound.airlineNames, ...ret.airlineNames])];

  // Cabin class: read from the first segment's passenger entry
  const firstSeg = offer.slices[0].segments[0];
  let cabinClass: CabinClass = 'economy';
  if (firstSeg?.passengers?.[0]?.cabin_class) {
    cabinClass = firstSeg.passengers[0].cabin_class.toLowerCase() as CabinClass;
  } else if ((offer.passengers as any)?.[0]?.cabin_class) {
    cabinClass = ((offer.passengers as any)[0].cabin_class || 'economy').toLowerCase() as CabinClass;
  }

  // Baggage
  let carryOn = 1;
  let checked = 0;
  const segBaggages = firstSeg?.passengers?.[0]?.baggages;
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

  return {
    id: generateId(),
    providerOfferId: offer.id,
    provider: 'duffel',
    outboundJourney: outbound,
    returnJourney: ret,
    totalPrice: parseFloat(offer.total_amount),
    currency: offer.total_currency,
    totalDurationMinutes: outbound.durationMinutes + ret.durationMinutes,
    totalStops: outbound.stops + ret.stops,
    maxStopsOneWay: Math.max(outbound.stops, ret.stops),
    airlines: allNames,
    airlineCodes: allCodes,
    bookingProvider: offer.owner.name,
    cabinClass,
    fareRules: {
      refundable: offer.conditions?.refund_before_departure?.allowed ?? false,
      changeable: offer.conditions?.change_before_departure?.allowed ?? false,
    },
    baggage: { carryOn, checked },
  };
}
