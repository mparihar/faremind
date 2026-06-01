import { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/quote', async (request, reply) => {
    try {
      const { fare_id, total_price, currency = 'USD', cabin, fare_class, trip_type, origin_country, destination_country, traveler_count } = request.query as Record<string, string>;

      if (!fare_id || !total_price) {
        return reply.code(400).send({ error: 'fare_id and total_price are required' });
      }

      const totalPriceNum = parseFloat(total_price);
      if (isNaN(totalPriceNum) || totalPriceNum <= 0) {
        return reply.code(400).send({ error: 'total_price must be a positive number' });
      }

      const paxCount = parseInt(traveler_count || '1') || 1;

      // Try to fetch admin-configured protection rule from DB
      let protectionFeeUsd: number;
      try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const rules = await prisma.protectionProductRule.findMany({
          where: { active: true, deletedAt: null },
          orderBy: { priority: 'desc' },
        });
        prisma.$disconnect();

        const now = new Date();
        const rule = rules.find((r: any) =>
          r.effectiveFrom <= now && (!r.effectiveTo || r.effectiveTo >= now)
        );

        if (rule) {
          const fixedAmt = Number(rule.fixedAmount ?? 0);
          const pctVal = Number(rule.percentageValue ?? 0);
          if (rule.pricingModel === 'FIXED_PER_TRAVELER') {
            protectionFeeUsd = Math.round(fixedAmt);
          } else if (rule.pricingModel === 'FIXED_PER_BOOKING') {
            protectionFeeUsd = Math.round(fixedAmt);
          } else if (rule.pricingModel === 'PERCENTAGE_OF_FARE') {
            const perPerson = (totalPriceNum / paxCount) * (pctVal / 100);
            protectionFeeUsd = Math.min(Math.max(Math.round(perPerson), 49), 399);
          } else {
            // PROVIDER_QUOTED fallback
            protectionFeeUsd = Math.min(Math.max(Math.round(totalPriceNum * 0.06 / paxCount), 49), 399);
          }
        } else {
          // No rule found — fallback
          protectionFeeUsd = Math.min(Math.max(Math.round(totalPriceNum * 0.06 / paxCount), 49), 399);
        }
      } catch {
        // DB unavailable — use hardcoded fallback
        protectionFeeUsd = Math.min(Math.max(Math.round(totalPriceNum * 0.06 / paxCount), 49), 399);
      }

      return reply.send({
        fareId: fare_id,
        protectionFeeUsd,
        coveragePct: 80,
        maxRefundUsd: Math.round(totalPriceNum * 0.8),
        validHours: 24,
        currency,
      });
    } catch (err) {
      console.error('[price-protection] Error:', err);
      reply.code(500).send({ error: 'Failed to generate protection quote' });
    }
  });
};

export default plugin;
