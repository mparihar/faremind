import { FastifyPluginAsync } from 'fastify';
import { getPriceHistory, addPriceHistoryEntry } from '../lib/db-queries';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const { bookingId } = request.query as { bookingId?: string };
    if (!bookingId) return reply.code(400).send({ error: 'bookingId is required' });

    try {
      const history = await getPriceHistory(bookingId);
      return {
        bookingId,
        history: history.map((h) => ({ price: Number(h.price), currency: h.currency, provider: h.provider, checkedAt: h.checkedAt.toISOString() })),
      };
    } catch {
      reply.code(500).send({ error: 'Failed to fetch price history' });
    }
  });

  fastify.post('/', async (request, reply) => {
    try {
      const { bookingId, price, currency, provider } = request.body as {
        bookingId?: string; price?: number; currency?: string; provider?: string;
      };
      if (!bookingId || !price || !provider) return reply.code(400).send({ error: 'bookingId, price, and provider are required' });
      const entry = await addPriceHistoryEntry(bookingId, Number(price), currency || 'USD', (provider as string).toUpperCase() as any);
      return { entry, success: true };
    } catch {
      reply.code(500).send({ error: 'Failed to add price check entry' });
    }
  });
};

export default plugin;
