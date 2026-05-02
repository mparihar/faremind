import { FastifyPluginAsync } from 'fastify';
import { getSearchHistory } from '../lib/db-queries';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const { userId, limit: limitStr = '20' } = request.query as { userId?: string; limit?: string };
    const limit = parseInt(limitStr);
    if (!userId) return reply.code(400).send({ error: 'userId is required' });

    try {
      const history = await getSearchHistory(userId, Math.min(limit, 50));
      return { history };
    } catch {
      reply.code(500).send({ error: 'Failed to fetch search history' });
    }
  });
};

export default plugin;
