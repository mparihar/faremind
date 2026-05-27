import { FastifyPluginAsync } from 'fastify';
import { getProviderStatus } from '../services/orchestrator';
import { prisma } from '../lib/db';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', async (_request, _reply) => {
    const providerStatus = getProviderStatus();
    let dbConnected = false;
    let dbCounts: Record<string, number> = {};

    try {
      const [users, bookings, airlines, airports, alerts] = await Promise.all([
        prisma.user.count(), prisma.booking.count(), prisma.airline.count(),
        prisma.airport.count(), prisma.priceAlert.count(),
      ]);
      dbConnected = true;
      dbCounts = { users, bookings, airlines, airports, priceAlerts: alerts };
    } catch (error) {
      console.error('[Health] Database check failed:', error);
    }

    return {
      status: dbConnected ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      version: '0.2.0',
      server: 'fastify',
      database: { connected: dbConnected, provider: 'Railway PostgreSQL', counts: dbCounts },
      providers: {
        duffel: { type: 'NDC', status: providerStatus.duffel.configured ? 'connected' : 'not_configured', description: providerStatus.duffel.description },
        amadeus: { type: 'GDS', status: providerStatus.amadeus.configured ? 'connected' : 'not_configured', description: providerStatus.amadeus.description },
        mystifly: { type: 'GDS_AGGREGATOR', status: providerStatus.mystifly.configured ? 'connected' : 'not_configured', description: providerStatus.mystifly.description },
      },
      features: { flightSearch: true, booking: true, priceTracking: true, cancellation: true, notifications: true, rebooking: false },
    };
  });
};

export default plugin;
