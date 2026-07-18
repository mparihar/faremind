import { FastifyPluginAsync } from 'fastify';
import { computeAiScores, type FareInput, type FlightContext } from '../services/ai-fare-scorer';
import { cacheGet, cacheSet, fareOptionsKey } from '../services/cache';
import { prisma } from '../lib/db';

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

/** Load fare tier templates from DB, converting Decimal fields to numbers. */
async function loadFareTemplates(): Promise<FareTemplate[]> {
  const rows = await prisma.fareTierTemplate.findMany({
    where: { active: true },
    orderBy: { displayOrder: 'asc' },
  });

  return rows.map(r => ({
    name: r.name,
    cabin: r.cabin,
    priceMultiplier: Number(r.priceMultiplier),
    carryOn: r.carryOn,
    carryOnPieces: r.carryOnPieces,
    carryOnWeightKg: r.carryOnWeightKg !== null ? Number(r.carryOnWeightKg) : null,
    checked: r.checkedBags,
    checkedWeightKg: r.checkedWeightKg !== null ? Number(r.checkedWeightKg) : null,
    extraBagFeeUsd: r.extraBagFeeUsd !== null ? Number(r.extraBagFeeUsd) : null,
    refundable: r.refundable,
    refundFeeUsd: r.refundFeeUsd !== null ? Number(r.refundFeeUsd) : null,
    changeable: r.changeable,
    changeFeeUsd: r.changeFeeUsd !== null ? Number(r.changeFeeUsd) : null,
    seatSelection: r.seatSelection as 'free' | 'fee' | 'not_available',
    seatSelectionFeeUsd: r.seatSelectionFeeUsd !== null ? Number(r.seatSelectionFeeUsd) : null,
    upgradeable: r.upgradeable,
    loungeAccess: r.loungeAccess,
    priorityBoarding: r.priorityBoarding,
    milesEarning: r.milesEarning as 'full' | 'reduced' | 'none',
  }));
}

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
      if (!offer_id) {
        console.warn('[fare-options] ⚠️ offer_id is EMPTY — all fares will have empty offerId. Bookings for these fares will fail at checkout!');
      }
      const base_price       = q.base_price;
      const traveler_count   = q.traveler_count || '1';
      const currency         = q.currency || 'USD';
      const origin           = q.origin || '';
      const destination      = q.destination || '';
      const stops            = q.stops || '0';
      const duration_minutes = q.duration_minutes || '0';
      const layover_minutes  = q.layover_minutes || '';
      const trip             = q.trip || 'one_way';

      // Provider-sourced fare rules — these are the sole source of truth
      // for changeable/changeFee/refundable/refundFee. DB templates are
      // NEVER used for these 4 fields.
      const providerChangeable  = q.provider_changeable;  // 'true' | 'false' | undefined
      const providerChangeFee   = q.provider_change_fee;  // numeric string or undefined
      const providerRefundable  = q.provider_refundable;  // 'true' | 'false' | undefined
      const providerRefundFee   = q.provider_refund_fee;  // numeric string or undefined

      // Provider-sourced baggage — the base fare's checked bag count from live API
      const providerCheckedBags = q.provider_checked_bags; // numeric string or undefined

      if (!base_price) return reply.code(400).send({ error: 'base_price is required' });

      const basePriceNum = parseFloat(base_price);
      const travelers    = parseInt(traveler_count, 10) || 1;
      // base_price is the all-passenger total (exact provider fare)
      // Derive per-person for display, but compute tier totals from the original total
      // to avoid rounding loss (e.g. $2176 / 3 = $725.33 → $725 × 3 = $2175 ≠ $2176)
      const perPersonBase = Math.round(basePriceNum / travelers);
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

      // Load fare tier templates from DB
      const FARE_TEMPLATES = await loadFareTemplates();
      if (FARE_TEMPLATES.length === 0) {
        return reply.code(500).send({ error: 'No fare tier templates configured. Please configure them in Admin > Commercial Settings > Fare Tiers.' });
      }

      // Resolve provider-sourced fare rules (single source of truth)
      const resolvedChangeable  = providerChangeable !== undefined ? providerChangeable === 'true'  : undefined;
      const resolvedChangeFee   = providerChangeFee !== undefined && providerChangeFee !== '' ? parseFloat(providerChangeFee) : null;
      const resolvedRefundable  = providerRefundable !== undefined ? providerRefundable === 'true'  : undefined;
      const resolvedRefundFee   = providerRefundFee !== undefined && providerRefundFee !== '' ? parseFloat(providerRefundFee) : null;
      const resolvedCheckedBags = providerCheckedBags !== undefined ? parseInt(providerCheckedBags, 10) : null;

      // When provider gives base checked bags, use it for the cheapest tier.
      // Higher tiers get at least as many bags, but can have more per template.
      const fareInputs: FareInput[] = FARE_TEMPLATES.map((t, i) => {
        let effectiveChecked = t.checked;
        if (resolvedCheckedBags !== null) {
          // For the cheapest tier (index 0 / multiplier 1.0), use exact provider value
          // For higher tiers, use max(template value, provider value) so upgrades are always ≥ base
          effectiveChecked = i === 0 ? resolvedCheckedBags : Math.max(t.checked, resolvedCheckedBags);
        }
        return {
        id: `fare_${i}_${offer_id || 'mock'}`,
        totalPrice: Math.round(basePriceNum * t.priceMultiplier / travelers),
        checked: effectiveChecked,
        // Use provider values for refundable/changeable (provider is sole source of truth)
        refundable: resolvedRefundable ?? t.refundable,
        refundFeeUsd: resolvedRefundFee !== null ? resolvedRefundFee : t.refundFeeUsd,
        changeable: resolvedChangeable ?? t.changeable,
        changeFeeUsd: resolvedChangeFee !== null ? resolvedChangeFee : t.changeFeeUsd,
        seatSelection: t.seatSelection, cabin: t.cabin, name: t.name,
        priorityBoarding: t.priorityBoarding, loungeAccess: t.loungeAccess, milesEarning: t.milesEarning,
      }});

      const scored   = computeAiScores(fareInputs, ctx);
      const scoreMap = new Map(scored.map((s) => [s.id, s]));

      const fareOptions = FARE_TEMPLATES.map((t, i) => {
        const id    = `fare_${i}_${offer_id || 'mock'}`;
        // Compute total from original all-passenger price to avoid rounding loss
        const allPaxTotal = Math.round(basePriceNum * t.priceMultiplier);
        const perPerson   = Math.round(allPaxTotal / travelers);
        const s     = scoreMap.get(id)!;

        // Provider values are the sole source of truth for these 4 fields.
        // If provider didn't supply them (undefined), leave as null to indicate "unknown".
        const effectiveChangeable  = resolvedChangeable ?? null;
        const effectiveChangeFee   = resolvedChangeFee;
        const effectiveRefundable  = resolvedRefundable ?? null;
        const effectiveRefundFee   = resolvedRefundFee;

        return {
          id, offerId: offer_id, cabin: t.cabin, name: t.name,
          basePrice: perPerson, totalPrice: allPaxTotal, currency,
          baggage: { carryOn: t.carryOn, carryOnPieces: t.carryOnPieces, carryOnWeightKg: t.carryOnWeightKg, checked: resolvedCheckedBags !== null ? (i === 0 ? resolvedCheckedBags : Math.max(t.checked, resolvedCheckedBags)) : t.checked, checkedWeightKg: t.checkedWeightKg, extraBagFeeUsd: t.extraBagFeeUsd },
          policy: { refundable: effectiveRefundable, refundFeeUsd: effectiveRefundFee, changeable: effectiveChangeable, changeFeeUsd: effectiveChangeFee, seatSelection: t.seatSelection, seatSelectionFeeUsd: t.seatSelectionFeeUsd, upgradeable: t.upgradeable, loungeAccess: t.loungeAccess, priorityBoarding: t.priorityBoarding, milesEarning: t.milesEarning },
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
