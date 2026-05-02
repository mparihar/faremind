import { FastifyPluginAsync } from 'fastify';
import { getUserNotifications, markNotificationRead, getUnreadCount } from '../lib/db-queries';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const { userId, limit: limitStr = '50' } = request.query as { userId?: string; limit?: string };
    const limit = parseInt(limitStr);
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    try {
      const [notifications, unreadCount] = await Promise.all([getUserNotifications(userId, limit), getUnreadCount(userId)]);
      return { notifications, unreadCount };
    } catch {
      reply.code(500).send({ error: 'Failed to fetch notifications' });
    }
  });

  fastify.patch('/', async (request, reply) => {
    try {
      const { notificationId } = request.body as { notificationId?: string };
      if (!notificationId) return reply.code(400).send({ error: 'notificationId is required' });
      const notification = await markNotificationRead(notificationId);
      return { notification };
    } catch {
      reply.code(500).send({ error: 'Failed to update notification' });
    }
  });
};

export default plugin;
