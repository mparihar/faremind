import { FastifyPluginAsync } from 'fastify';

const sessions = new Map<string, object>();

function calcProtectionFee(totalPrice: number): number {
  return Math.min(Math.max(Math.round(totalPrice * 0.06), 49), 399);
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/select-fare', (request, reply) => {
    try {
      const {
        fareId, offerId, cabin, name, basePrice, totalPrice,
        priceProtection = false, currency = 'USD',
      } = request.body as any;

      if (!fareId || !offerId || !totalPrice) {
        return reply.code(400).send({ error: 'fareId, offerId, and totalPrice are required' });
      }

      const protectionFee = priceProtection ? calcProtectionFee(totalPrice) : 0;
      const grandTotal = totalPrice + protectionFee;
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const session = { sessionId, fareId, offerId, cabin, name, basePrice, totalPrice, priceProtection, protectionFee, grandTotal, currency, createdAt: new Date().toISOString() };
      sessions.set(sessionId, session);

      return reply.send(session);
    } catch (err) {
      console.error('[booking-session] select-fare error:', err);
      reply.code(500).send({ error: 'Failed to create booking session' });
    }
  });

  fastify.post('/recalculate', (request, reply) => {
    try {
      const { fareId, totalPrice, priceProtection = false, currency = 'USD' } = request.body as any;

      if (!fareId || !totalPrice) {
        return reply.code(400).send({ error: 'fareId and totalPrice are required' });
      }

      const protectionFee = priceProtection ? calcProtectionFee(totalPrice) : 0;
      const grandTotal = totalPrice + protectionFee;

      return reply.send({ fareId, totalPrice, priceProtection, protectionFee, grandTotal, currency });
    } catch (err) {
      console.error('[booking-session] recalculate error:', err);
      reply.code(500).send({ error: 'Failed to recalculate' });
    }
  });
};

export default plugin;
