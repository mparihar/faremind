/**
 * FareMind Ranking Engine — Fastify Route Plugin
 *
 * Optional API endpoint for testing and future integration.
 * Does NOT modify the existing /api/search route.
 *
 * Endpoints:
 *   POST /api/ranking         — Rank flight offers
 *   POST /api/ranking/explain — Generate GPT explanation for ranked offer
 */

import { FastifyPluginAsync } from 'fastify';
import { rankFlightOffers } from './core/rankOffers';
import { explainRanking } from './explanation/explainRanking';
import { detectJourneyType } from './core/detectJourneyType';
import type { RankingInput, RankedOffer, SearchContext, JourneyType } from './types';

const plugin: FastifyPluginAsync = async (fastify) => {

  /**
   * POST /api/ranking
   *
   * Accepts RankingInput, returns RankingOutput with full score
   * breakdowns, applied rules, machine reasons, and audit data.
   */
  fastify.post('/', async (request, reply) => {
    try {
      const input = request.body as RankingInput;

      // Basic validation
      if (!input?.searchContext || !input?.offers || !Array.isArray(input.offers)) {
        return reply.code(400).send({
          error: 'Invalid input. Expected { searchContext: {...}, offers: [...] }',
        });
      }

      if (input.offers.length === 0) {
        return reply.code(400).send({
          error: 'No offers provided to rank.',
        });
      }

      const result = rankFlightOffers(input);
      return result;
    } catch (error) {
      fastify.log.error(error, '[Ranking] Failed to rank offers');
      return reply.code(500).send({
        error: 'Ranking failed. Please try again.',
      });
    }
  });

  /**
   * POST /api/ranking/explain
   *
   * Accepts a ranked offer + search context, returns GPT explanation.
   * Gracefully falls back to machine reasons if GPT is unavailable.
   */
  fastify.post('/explain', async (request, reply) => {
    try {
      const body = request.body as {
        rankedOffer: RankedOffer;
        searchContext: SearchContext;
        journeyType?: JourneyType;
      };

      if (!body?.rankedOffer || !body?.searchContext) {
        return reply.code(400).send({
          error: 'Invalid input. Expected { rankedOffer: {...}, searchContext: {...} }',
        });
      }

      const journeyType = body.journeyType || detectJourneyType(
        body.searchContext.origin,
        body.searchContext.destination,
        body.searchContext.journeyType,
      );

      const explanation = await explainRanking(
        body.rankedOffer,
        body.searchContext,
        journeyType,
      );

      return {
        offerId: body.rankedOffer.offerId,
        rank: body.rankedOffer.rank,
        explanation,
      };
    } catch (error) {
      fastify.log.error(error, '[Ranking] Failed to generate explanation');
      return reply.code(500).send({
        error: 'Explanation generation failed.',
      });
    }
  });
};

export default plugin;
