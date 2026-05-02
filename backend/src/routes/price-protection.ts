import { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/quote', (request, reply) => {
    try {
      const { fare_id, total_price, currency = 'USD' } = request.query as Record<string, string>;

      if (!fare_id || !total_price) {
        return reply.code(400).send({ error: 'fare_id and total_price are required' });
      }

      const totalPriceNum = parseFloat(total_price);
      if (isNaN(totalPriceNum) || totalPriceNum <= 0) {
        return reply.code(400).send({ error: 'total_price must be a positive number' });
      }

      const protectionFeeUsd = Math.min(Math.max(Math.round(totalPriceNum * 0.06), 49), 399);

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
