import { FastifyPluginAsync } from 'fastify';
import { computeAiScores, type FareInput, type FlightContext } from '../services/ai-fare-scorer';
import { cacheGet, cacheSet, fareOptionsKey } from '../services/cache';

interface FareTemplate {
  name: string; cabin: string; priceMultiplier: number;
  carryOn: boolean; carryOnPieces: number; carryOnWeightKg: number | null;
  checked: number; checkedWeightKg: number | null; extraBagFeeUsd: number | null;
  refundable: boolean; refundFeeUsd: number | null;
  changeable: boolean; changeFeeUsd: number | null;
  seatSelection: 'free' | 'fee' | 'not_available'; seatSelectionFeeUsd: number | null;
  upgradeable: boolean; loungeAccess: boolean; priorityBoarding: boolean;
  milesEarning: 'full' | 'reduced' | 'none';
}

const FARE_TEMPLATES: FareTemplate[] = [
  { name: 'Economy Basic', cabin: 'economy', priceMultiplier: 1.0, carryOn: true, carryOnPieces: 1, carryOnWeightKg: 7, checked: 0, checkedWeightKg: null, extraBagFeeUsd: 35, refundable: false, refundFeeUsd: null, changeable: false, changeFeeUsd: null, seatSelection: 'fee', seatSelectionFeeUsd: 15, upgradeable: false, loungeAccess: false, priorityBoarding: false, milesEarning: 'reduced' },
  { name: 'Economy Standard', cabin: 'economy', priceMultiplier: 1.18, carryOn: true, carryOnPieces: 1, carryOnWeightKg: 10, checked: 1, checkedWeightKg: 23, extraBagFeeUsd: 35, refundable: false, refundFeeUsd: null, changeable: true, changeFeeUsd: 50, seatSelection: 'fee', seatSelectionFeeUsd: 10, upgradeable: true, loungeAccess: false, priorityBoarding: false, milesEarning: 'full' },
  { name: 'Economy Flex', cabin: 'economy', priceMultiplier: 1.38, carryOn: true, carryOnPieces: 1, carryOnWeightKg: 10, checked: 1, checkedWeightKg: 23, extraBagFeeUsd: 35, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true, loungeAccess: false, priorityBoarding: true, milesEarning: 'full' },
  { name: 'Premium Economy Classic', cabin: 'premium_economy', priceMultiplier: 2.1, carryOn: true, carryOnPieces: 2, carryOnWeightKg: 12, checked: 2, checkedWeightKg: 23, extraBagFeeUsd: 50, refundable: false, refundFeeUsd: null, changeable: true, changeFeeUsd: 75, seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true, loungeAccess: false, priorityBoarding: true, milesEarning: 'full' },
  { name: 'Premium Economy Flex', cabin: 'premium_economy', priceMultiplier: 2.55, carryOn: true, carryOnPieces: 2, carryOnWeightKg: 12, checked: 2, checkedWeightKg: 32, extraBagFeeUsd: 50, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true, loungeAccess: true, priorityBoarding: true, milesEarning: 'full' },
  { name: 'Business Classic', cabin: 'business', priceMultiplier: 4.2, carryOn: true, carryOnPieces: 2, carryOnWeightKg: 18, checked: 2, checkedWeightKg: 32, extraBagFeeUsd: null, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true, loungeAccess: true, priorityBoarding: true, milesEarning: 'full' },
  { name: 'Business Extra', cabin: 'business', priceMultiplier: 5.0, carryOn: true, carryOnPieces: 2, carryOnWeightKg: 18, checked: 3, checkedWeightKg: 32, extraBagFeeUsd: null, refundable: true, refundFeeUsd: 0, changeable: true, changeFeeUsd: 0, seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true, loungeAccess: true, priorityBoarding: true, milesEarning: 'full' },
];

type AiBadge = 'cheapest' | 'best_value' | 'most_flexible' | 'premium_upgrade' | 'ai_pick' | 'best_comfort';

const BADGE_HEADLINES: Record<AiBadge, string> = {
  cheapest: 'Lowest Price', best_value: 'AI Best Choice', ai_pick: 'AI Best Choice',
  most_flexible: 'Best Flexibility', premium_upgrade: 'Premium Upgrade',
  best_comfort: 'Best Comfort',
};

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/options', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const offer_id         = q.offer_id || '';
      const base_price       = q.base_price;
      const traveler_count   = q.traveler_count || '1';
      const currency         = q.currency || 'USD';
      const origin           = q.origin || '';
      const destination      = q.destination || '';
      const stops            = q.stops || '0';
      const duration_minutes = q.duration_minutes || '0';
      const layover_minutes  = q.layover_minutes || '';
      const trip             = q.trip || 'one_way';

      if (!base_price) return reply.code(400).send({ error: 'base_price is required' });

      const basePriceNum = parseFloat(base_price);
      const travelers    = parseInt(traveler_count, 10) || 1;
      const stopsNum     = parseInt(stops, 10) || 0;
      const durationMins = parseInt(duration_minutes, 10) || 0;
      const layoverMins  = layover_minutes
        ? layover_minutes.split(',').map(Number).filter((n) => !isNaN(n) && n > 0)
        : [];

      // ── Redis cache check ──────────────────────────────────────────────────
      const cacheKey = fareOptionsKey(offer_id, basePriceNum, travelers);
      const cached = await cacheGet<object>(cacheKey);
      if (cached) return cached;

      const ctx: FlightContext = { durationMinutes: durationMins, stops: stopsNum, layoverMinutes: layoverMins };

      const fareInputs: FareInput[] = FARE_TEMPLATES.map((t, i) => ({
        id: `fare_${i}_${offer_id || 'mock'}`,
        totalPrice: Math.round(basePriceNum * t.priceMultiplier),
        checked: t.checked, refundable: t.refundable, refundFeeUsd: t.refundFeeUsd,
        changeable: t.changeable, changeFeeUsd: t.changeFeeUsd,
        seatSelection: t.seatSelection, cabin: t.cabin, name: t.name,
        priorityBoarding: t.priorityBoarding, loungeAccess: t.loungeAccess, milesEarning: t.milesEarning,
      }));

      const scored   = computeAiScores(fareInputs, ctx);
      const scoreMap = new Map(scored.map((s) => [s.id, s]));

      const fareOptions = FARE_TEMPLATES.map((t, i) => {
        const id    = `fare_${i}_${offer_id || 'mock'}`;
        const total = Math.round(basePriceNum * t.priceMultiplier);
        const s     = scoreMap.get(id)!;
        return {
          id, offerId: offer_id, cabin: t.cabin, name: t.name,
          basePrice: Math.round(basePriceNum * t.priceMultiplier), totalPrice: total, currency,
          baggage: { carryOn: t.carryOn, carryOnPieces: t.carryOnPieces, carryOnWeightKg: t.carryOnWeightKg, checked: t.checked, checkedWeightKg: t.checkedWeightKg, extraBagFeeUsd: t.extraBagFeeUsd },
          policy: { refundable: t.refundable, refundFeeUsd: t.refundFeeUsd, changeable: t.changeable, changeFeeUsd: t.changeFeeUsd, seatSelection: t.seatSelection, seatSelectionFeeUsd: t.seatSelectionFeeUsd, upgradeable: t.upgradeable, loungeAccess: t.loungeAccess, priorityBoarding: t.priorityBoarding, milesEarning: t.milesEarning },
          aiScore: s.breakdown.finalScore, aiBadges: s.badges as AiBadge[], aiExplanation: s.explanation,
          aiScoreBreakdown: s.breakdown, seatsRemaining: Math.floor(Math.random() * 8) + 1,
          popular: s.badges.includes('best_value'),
        };
      });

      const cabinOrder  = ['economy', 'premium_economy', 'business'];
      const cabinLabels: Record<string, string> = { economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business' };
      const fareGroups = cabinOrder.map((cabin) => ({
        cabin, label: cabinLabels[cabin], fares: fareOptions.filter((f) => f.cabin === cabin),
      })).filter((g) => g.fares.length > 0);

      const allSorted = [...fareOptions].sort((a, b) => b.aiScore - a.aiScore);
      const topPick   = allSorted.find((f) => f.aiBadges.includes('ai_pick')) ?? allSorted[0];
      const othersRaw = [
        fareOptions.find((f) => f.aiBadges.includes('cheapest') && f.id !== topPick.id),
        fareOptions.find((f) => f.aiBadges.includes('most_flexible') && f.id !== topPick.id),
        fareOptions.find((f) => f.aiBadges.includes('best_comfort') && f.id !== topPick.id),
        fareOptions.find((f) => f.aiBadges.includes('premium_upgrade') && f.id !== topPick.id),
      ].filter(Boolean);

      const seenIds = new Set<string>();
      const others = othersRaw.filter((f) => {
        if (!f || seenIds.has(f.id)) return false;
        seenIds.add(f.id);
        return true;
      });

      const stopsLabel = stopsNum === 0 ? 'Non-stop' : `${stopsNum} stop${stopsNum > 1 ? 's' : ''}`;
      const journeySummary = trip === 'round_trip'
        ? `${origin} → ${destination} · ${stopsLabel}  |  ${destination} → ${origin}`
        : `${origin} → ${destination} · ${stopsLabel}`;

      const response = {
        offerId: offer_id, destinationCity: destination, journeySummary, fareGroups,
        aiRecommendations: {
          topPick: { badge: topPick.aiBadges[0] ?? 'best_value', fareId: topPick.id, headline: BADGE_HEADLINES[topPick.aiBadges[0] as AiBadge] ?? 'AI Best Choice', reason: topPick.aiExplanation },
          others: others.map((f) => f && ({ badge: f.aiBadges[0], fareId: f.id, headline: BADGE_HEADLINES[f.aiBadges[0] as AiBadge] ?? f.name, reason: f.aiExplanation })).filter(Boolean),
        },
        currency, baseCurrency: currency,
      };

      // Cache for 300s — fare options are stable within 5 minutes
      await cacheSet(cacheKey, response, 300);
      return response;
    } catch (err) {
      console.error('[fare-options] Error:', err);
      reply.code(500).send({ error: 'Failed to generate fare options' });
    }
  });

  fastify.post('/compute-ai-score', async (request, reply) => {
    try {
      const { fare_options, flight_context } = request.body as {
        fare_options: Array<{
          id: string; total_price: number; checked_bags: number;
          refundable: boolean; refund_fee_usd: number | null;
          changeable: boolean; change_fee_usd: number | null;
          seat_selection: 'free' | 'fee' | 'not_available'; cabin: string; name: string;
        }>;
        flight_context?: { duration_minutes?: number; stops?: number; layover_minutes?: number[] };
      };

      if (!Array.isArray(fare_options) || fare_options.length === 0) {
        return reply.code(400).send({ error: 'fare_options array is required and must not be empty' });
      }

      const ctx: FlightContext = {
        durationMinutes: flight_context?.duration_minutes ?? 0,
        stops: flight_context?.stops ?? 0,
        layoverMinutes: flight_context?.layover_minutes ?? [],
      };

      const inputs: FareInput[] = fare_options.map((f) => ({
        id: f.id, totalPrice: f.total_price, checked: f.checked_bags,
        refundable: f.refundable, refundFeeUsd: f.refund_fee_usd,
        changeable: f.changeable, changeFeeUsd: f.change_fee_usd,
        seatSelection: f.seat_selection, cabin: f.cabin, name: f.name,
      }));

      const scored = computeAiScores(inputs, ctx);

      return {
        results: scored.map((s) => ({
          fare_id: s.id, ai_score: s.breakdown.finalScore, badges: s.badges, explanation: s.explanation,
          score_breakdown: {
            price_score: s.breakdown.priceScore, duration_score: s.breakdown.durationScore,
            stops_score: s.breakdown.stopsScore, baggage_score: s.breakdown.baggageScore,
            refund_score: s.breakdown.refundScore, change_score: s.breakdown.changeScore,
            seat_score: s.breakdown.seatScore, layover_score: s.breakdown.layoverScore,
            prediction_score: s.breakdown.predictionScore,
          },
        })),
      };
    } catch (err) {
      console.error('[fare-options/compute-ai-score] Error:', err);
      reply.code(500).send({ error: 'Failed to compute AI scores' });
    }
  });
};

export default plugin;
