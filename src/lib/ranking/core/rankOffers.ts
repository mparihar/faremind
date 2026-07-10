/**
 * Flight Ranking Orchestrator
 *
 * Main entry point: rankFlightOffers()
 *
 * Pipeline:
 *   1. Detect journey type (domestic/international)
 *   2. Load correct ranking profile
 *   3. Apply traveler profile weight adjustments
 *   4. Extract features from each offer
 *   5. Compute all 10 scores per offer
 *   6. Apply weighted combination → raw final score
 *   7. Apply context rules → adjusted final score
 *   8. Generate machine reasons and tradeoffs
 *   9. Apply tie-break rules
 *   10. Compute confidence
 *   11. Return RankingOutput with full audit data
 */

import type {
  RankingInput,
  RankingOutput,
  RankingOffer,
  RankedOffer,
  ScoreBreakdown,
  RankingProfile,
  RankingWeights,
  OfferFeatures,
  JourneyType,
  TravelerProfile,
  ConfidenceLevel,
  AppliedRule,
  RANKING_VERSION,
} from '../types';
import { RANKING_VERSION as VERSION } from '../types';

// Config imports
import domesticConfig from '../config/domestic-default.json';
import internationalConfig from '../config/international-default.json';

// Core scoring modules
import { computePriceScores } from './normalizePrice';
import { scoreSchedule } from './scoreSchedule';
import { scoreDuration } from './scoreDuration';
import { scoreStops } from './scoreStops';
import { scoreBaggage } from './scoreBaggage';
import { scoreComfort } from './scoreComfort';
import { scoreFlexibility } from './scoreFlexibility';
import { scoreBrand } from './scoreBrand';
import { scoreReliability } from './scoreReliability';
import { scoreAirportExperience } from './scoreAirportExperience';

// Orchestrator support
import { detectJourneyType } from './detectJourneyType';
import { extractFeatures } from './extractFeatures';
import { applyContextRules } from './applyContextRules';
import { generateMachineReasons } from './generateMachineReasons';

// ─── Profile Loading ─────────────────────────────────────────────────────────

function loadProfile(journeyType: JourneyType): RankingProfile {
  if (journeyType === 'domestic') {
    return domesticConfig as RankingProfile;
  }
  return internationalConfig as RankingProfile;
}

// ─── Traveler Profile Weight Adjustments ─────────────────────────────────────

function adjustWeightsForTraveler(
  baseWeights: RankingWeights,
  travelerProfile: TravelerProfile,
): RankingWeights {
  const w = { ...baseWeights };

  switch (travelerProfile) {
    case 'business':
      // Increase schedule, duration, reliability, flexibility; reduce price
      w.price *= 0.85;
      w.schedule *= 1.3;
      w.duration *= 1.2;
      w.flexibility *= 1.5;
      w.reliability *= 1.3;
      break;

    case 'budget':
      // Increase price; reduce comfort and brand
      w.price *= 1.3;
      w.comfort *= 0.6;
      w.brand *= 0.5;
      break;

    case 'family':
      // Boost baggage, schedule, stops; reduce brand
      w.baggage *= 1.4;
      w.schedule *= 1.3;
      w.stops *= 1.2;
      w.brand *= 0.7;
      break;

    case 'elderly':
      // Boost comfort, stops, schedule; reduce price
      w.comfort *= 1.4;
      w.stops *= 1.3;
      w.schedule *= 1.3;
      w.price *= 0.85;
      break;

    default:
      // 'default': no adjustments
      break;
  }

  // Re-normalize so weights sum to 100
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.01) {
    const factor = 100 / sum;
    (Object.keys(w) as (keyof RankingWeights)[]).forEach(k => {
      w[k] = Math.round(w[k] * factor * 100) / 100;
    });
  }

  return w;
}

// ─── Score Computation ───────────────────────────────────────────────────────

interface ComputedScores {
  features: OfferFeatures;
  breakdown: ScoreBreakdown;
  rawFinalScore: number;
}

function computeAllScores(
  offers: RankingOffer[],
  profile: RankingProfile,
  journeyType: JourneyType,
  weights: RankingWeights,
): ComputedScores[] {
  // 1. Extract features
  const allFeatures = offers.map(o => extractFeatures(o));

  // 2. Compute price scores (set-level normalization)
  const prices = allFeatures.map(f => f.totalPrice);
  const priceScores = computePriceScores(prices);

  // 3. Compute duration scores (set-level normalization)
  const durations = allFeatures.map(f => f.durationMinutes);
  const minDuration = Math.min(...durations);

  // 4. Get cheapest price for flexibility scoring
  const cheapestPrice = Math.min(...prices);

  // 5. Compute all 10 scores for each offer
  return allFeatures.map((features, i) => {
    const priceScore = priceScores[i];

    const scheduleScore = scoreSchedule(
      features.departureHour,
      features.departureMinute,
      features.arrivalHour,
      features.arrivalMinute,
      profile.scheduleBand,
      journeyType,
    );

    const durationScore = scoreDuration(
      features.durationMinutes,
      minDuration,
      profile.durationPenaltyRange,
    );

    const stopsScore = scoreStops(
      features.stops,
      features.layoverDurations,
      profile.layoverThresholds,
      features.hasTerminalChange,
      features.hasAirportChange,
      features.requiresImmigration,
      journeyType,
    );

    const baggageScore = scoreBaggage(
      features.carryOn,
      features.checkedBags,
      features.checkedBagPaidPrice,
      journeyType,
    );

    const comfortScore = scoreComfort(
      features.cabinClass,
      features.fareClassName,
      features.seatPitch,
      features.seatSelection,
      features.wifiAvailable,
      features.mealsIncluded,
      features.entertainmentAvailable,
      features.priorityBoarding,
      features.loungeAccess,
      features.longestSegmentMinutes,
      journeyType,
    );

    const flexibilityScore = scoreFlexibility(
      features.refundable,
      features.changeable,
      features.cancellationFee,
      features.changeFee,
      features.totalPrice,
      cheapestPrice,
      profile.flexibilityThresholds,
    );

    const brandScore = scoreBrand(features.airlineCode);

    const hasShortConnection = features.layoverDurations.length > 0 &&
      Math.min(...features.layoverDurations) < profile.layoverThresholds.highRiskMinutes;

    const reliabilityScore = scoreReliability(
      features.provider,
      features.airlineCode,
      features.stops,
      hasShortConnection,
      features.hasAirportChange,
    );

    // Detect overnight layover
    const hasOvernightLayover = features.layoverDurations.some(d => d >= 480);

    const airportExperienceScore = scoreAirportExperience(
      features.loungeAccess,
      features.mealsIncluded,
      features.wifiAvailable,
      features.seatSelectionAvailable,
      features.familySeatingAvailable,
      features.hasAirportChange,
      features.hasTerminalChange,
      hasOvernightLayover,
      features.layoverDurations,
      journeyType,
    );

    const breakdown: ScoreBreakdown = {
      priceScore,
      scheduleScore,
      durationScore,
      stopsScore,
      baggageScore,
      comfortScore,
      flexibilityScore,
      brandScore,
      reliabilityScore,
      airportExperienceScore,
    };

    // Weighted combination
    const rawFinalScore =
      (priceScore * weights.price / 100) +
      (scheduleScore * weights.schedule / 100) +
      (durationScore * weights.duration / 100) +
      (stopsScore * weights.stops / 100) +
      (baggageScore * weights.baggage / 100) +
      (comfortScore * weights.comfort / 100) +
      (flexibilityScore * weights.flexibility / 100) +
      (brandScore * weights.brand / 100) +
      (reliabilityScore * weights.reliability / 100) +
      (airportExperienceScore * weights.airportExperience / 100);

    return {
      features,
      breakdown,
      rawFinalScore: Math.round(rawFinalScore * 100) / 100,
    };
  });
}

// ─── Confidence Computation ──────────────────────────────────────────────────

function computeConfidence(
  sortedScores: number[],
  allFeatures: OfferFeatures[],
): ConfidenceLevel {
  if (sortedScores.length < 2) return 'high';

  const topScore = sortedScores[0];
  const secondScore = sortedScores[1];
  const gap = topScore - secondScore;

  // Check for missing data
  const hasMissingData = allFeatures.some(f =>
    f.checkedBags === 0 && f.checkedBagPaidPrice === undefined && // unclear baggage
    !f.refundable && !f.changeable // unclear fare rules
  );

  if (gap > 5 && !hasMissingData) return 'high';
  if (gap >= 2 || hasMissingData) return 'medium';
  return 'low';
}

// ─── Tie-Breaking ────────────────────────────────────────────────────────────

function tieBreakSort(
  offers: Array<{ offerId: string; finalScore: number; features: OfferFeatures; breakdown: ScoreBreakdown }>,
  tieBreakOrder: (keyof RankingWeights)[],
): void {
  offers.sort((a, b) => {
    // Primary: final score (higher is better)
    const scoreDiff = b.finalScore - a.finalScore;
    if (Math.abs(scoreDiff) > 0.01) return scoreDiff;

    // Tie-breakers
    for (const factor of tieBreakOrder) {
      let diff = 0;
      switch (factor) {
        case 'price':
          diff = a.features.totalPrice - b.features.totalPrice; // lower is better
          break;
        case 'schedule':
          diff = b.breakdown.scheduleScore - a.breakdown.scheduleScore;
          break;
        case 'duration':
          diff = a.features.durationMinutes - b.features.durationMinutes; // lower is better
          break;
        case 'stops':
          diff = a.features.stops - b.features.stops; // fewer is better
          break;
        case 'baggage':
          diff = b.breakdown.baggageScore - a.breakdown.baggageScore;
          break;
        case 'flexibility':
          diff = b.breakdown.flexibilityScore - a.breakdown.flexibilityScore;
          break;
        case 'comfort':
          diff = b.breakdown.comfortScore - a.breakdown.comfortScore;
          break;
        case 'reliability':
          diff = b.breakdown.reliabilityScore - a.breakdown.reliabilityScore;
          break;
        case 'brand':
          diff = b.breakdown.brandScore - a.breakdown.brandScore;
          break;
        case 'airportExperience':
          diff = b.breakdown.airportExperienceScore - a.breakdown.airportExperienceScore;
          break;
      }
      if (Math.abs(diff) > 0.01) return diff;
    }

    // Final fallback: stable sort by offerId
    return a.offerId.localeCompare(b.offerId);
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Rank flight offers using the FareMind ranking engine.
 *
 * This is the main entry point. It:
 *   1. Detects domestic/international
 *   2. Computes 10-factor scores
 *   3. Applies context rules
 *   4. Generates machine reasons
 *   5. Returns deterministic, auditable ranking
 *
 * @param input - RankingInput with searchContext and offers
 * @returns RankingOutput with ranked offers and audit data
 */
export function rankFlightOffers(input: RankingInput): RankingOutput {
  const { searchContext, offers } = input;

  if (offers.length === 0) {
    return {
      rankingVersion: VERSION,
      profileId: 'none',
      searchContext,
      rankedOffers: [],
      timestamp: new Date().toISOString(),
      audit: {
        rankingVersion: VERSION,
        profileId: 'none',
        configVersion: '1.0.0',
        inputOfferIds: [],
        totalOffers: 0,
        journeyType: 'domestic',
        currency: searchContext.currency,
        timestamp: new Date().toISOString(),
        weightsUsed: { price: 0, schedule: 0, duration: 0, stops: 0, baggage: 0, comfort: 0, flexibility: 0, brand: 0, reliability: 0, airportExperience: 0 },
      },
    };
  }

  // 1. Detect journey type
  const journeyType = detectJourneyType(
    searchContext.origin,
    searchContext.destination,
    searchContext.journeyType,
  );

  // 2. Load profile
  const profile = loadProfile(journeyType);

  // 3. Adjust weights for traveler profile
  const weights = adjustWeightsForTraveler(profile.weights, searchContext.travelerProfile);

  // 4–6. Compute all scores
  const scored = computeAllScores(offers, profile, journeyType, weights);

  // 7. Apply context rules
  const cheapestPrice = Math.min(...offers.map(o => o.totalPrice));
  const ruleInputs = scored.map((s, i) => ({
    offerId: offers[i].offerId,
    features: s.features,
    breakdown: s.breakdown,
    rawFinalScore: s.rawFinalScore,
  }));

  const ruleResults = applyContextRules({
    offers: ruleInputs,
    journeyType,
    travelerProfile: searchContext.travelerProfile,
    passengers: searchContext.passengers,
    enabledRules: profile.enabledRules,
    layoverThresholds: profile.layoverThresholds,
    cheapestPrice,
  });

  // Apply rule adjustments to final scores
  const adjustedOffers = scored.map((s, i) => {
    const adjustment = ruleResults[i].scoreAdjustment;
    const adjustedScore = Math.round(Math.max(0, Math.min(100, s.rawFinalScore + adjustment)) * 100) / 100;
    return {
      offerId: offers[i].offerId,
      features: s.features,
      breakdown: s.breakdown,
      finalScore: adjustedScore,
      appliedRules: ruleResults[i].rules,
    };
  });

  // 9. Tie-break sort
  tieBreakSort(adjustedOffers, profile.tieBreakOrder);

  // 10. Compute confidence
  const sortedFinalScores = adjustedOffers.map(o => o.finalScore);
  const confidence = computeConfidence(sortedFinalScores, scored.map(s => s.features));

  // 8. Generate machine reasons
  const fastestDuration = Math.min(...offers.map(o => o.durationMinutes));
  const minStops = Math.min(...offers.map(o => o.stops));
  const fastestOfferId = offers.find(o => o.durationMinutes === fastestDuration)?.offerId || '';
  const cheapestOfferId = offers.find(o => o.totalPrice === cheapestPrice)?.offerId || '';
  const nonstopOffer = offers.find(o => o.stops === 0);

  const setStats = {
    cheapestPrice,
    cheapestOfferId,
    fastestDuration,
    fastestOfferId,
    minStops,
    bestNonstopOfferId: nonstopOffer?.offerId || null,
    totalOffers: offers.length,
  };

  // Build ranked offers
  const rankedOffers: RankedOffer[] = adjustedOffers.map((o, index) => {
    const { machineReasons, tradeoffs } = generateMachineReasons(
      {
        offerId: o.offerId,
        features: o.features,
        breakdown: o.breakdown,
        finalScore: o.finalScore,
        rank: index + 1,
      },
      setStats,
      journeyType,
    );

    const originalOffer = offers.find(of => of.offerId === o.offerId)!;

    return {
      rank: index + 1,
      offerId: o.offerId,
      provider: originalOffer.provider,
      airline: originalOffer.airline,
      finalScore: o.finalScore,
      scoreBreakdown: o.breakdown,
      appliedRules: o.appliedRules,
      machineReasons,
      tradeoffs,
      confidence,
    };
  });

  const timestamp = new Date().toISOString();

  return {
    rankingVersion: VERSION,
    profileId: profile.profileId,
    searchContext,
    rankedOffers,
    timestamp,
    audit: {
      rankingVersion: VERSION,
      profileId: profile.profileId,
      configVersion: profile.version,
      inputOfferIds: offers.map(o => o.offerId),
      totalOffers: offers.length,
      journeyType,
      currency: searchContext.currency,
      timestamp,
      weightsUsed: weights,
    },
  };
}
