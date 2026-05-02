import { FastifyPluginAsync } from 'fastify';
import { getBookingsByUserId, getBookingById, getDashboardStats, getPriceAlerts } from '../lib/db-queries';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const { userId, status } = request.query as { userId?: string; status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' };
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    try {
      const [bookings, stats, alerts] = await Promise.all([
        getBookingsByUserId(userId, status || undefined),
        getDashboardStats(userId),
        getPriceAlerts(userId, 'NEW'),
      ]);
      return { bookings, stats, alerts };
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
      reply.code(500).send({ error: 'Failed to fetch bookings' });
    }
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id) return reply.code(400).send({ error: 'Booking ID required' });

    try {
      const booking = await getBookingById(id);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      return { booking };
    } catch (error) {
      console.error('[Booking Detail] Failed:', error);
      reply.code(500).send({ error: 'Failed to fetch booking' });
    }
  });
};

export default plugin;
