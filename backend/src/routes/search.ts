import { FastifyPluginAsync } from 'fastify';
import { searchFlights, getProviderStatus } from '../services/orchestrator';
import { logSearch } from '../lib/db-queries';
import { scoreFlights, WEIGHTS } from '../lib/flight/score';
import { cacheGet, cacheSet, searchKey } from '../services/cache';
import { applyMarkupToOffers } from '../services/markup-service';
import type { UnifiedFlight } from '../lib/types';

const CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first'] as const;

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const q = request.query as Record<string, string>;
    const origin      = q.origin?.toUpperCase();
    const destination = q.destination?.toUpperCase();
    const date        = q.date;
    const returnDate  = q.returnDate || undefined;
    const adults      = parseInt(q.adults || '1');
    const children    = parseInt(q.children || '0');
    const infants     = parseInt(q.infants || '0');
    const cabin       = q.cabin || 'economy';
    const trip        = q.trip || 'one_way';

    // Parse multi-city legs (JSON-encoded array)
    let legs: { origin: string; destination: string; departureDate: string }[] | undefined;
    if (q.legs) {
      try {
        legs = JSON.parse(q.legs);
        if (!Array.isArray(legs) || legs.length < 2) {
          return reply.code(400).send({ error: 'Multi-city requires at least 2 legs' });
        }
        for (const leg of legs) {
          if (!leg.origin || !leg.destination || !leg.departureDate) {
            return reply.code(400).send({ error: 'Each leg must have origin, destination, and departureDate' });
          }
          if (leg.origin.length !== 3 || leg.destination.length !== 3) {
            return reply.code(400).send({ error: 'origin and destination must be 3-letter IATA codes' });
          }
        }
      } catch {
        return reply.code(400).send({ error: 'Invalid legs JSON format' });
      }
    }

    const isMultiCity = trip === 'multi_city' && legs && legs.length >= 2;

    // For non-multi-city, require origin/destination/date
    if (!isMultiCity) {
      if (!origin || !destination || !date) {
        return reply.code(400).send({ error: 'Missing required parameters: origin, destination, date' });
      }
      if (origin.length !== 3 || destination.length !== 3) {
        return reply.code(400).send({ error: 'origin and destination must be 3-letter IATA codes' });
      }
      if (origin === destination) {
        return reply.code(400).send({ error: 'origin and destination must be different' });
      }
    }

    // For multi-city, use first leg for origin/destination in cache key + logging
    const effectiveOrigin = isMultiCity ? legs![0].origin.toUpperCase() : origin;
    const effectiveDestination = isMultiCity ? legs![legs!.length - 1].destination.toUpperCase() : destination;
    const effectiveDate = isMultiCity ? legs![0].departureDate : date;

    // ── Redis cache check (cabin-agnostic key) ───────────────────────────────
    const cacheKey = isMultiCity
      ? searchKey(effectiveOrigin, effectiveDestination, effectiveDate, undefined, adults, children, infants) + ':mc'
      : searchKey(origin, destination, date, returnDate, adults, children, infants);
    const cached = await cacheGet<object>(cacheKey);
    if (cached) return cached;

    try {
      const result = await searchFlights({
        origin: effectiveOrigin, destination: effectiveDestination,
        date: effectiveDate, returnDate,
        adults, children, infants,
        ...(isMultiCity ? { legs } : {}),
      });

      const mergedFlights = result.flights;
      const totalTimeMs = result.totalTimeMs;
      const usedMockData = result.usedMockData;
      const allProviders = result.providers.map(p => ({
        provider: p.provider, count: p.flights.length, responseTimeMs: p.responseTimeMs, error: p.error || null, isMock: p.isMock,
      }));

      const lowestPrice = mergedFlights.length > 0 ? Math.min(...mergedFlights.map((f) => f.totalPrice)) : undefined;
      logSearch({
        origin: effectiveOrigin, destination: effectiveDestination, departureDate: new Date(effectiveDate),
        returnDate: returnDate ? new Date(returnDate) : undefined,
        adults, children, infants,
        cabinClass: cabin.toUpperCase() as any,
        tripType: isMultiCity ? 'MULTI_CITY' : trip === 'round_trip' ? 'ROUND_TRIP' : 'ONE_WAY',
        resultsCount: mergedFlights.length, lowestPrice, currency: 'USD',
        searchDurationMs: totalTimeMs,
      }).catch(() => {});

      let rankedFlights = mergedFlights;

      // ── Apply internal markup before scoring ─────────────────────────────
      await applyMarkupToOffers(rankedFlights);

      if (mergedFlights.length > 0) {
        const metrics = mergedFlights.map((f) => ({ id: f.id, price: f.totalPrice, durationMin: f.totalDuration, stops: f.stops }));

        const bestScored     = scoreFlights(metrics, WEIGHTS.best);
        const cheapestScored = scoreFlights(metrics, WEIGHTS.cheapest);
        const fastestScored  = scoreFlights(metrics, WEIGHTS.fastest);

        const topBestId     = bestScored.reduce((a, b) => (b.score > a.score ? b : a)).id;
        const topCheapestId = cheapestScored.reduce((a, b) => (b.score > a.score ? b : a)).id;
        const topFastestId  = fastestScored.reduce((a, b) => (b.score > a.score ? b : a)).id;

        const bestMap = new Map(bestScored.map((s) => [s.id, s]));

        const enriched = mergedFlights.map((f) => {
          const scored = bestMap.get(f.id)!;
          const tags: ('best_value' | 'cheapest' | 'fastest')[] = [];
          if (f.id === topBestId)     tags.push('best_value');
          if (f.id === topCheapestId) tags.push('cheapest');
          if (f.id === topFastestId)  tags.push('fastest');
          return { ...f, valueScore: Math.round(scored.score * 100), breakdown: scored.breakdown, tags };
        });

        rankedFlights = enriched.sort((a, b) => b.valueScore - a.valueScore).map((f, i) => {
          if (i >= 50) {
            return { ...f, valueScore: 0, breakdown: undefined };
          }
          return f;
        });
      }

      // Aggregate class counts for the filter panel
      const classCounts: Record<string, { count: number; minPrice: number }> = {};
      for (const f of rankedFlights) {
        const c = f.cabinClass;
        if (!classCounts[c]) classCounts[c] = { count: 0, minPrice: Infinity };
        classCounts[c].count++;
        if (f.totalPrice < classCounts[c].minPrice) classCounts[c].minPrice = f.totalPrice;
      }

      const providerStatus = getProviderStatus();
      const response = {
        flights: rankedFlights,
        meta: {
          totalResults: rankedFlights.length,
          totalTimeMs,
          usedMockData,
          providers: allProviders,
          providerStatus: {
            duffel: providerStatus.duffel.configured ? 'connected' : 'not_configured',
            amadeus: providerStatus.amadeus.configured ? 'connected' : 'not_configured',
            mystifly: providerStatus.mystifly.configured ? 'connected' : 'not_configured',
          },
          filters: {
            classes: classCounts,
          },
          aggregation: result.aggregationStats || null,
        },
      };

      // Cache for 120s
      await cacheSet(cacheKey, response, 120);
      return response;
    } catch (error) {
      reply.code(500).send({ error: 'Search failed. Please try again.' });
    }
  });
};

export default plugin;
