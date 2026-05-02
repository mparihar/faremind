import { FastifyPluginAsync } from 'fastify';
import { searchAirports } from '../lib/db-queries';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (request, reply) => {
    const { q = '', limit: limitStr = '10' } = request.query as { q?: string; limit?: string };
    const limit = parseInt(limitStr);
    if (!q || q.length < 1) return { airports: [] };

    try {
      const airports = await searchAirports(q, Math.min(limit, 25));
      return {
        airports: airports.map((a) => ({
          code: a.iataCode, name: a.name, city: a.city, country: a.country, countryCode: a.countryCode,
        })),
      };
    } catch (error) {
      console.error('Airport search failed:', error);
      reply.code(500).send({ error: 'Failed to search airports' });
    }
  });
};

export default plugin;
