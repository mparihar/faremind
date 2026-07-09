// ═══════════════════════════════════════════════════════════════════════════════
// Unified Flight Scoring Engine — Feature Extractor
// ═══════════════════════════════════════════════════════════════════════════════
//
// Converts a NormalizedFlightOffer into trip-type-aware ScoringFeatures.
// ONE_WAY uses outbound only; ROUND_TRIP combines both legs.

import type {
  NormalizedFlightOffer,
  ScoringFeatures,
  ScoringTripType,
  ScoringSearchContext,
  LegLayover,
} from './FlightScoringTypes';
import { FLIGHT_SCORING_CONFIG } from './FlightScoringConfig';
import { hourFromIso } from './FlightScoringUtils';

/**
 * Extract trip-type-aware scoring features from a normalized offer.
 */
export function extractScoringFeatures(
  offer: NormalizedFlightOffer,
  tripType: ScoringTripType,
  _searchContext?: ScoringSearchContext,
): ScoringFeatures {
  const config = FLIGHT_SCORING_CONFIG[tripType];

  // ── Duration ──
  let totalDurationMinutes: number;
  if (config.durationMode === 'OUTBOUND_PLUS_RETURN' && offer.returnLeg) {
    totalDurationMinutes = offer.outbound.durationMinutes + offer.returnLeg.durationMinutes;
  } else {
    totalDurationMinutes = offer.outbound.durationMinutes;
  }

  // ── Stops ──
  const outboundStops = offer.outbound.stops;
  const returnStops = offer.returnLeg?.stops ?? 0;
  let totalStops: number;
  if (config.stopsMode === 'OUTBOUND_PLUS_RETURN' && offer.returnLeg) {
    totalStops = outboundStops + returnStops;
  } else {
    totalStops = outboundStops;
  }

  // ── Layovers ──
  const outboundLayovers: LegLayover[] = offer.outbound.layovers ?? [];
  const returnLayovers: LegLayover[] = offer.returnLeg?.layovers ?? [];
  const allLayovers: LegLayover[] = [...outboundLayovers, ...returnLayovers];

  // ── Schedule ──
  const outDepHour = hourFromIso(offer.outbound.departureTime);
  const outArrHour = hourFromIso(offer.outbound.arrivalTime);
  const retDepHour = offer.returnLeg ? hourFromIso(offer.returnLeg.departureTime) : undefined;
  const retArrHour = offer.returnLeg ? hourFromIso(offer.returnLeg.arrivalTime) : undefined;

  // ── Baggage (mode-aware) ──
  const baggage = {
    carryOnIncluded: offer.baggage.carryOnIncluded,
    carryOnPieces:   offer.baggage.carryOnPieces,
    checkedBagsIncluded: offer.baggage.checkedBagsIncluded,
    isInternational: offer.isInternational,
  };

  // ── Effective price (use pre-computed or fall back to totalFare) ──
  const effectiveTotalPrice = offer.effectiveTotalPrice ?? offer.totalFare;

  return {
    offerId: offer.id,
    tripType,
    effectiveTotalPrice,
    rawTotalPrice: offer.totalFare,
    totalDurationMinutes,
    totalStops,
    outboundStops,
    returnStops,
    allLayovers,
    outboundLayovers,
    returnLayovers,
    schedule: {
      outboundDepartureHour: outDepHour,
      outboundArrivalHour:   outArrHour,
      returnDepartureHour:   config.scheduleMode === 'OUTBOUND_AND_RETURN' ? retDepHour : undefined,
      returnArrivalHour:     config.scheduleMode === 'OUTBOUND_AND_RETURN' ? retArrHour : undefined,
    },
    baggage,
    fareFlexibility: {
      refundable: offer.fareRules.refundable,
      changeable: offer.fareRules.changeable,
    },
    providerReliability: {
      providerCode: offer.providerCode,
      health: offer.providerHealth,
    },
    isInternational: offer.isInternational,
  };
}
