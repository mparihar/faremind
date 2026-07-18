/**
 * FareMind Backend — Fastify API Gateway
 *
 * Architecture: Fastify → Services (Duffel/Amadeus) → PostgreSQL + Redis
 * Frontend (Next.js :3000) → Gateway (:3001) → External APIs + DB + Cache
 */

// ─── Env preloader — MUST be the first import ────────────────────────────────
// Loads backend/.env then root .env (for shared vars like FLIGHT_PROVIDER_MODE)
import './env';

import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';
import { getClientIp, getRouteRateLimit, getCachedLimit, buildRateLimitErrorResponse } from './lib/rate-limit';

// ─── Route plugins ────────────────────────────────────────────────────────────
import healthPlugin        from './routes/health';
import searchPlugin        from './routes/search';
import bookPlugin          from './routes/book';
import bookingsPlugin      from './routes/bookings';
import cancelPlugin        from './routes/cancel';
import authPlugin          from './routes/auth';
import airportsPlugin      from './routes/airports';
import notificationsPlugin from './routes/notifications';
import priceCheckPlugin    from './routes/price-check';
import priceMonitorPlugin  from './routes/price-monitor';
import searchHistoryPlugin from './routes/search-history';
import popularRoutesPlugin from './routes/popular-routes';
import flexibleSearchPlugin from './routes/flexible-search';
import fareOptionsPlugin   from './routes/fare-options';
import priceProtectionPlugin from './routes/price-protection';
import bookingSessionPlugin from './routes/booking-session';
import checkoutPlugin      from './routes/checkout';
import manageBookingPlugin from './routes/manage-booking';
import voiceCommandPlugin   from './routes/voice-command';
import adminNotificationsPlugin from './routes/admin-notifications';
import mystiflyBookingPlugin from './routes/mystifly-booking';
import mystiflyPtrPlugin     from './routes/mystifly-ptr';
import rankingPlugin         from './ranking/route';
import limitOrdersPlugin     from './routes/limit-orders';
import adminCancellationQueuePlugin from './routes/admin-cancellation-queue';
import { startLimitOrderScheduler, stopLimitOrderScheduler } from './workers/limit-order-cron';
import { startRefundReconciliationScheduler, stopRefundReconciliationScheduler } from './workers/refund-reconciliation-cron';

const PORT = parseInt(process.env.PORT || process.env.BACKEND_PORT || '3001');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

async function main() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
      serializers: {
        req(req) { return { method: req.method, url: req.url }; },
      },
    },
    keepAliveTimeout: 65_000,
    connectionTimeout: 120_000,
    bodyLimit: 10 * 1024 * 1024,
  });

  // ─── Plugins ────────────────────────────────────────────────────────────────

  // CORS: support multiple origins via CORS_ORIGINS (comma-separated) or FRONTEND_URL
  const allowedOrigins = (process.env.CORS_ORIGINS || FRONTEND_URL)
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);

  await fastify.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        fastify.log.warn({ origin, allowedOrigins }, 'CORS rejected');
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await fastify.register(compress, { global: true });

  // ─── Rate Limiting ──────────────────────────────────────────────────────────
  // Limits are dynamically configurable via the admin console (SystemConfig table).
  // DB values are cached for 60s — changes take effect without restart.
  // Priority: DB → env var → hardcoded default.
  // Set RATE_LIMIT_ENABLED=false in env, or toggle via admin console, to disable.
  // See backend/src/lib/rate-limit.ts for full configuration and docs.
  const isRateLimitEnabledAtBoot = (process.env.RATE_LIMIT_ENABLED ?? 'true') !== 'false';

  if (isRateLimitEnabledAtBoot) {
    await fastify.register(rateLimit, {
      global: true,
      // Dynamic global max — reads from DB cache, so admin changes take effect live
      max: () => getCachedLimit('GLOBAL'),
      timeWindow: '1 minute',
      keyGenerator: (request) => getClientIp(request),
      errorResponseBuilder: buildRateLimitErrorResponse,
    });

    // Inject per-route rate limit configs based on URL pattern matching.
    // The `max` on each config is an async function that reads from the
    // DB-backed cache, so admin console changes take effect within 60s.
    fastify.addHook('onRoute', (routeOptions) => {
      const config = getRouteRateLimit(routeOptions.url);
      if (config) {
        routeOptions.config = {
          ...routeOptions.config,
          rateLimit: config,
        };
      }
    });
  } else {
    // Rate limiting disabled at boot — register with global:false so the plugin
    // is loaded (routes that reference rateLimit config won't break)
    // but no limits are enforced.
    await fastify.register(rateLimit, {
      global: false,
      max: 120,
      timeWindow: '1 minute',
    });
  }


  // ─── Routes ─────────────────────────────────────────────────────────────────

  fastify.register(healthPlugin,          { prefix: '/api/health' });
  fastify.register(searchPlugin,          { prefix: '/api/search' });
  fastify.register(bookPlugin,            { prefix: '/api/book' });
  fastify.register(bookingsPlugin,        { prefix: '/api/bookings' });
  fastify.register(cancelPlugin,          { prefix: '/api/cancel' });
  fastify.register(authPlugin,            { prefix: '/api/auth' });
  fastify.register(airportsPlugin,        { prefix: '/api/airports' });
  fastify.register(notificationsPlugin,   { prefix: '/api/notifications' });
  fastify.register(priceCheckPlugin,      { prefix: '/api/price-check' });
  fastify.register(priceMonitorPlugin,    { prefix: '/api/price-monitor' });
  fastify.register(searchHistoryPlugin,   { prefix: '/api/search-history' });
  fastify.register(popularRoutesPlugin,   { prefix: '/api/popular-routes' });
  fastify.register(flexibleSearchPlugin,  { prefix: '/api/flexible-search' });
  fastify.register(fareOptionsPlugin,     { prefix: '/api/fares' });
  fastify.register(priceProtectionPlugin, { prefix: '/api/price-protection' });
  fastify.register(bookingSessionPlugin,  { prefix: '/api/booking-session' });
  fastify.register(checkoutPlugin,        { prefix: '/api/checkout' });
  fastify.register(manageBookingPlugin,   { prefix: '/api/manage-booking' });
  fastify.register(voiceCommandPlugin,     { prefix: '/api/voice' });
  fastify.register(adminNotificationsPlugin, { prefix: '/api/admin/notification-recipients' });
  fastify.register(mystiflyBookingPlugin,    { prefix: '/api/mystifly' });
  fastify.register(mystiflyPtrPlugin,         { prefix: '/api/mystifly-ptr' });
  fastify.register(rankingPlugin,             { prefix: '/api/ranking' });
  fastify.register(limitOrdersPlugin,          { prefix: '/api/limit-orders' });
  fastify.register(adminCancellationQueuePlugin, { prefix: '/api/admin/cancellation-queue' });

  // ─── 404 / error handlers ────────────────────────────────────────────────

  fastify.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: 'Endpoint not found' });
  });

  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    fastify.log.error(error, '[Server] Unhandled error');
    reply.code(error.statusCode ?? 500).send({ error: error.message || 'Internal server error' });
  });

  // ─── Start ──────────────────────────────────────────────────────────────────

  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });

    // Start background workers
    startLimitOrderScheduler();
    startRefundReconciliationScheduler();

    // Graceful shutdown
    const shutdown = () => { stopLimitOrderScheduler(); stopRefundReconciliationScheduler(); fastify.close(); };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  return fastify;
}

main();
