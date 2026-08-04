/**
 * Fare Options — the airline's fare ladder for one flight.
 *
 * The customer-facing label on every fare is the airline's own brand, exactly
 * as the provider filed it ("ECO VALUE", "DELTA MAIN BASIC", "INDIGO UPFRONT").
 * FareMind never renames it. Our value is the AI scoring, badges, and the
 * benefit normalization that makes brands comparable across carriers.
 *
 * POST /options  — the real path. The caller passes the sibling offers from the
 *   search (everything sharing an `itineraryKey`), which is the provider's own
 *   "same metal, different fare" grouping. No extra provider call.
 *
 * GET /options   — compatibility path for callers that only hold a single
 *   offer. Returns that one fare, priced and labelled from provider data. It no
 *   longer projects a seven-rung ladder out of `fare_tier_templates`; those
 *   names were FareMind inventions that all resolved to the same price and the
 *   same underlying offer.
 */
import { FastifyPluginAsync } from 'fastify';
import { computeAiScores, type FareInput, type FlightContext } from '../services/ai-fare-scorer';
import { cacheGet, cacheSet, fareOptionsKey } from '../services/cache';
import { displayFareFamily, cabinBucket, normalizeFareTier, parseBaggageAllowance, disambiguateFareLabels } from '../services/fare-family';
import {
  classifyFareCategory, FARE_CATEGORY_ORDER, FARE_CATEGORY_LABELS,
  emptyDiagnostics, recordClassification, formatDiagnostics,
  type FareCategory,
} from '../services/fare-category';
import type { NormalizedFareTier } from '../lib/types';

type AiBadge = 'cheapest' | 'best_value' | 'most_flexible' | 'premium_upgrade' | 'ai_pick' | 'best_comfort';

const BADGE_HEADLINES: Record<AiBadge, string> = {
  cheapest: 'Lowest Price', best_value: 'AI Best Choice', ai_pick: 'AI Best Choice',
  most_flexible: 'Best Flexibility', premium_upgrade: 'Premium Upgrade',
  best_comfort: 'Best Comfort',
};

const CABIN_ORDER: Array<'economy' | 'premium_economy' | 'business' | 'first'> =
  ['economy', 'premium_economy', 'business', 'first'];
const CABIN_LABELS: Record<string, string> = {
  economy: 'Economy', premium_economy: 'Premium Economy', business: 'Business', first: 'First',
};

/** One fare as it arrives from the caller — a normalized search offer. */
interface IncomingOffer {
  id?: string;
  offerId?: string;
  providerOfferId?: string;
  airlineFareFamily?: string | null;
  normalizedFareTier?: NormalizedFareTier | null;
  cabinClass?: string | null;
  bookingClass?: string | null;
  /** Per-segment provider cabin codes — 2nd classification signal. */
  segmentCabinCodes?: Array<string | null | undefined>;
  /** Per-segment airline fare basis codes — 4th classification signal. */
  fareBasisCodes?: Array<string | null | undefined>;
  airlineCode?: string | null;
  provider?: string | null;
  totalPrice?: number;
  currency?: string;
  seatsRemaining?: number | null;
  checkedBaggageAllowance?: string | null;
  cabinBaggageAllowance?: string | null;
  baggage?: { carryOn?: number; checked?: number } | null;
  fareRules?: {
    refundable?: boolean | null; changeable?: boolean | null;
    changeFee?: number | null; cancellationFee?: number | null;
  } | null;
}

/**
 * Benefits we can state from provider data. Anything the provider does not tell
 * us stays null — "unknown" — rather than being filled in from a template. A
 * confident-looking lounge-access claim we invented is worse than a blank.
 */
interface NormalizedBenefits {
  carryOnAllowance: string | null;
  carryOnWeightKg: number | null;
  checkedAllowance: string | null;
  checkedPieces: number | null;
  checkedWeightKg: number | null;
  refundable: boolean | null;
  refundFeeUsd: number | null;
  changeable: boolean | null;
  changeFeeUsd: number | null;
  seatSelection: 'free' | 'fee' | 'not_available' | null;
  bookingClass: string | null;
}

function buildBenefits(o: IncomingOffer): NormalizedBenefits {
  const checked = parseBaggageAllowance(o.checkedBaggageAllowance);
  const cabin = parseBaggageAllowance(o.cabinBaggageAllowance);
  return {
    carryOnAllowance: cabin.raw || null,
    carryOnWeightKg: cabin.kg,
    checkedAllowance: checked.raw || null,
    checkedPieces: checked.pieces ?? (typeof o.baggage?.checked === 'number' ? o.baggage.checked : null),
    checkedWeightKg: checked.kg,
    refundable: o.fareRules?.refundable ?? null,
    refundFeeUsd: o.fareRules?.cancellationFee ?? null,
    changeable: o.fareRules?.changeable ?? null,
    changeFeeUsd: o.fareRules?.changeFee ?? null,
    // Mystifly does not return seat-selection policy in search. Leave unknown
    // rather than asserting 'fee' or 'free'.
    seatSelection: null,
    bookingClass: o.bookingClass || null,
  };
}

/**
 * Score and shape a set of fares for the same flight. Uses the existing
 * computeAiScores engine unchanged — same weights, same badges, same
 * explanations — only the labels and the inputs are now real.
 */

/**
 * Collapse fares a customer cannot tell apart.
 *
 * Mystifly returns the same product more than once — the same journey at the
 * same price with the same baggage and the same rules, under two
 * FareSourceCodes, sometimes one carrying the airline's brand and one carrying
 * none. Every dedupe on the way here keys on the FareSourceCode, so both
 * survived and the panel offered "Economy Fare 1" and "Economy Fare 2" with
 * identical benefits and identical prices. That is a choice with no content.
 *
 * Identity is what the customer can SEE: cabin, price, baggage, refundability,
 * changeability, their fees, and seat policy. Where two match, the one carrying
 * the airline's brand is kept — same fare, more information. Anything that
 * differs on any of those fields is a real alternative and is left alone.
 */
function dedupeIndistinguishable(offers: IncomingOffer[]): IncomingOffer[] {
  const identity = (o: IncomingOffer): string => {
    const b = buildBenefits(o);
    return [
      (o.cabinClass ?? '').toLowerCase(),
      Math.round(o.totalPrice ?? 0),
      b.carryOnAllowance ?? '', b.carryOnWeightKg ?? '',
      b.checkedAllowance ?? '', b.checkedPieces ?? '',
      b.refundable ?? '', b.refundFeeUsd ?? '',
      b.changeable ?? '', b.changeFeeUsd ?? '',
      b.seatSelection ?? '',
    ].join('|');
  };

  const kept = new Map<string, IncomingOffer>();
  for (const offer of offers) {
    const key = identity(offer);
    const existing = kept.get(key);
    if (!existing) { kept.set(key, offer); continue; }
    // Prefer the branded copy — "STANDARD" tells the customer more than "".
    const existingBrand = (existing.airlineFareFamily ?? '').trim();
    const offerBrand = (offer.airlineFareFamily ?? '').trim();
    if (!existingBrand && offerBrand) kept.set(key, offer);
  }
  return [...kept.values()];
}

function buildFareOptions(rawOffers: IncomingOffer[], ctx: FlightContext, travelers: number, currency: string) {
  // Collapse duplicates BEFORE labelling and scoring, so badges and the "N of M"
  // ordering describe the fares actually shown.
  const deduped = dedupeIndistinguishable(rawOffers);
  const collapsed = rawOffers.length - deduped.length;

  // Rule: a fare the airline filed NO brand for is not shown as its own tile
  // when a branded fare for the same flight exists. Those brandless copies are
  // Mystifly's data-poor duplicates — no fare-family name, no booking class, and
  // missing refund/baggage data that renders as a phantom "Non-refundable / no
  // checked bag" fare at the same price (e.g. a second $163 card next to
  // "ECONOMY SUPER LITE"). Guard: if EVERY fare is brandless (Mystifly's v1
  // lowest-fare search often returns no FareFamily at all), keep them — dropping
  // to zero would leave the flight with no bookable fare.
  const branded = deduped.filter((o) => (o.airlineFareFamily || '').trim().length > 0);
  const offers = branded.length > 0 ? branded : deduped;
  const droppedBrandless = deduped.length - offers.length;
  if (droppedBrandless > 0) {
    console.log(`[fare-options] dropped ${droppedBrandless} brandless fare(s) — a branded fare exists for the same flight`);
  }

  // Airline-named fares keep their brand verbatim. Brandless ones (Mystifly's
  // v1 "lowest fare" search returns no FareFamily) get a controlled generic
  // label, disambiguated by RBD so two of them are never indistinguishable.
  const labels = disambiguateFareLabels(offers, (o) => ({
    fareFamily: o.airlineFareFamily,
    cabinClass: o.cabinClass,
    bookingClass: o.bookingClass,
  }));

  const scorerInputs: FareInput[] = offers.map((o, i) => {
    const b = buildBenefits(o);
    return {
      id: o.id || `fare_${i}`,
      // The scorer normalizes price within the group, so per-person vs total
      // only has to be consistent. Use per-person for readability.
      totalPrice: Math.round((o.totalPrice ?? 0) / travelers),
      checked: b.checkedPieces ?? 0,
      refundable: b.refundable === true,
      refundFeeUsd: b.refundFeeUsd,
      changeable: b.changeable === true,
      changeFeeUsd: b.changeFeeUsd,
      // Unknown seat policy scores as the neutral middle option rather than
      // penalising a fare for data the provider withheld.
      seatSelection: b.seatSelection ?? 'fee',
      cabin: cabinBucket(o.cabinClass),
      name: labels[i],
    };
  });

  // Classify every offer into a UI tab. One pass, one result each — the count
  // in must equal the count out, which the diagnostics line asserts.
  const diagnostics = emptyDiagnostics();
  diagnostics.collapsedDuplicates = collapsed;
  const categories = offers.map((o) => {
    const r = classifyFareCategory({
      cabinClass: o.cabinClass,
      segmentCabinCodes: o.segmentCabinCodes,
      bookingClass: o.bookingClass,
      fareBasisCodes: o.fareBasisCodes,
      fareFamily: o.airlineFareFamily,
      airlineCode: o.airlineCode,
      provider: o.provider,
    });
    recordClassification(diagnostics, r);
    return r;
  });

  const scored = computeAiScores(scorerInputs, ctx);
  const scoreMap = new Map(scored.map((s) => [s.id, s]));

  const built = offers.map((o, i) => {
    const id = o.id || `fare_${i}`;
    const b = buildBenefits(o);
    const s = scoreMap.get(id)!;
    const allPaxTotal = Math.round(o.totalPrice ?? 0);
    return {
      id,
      // The FareSourceCode this fare actually books. Every fare in the ladder is
      // a distinct provider offer — unlike the old templates, which all shared
      // one offerId and so all booked the identical fare.
      offerId: o.providerOfferId || o.offerId || '',
      // Which FareMind UI tab this offer appears under. Separate from the
      // scorer's `cabin` above, which stays on the four-value cabinBucket the
      // ranking engine has always been given — classification must not move a
      // score. `other` is a real, visible tab: an offer we cannot confidently
      // place is still shown, never hidden.
      cabin: categories[i].category,
      categoryMethod: categories[i].method,
      // Airline branding, verbatim when the carrier filed one; otherwise a
      // controlled generic label — never an invented brand.
      name: labels[i],
      airlineFareFamily: o.airlineFareFamily || null,
      // Internal only — for filters, analytics and upgrade logic. Not a label.
      normalizedFareTier: o.normalizedFareTier
        ?? normalizeFareTier({
          fareFamily: o.airlineFareFamily, cabinClass: o.cabinClass,
          refundable: b.refundable, changeable: b.changeable, checkedBags: b.checkedPieces,
        }),
      basePrice: Math.round(allPaxTotal / travelers),
      totalPrice: allPaxTotal,
      currency: o.currency || currency,
      benefits: b,
      // Legacy shape kept so existing consumers keep rendering while the UI
      // migrates to `benefits`.
      baggage: {
        carryOn: b.carryOnAllowance !== null,
        carryOnPieces: b.carryOnAllowance ? 1 : 0,
        carryOnWeightKg: b.carryOnWeightKg,
        checked: b.checkedPieces ?? 0,
        checkedWeightKg: b.checkedWeightKg,
        extraBagFeeUsd: null,
      },
      policy: {
        refundable: b.refundable, refundFeeUsd: b.refundFeeUsd,
        changeable: b.changeable, changeFeeUsd: b.changeFeeUsd,
        seatSelection: b.seatSelection, seatSelectionFeeUsd: null,
        upgradeable: null, loungeAccess: null, priorityBoarding: null, milesEarning: null,
      },
      aiScore: s.breakdown.finalScore,
      aiBadges: s.badges as AiBadge[],
      aiExplanation: s.explanation,
      aiScoreBreakdown: s.breakdown,
      // Real availability from the provider; null when it did not say.
      seatsRemaining: typeof o.seatsRemaining === 'number' ? o.seatsRemaining : null,
      popular: s.badges.includes('best_value'),
    };
  });

  return { fareOptions: built, diagnostics };
}

type FareOption = ReturnType<typeof buildFareOptions>['fareOptions'][number];

function buildResponse(
  fareOptions: FareOption[],
  opts: { offerId: string; origin: string; destination: string; stops: number; trip: string; currency: string },
) {
  // Four UI tabs: Economy, Business, First, Other. `other` is shown, not hidden
  // — an offer we could not confidently place must still be bookable.
  const fareGroups = FARE_CATEGORY_ORDER
    .map((cabin) => ({
      cabin,
      label: FARE_CATEGORY_LABELS[cabin],
      // Cheapest first — the tier ordering is inferred and must not drive display.
      fares: fareOptions.filter((f) => f.cabin === cabin).sort((a, b) => a.totalPrice - b.totalPrice),
    }))
    .filter((g) => g.fares.length > 0);

  // The invariant: grouping is a partition, so every offer in is an offer out.
  // A shortfall means a fare the provider sold us never reached the customer.
  const grouped = fareGroups.reduce((n, g) => n + g.fares.length, 0);
  if (grouped !== fareOptions.length) {
    console.error(
      `[fare-options] LOST ${fareOptions.length - grouped} of ${fareOptions.length} fares during grouping — `
      + `categories seen: ${[...new Set(fareOptions.map((f) => f.cabin))].join(', ')}`,
    );
  }

  const allSorted = [...fareOptions].sort((a, b) => b.aiScore - a.aiScore);
  const topPick = allSorted.find((f) => f.aiBadges.includes('ai_pick')) ?? allSorted[0];

  const seenIds = new Set<string>();
  const others = ([
    fareOptions.find((f) => f.aiBadges.includes('cheapest')),
    fareOptions.find((f) => f.aiBadges.includes('most_flexible')),
    fareOptions.find((f) => f.aiBadges.includes('best_comfort')),
    fareOptions.find((f) => f.aiBadges.includes('premium_upgrade')),
  ].filter(Boolean) as FareOption[])
    .filter((f) => {
      if (!topPick || f.id === topPick.id || seenIds.has(f.id)) return false;
      seenIds.add(f.id);
      return true;
    });

  const stopsLabel = opts.stops === 0 ? 'Non-stop' : `${opts.stops} stop${opts.stops > 1 ? 's' : ''}`;
  const journeySummary = opts.trip === 'round_trip'
    ? `${opts.origin} → ${opts.destination} · ${stopsLabel}  |  ${opts.destination} → ${opts.origin}`
    : `${opts.origin} → ${opts.destination} · ${stopsLabel}`;

  return {
    offerId: opts.offerId,
    destinationCity: opts.destination,
    journeySummary,
    fareGroups,
    aiRecommendations: {
      topPick: topPick ? {
        badge: topPick.aiBadges[0] ?? 'best_value',
        fareId: topPick.id,
        headline: BADGE_HEADLINES[topPick.aiBadges[0] as AiBadge] ?? 'AI Best Choice',
        reason: topPick.aiExplanation,
      } : null,
      others: others.map((f) => ({
        badge: f.aiBadges[0],
        fareId: f.id,
        headline: BADGE_HEADLINES[f.aiBadges[0] as AiBadge] ?? f.name,
        reason: f.aiExplanation,
      })),
    },
    currency: opts.currency,
    baseCurrency: opts.currency,
  };
}

const plugin: FastifyPluginAsync = async (fastify) => {
  /**
   * The real path. Body carries the sibling offers for one flight — everything
   * from the search sharing an `itineraryKey`.
   */
  fastify.post('/options', async (request, reply) => {
    try {
      const body = request.body as {
        offers?: IncomingOffer[];
        traveler_count?: number;
        currency?: string;
        origin?: string;
        destination?: string;
        stops?: number;
        trip?: string;
        flight_context?: { duration_minutes?: number; stops?: number; layover_minutes?: number[] };
      };

      const offers = Array.isArray(body?.offers) ? body.offers.filter((o) => (o?.totalPrice ?? 0) > 0) : [];
      if (offers.length === 0) {
        return reply.code(400).send({ error: 'offers[] is required and must contain at least one priced fare' });
      }

      const travelers = Math.max(1, Number(body.traveler_count) || 1);
      const currency = body.currency || offers[0]?.currency || 'USD';
      const stops = Number(body.stops ?? body.flight_context?.stops ?? 0) || 0;
      const ctx: FlightContext = {
        durationMinutes: Number(body.flight_context?.duration_minutes) || 0,
        stops,
        layoverMinutes: body.flight_context?.layover_minutes ?? [],
      };

      const { fareOptions, diagnostics } = buildFareOptions(offers, ctx, travelers, currency);

      // One line per search. `discarded=0` is the contract: every offer the
      // provider returned reached a tab. A non-zero value is a real defect.
      fastify.log.info(`[fare-options] classification · ${formatDiagnostics(diagnostics)}`);
      const anchorOfferId = offers[0]?.providerOfferId || offers[0]?.offerId || '';

      const withoutBrand = offers.filter((o) => !((o.airlineFareFamily || '').trim())).length;
      if (withoutBrand > 0) {
        fastify.log.info(
          `[fare-options] ${withoutBrand}/${offers.length} fares carry no airline FareFamily — labelled by cabin, not invented.`,
        );
      }

      return buildResponse(fareOptions, {
        offerId: anchorOfferId,
        origin: body.origin || '',
        destination: body.destination || '',
        stops,
        trip: body.trip || 'one_way',
        currency,
      });
    } catch (err) {
      fastify.log.error({ err }, '[fare-options] POST failed');
      return reply.code(500).send({ error: 'Failed to build fare options' });
    }
  });

  /**
   * Compatibility path — a caller holding one offer and no siblings. Returns
   * that single fare, labelled from provider data.
   */
  fastify.get('/options', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const offer_id = q.offer_id || '';
      if (!offer_id) {
        fastify.log.warn('[fare-options] offer_id is empty — the returned fare cannot be booked.');
      }
      if (!q.base_price) return reply.code(400).send({ error: 'base_price is required' });

      const basePriceNum = parseFloat(q.base_price);
      const travelers = parseInt(q.traveler_count || '1', 10) || 1;
      const currency = q.currency || 'USD';
      const stopsNum = parseInt(q.stops || '0', 10) || 0;
      const cabin = q.cabin_class || 'economy';

      const cacheKey = `${fareOptionsKey(offer_id, basePriceNum, travelers)}:${q.fare_family || ''}`;
      const cached = await cacheGet<object>(cacheKey);
      if (cached) return cached;

      const ctx: FlightContext = {
        durationMinutes: parseInt(q.duration_minutes || '0', 10) || 0,
        stops: stopsNum,
        layoverMinutes: (q.layover_minutes || '')
          .split(',').map(Number).filter((n) => !isNaN(n) && n > 0),
      };

      const offer: IncomingOffer = {
        id: `fare_0_${offer_id || 'unknown'}`,
        providerOfferId: offer_id,
        airlineFareFamily: q.fare_family || null,
        cabinClass: cabin,
        bookingClass: q.booking_class || null,
        totalPrice: basePriceNum,
        currency,
        seatsRemaining: q.seats_remaining ? parseInt(q.seats_remaining, 10) : null,
        checkedBaggageAllowance: q.provider_checked_baggage || null,
        cabinBaggageAllowance: q.provider_cabin_baggage || null,
        baggage: q.provider_checked_bags !== undefined
          ? { checked: parseInt(q.provider_checked_bags, 10) } : null,
        fareRules: {
          refundable: q.provider_refundable !== undefined ? q.provider_refundable === 'true' : null,
          changeable: q.provider_changeable !== undefined ? q.provider_changeable === 'true' : null,
          changeFee: q.provider_change_fee ? parseFloat(q.provider_change_fee) : null,
          cancellationFee: q.provider_refund_fee ? parseFloat(q.provider_refund_fee) : null,
        },
      };

      const single = buildFareOptions([offer], ctx, travelers, currency);
      fastify.log.info(`[fare-options] classification · ${formatDiagnostics(single.diagnostics)}`);
      const response = buildResponse(single.fareOptions, {
        offerId: offer_id,
        origin: q.origin || '',
        destination: q.destination || '',
        stops: stopsNum,
        trip: q.trip || 'one_way',
        currency,
      });

      await cacheSet(cacheKey, response, 300);
      return response;
    } catch (err) {
      fastify.log.error({ err }, '[fare-options] GET failed');
      return reply.code(500).send({ error: 'Failed to generate fare options' });
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
      fastify.log.error({ err }, '[fare-options/compute-ai-score] failed');
      return reply.code(500).send({ error: 'Failed to compute AI scores' });
    }
  });
};

export default plugin;

/** Exported for src/routes/fare-options.dedupe.test.ts. */
export const __testing = { dedupeIndistinguishable };
