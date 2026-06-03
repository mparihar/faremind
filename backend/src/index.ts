/**
 * FareMind Backend — Fastify API Gateway
 *
 * Architecture: Fastify → Services (Duffel/Amadeus) → PostgreSQL + Redis
 * Frontend (Next.js :3000) → Gateway (:3001) → External APIs + DB + Cache
 */

import 'dotenv/config';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import rateLimit from '@fastify/rate-limit';

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

  await fastify.register(rateLimit, {
    global: false,
    max: 120,
    timeWindow: '1 minute',
  });

  // ─── Request timing hook ──────────────────────────────────────────────────

  fastify.addHook('onResponse', (request, reply, done) => {
    fastify.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, responseTime: reply.elapsedTime.toFixed(1) },
      '[API]'
    );
    done();
  });

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
    const dbUrl = process.env.DATABASE_URL || '';
    const dbHost = dbUrl ? new URL(dbUrl).hostname : 'NOT SET';
    console.log(`\n═══════════════════════════════════════════════`);
    console.log(`  FareMind Backend — Fastify API Gateway`);
    console.log(`  Port:        ${PORT}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  CWD:         ${process.cwd()}`);
    console.log(`  CORS Origin: ${FRONTEND_URL}`);
    console.log(`  Database:    ${dbUrl ? `connected (${dbHost})` : '❌ DATABASE_URL NOT SET'}`);
    console.log(`  Redis:       ${process.env.REDIS_URL ? 'connected' : 'disabled (no REDIS_URL)'}`);
    console.log(`  Duffel:      ${process.env.DUFFEL_API_TOKEN ? '✅ configured' : '❌ DUFFEL_API_TOKEN NOT SET'}`);
    console.log(`  Mystifly:    ${process.env.MYSTIFLY_SESSION_ID || process.env.MYSTIFLY_USERNAME ? '✅ configured' : '❌ NOT CONFIGURED'}`);
    console.log(`═══════════════════════════════════════════════\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  return fastify;
}

main();
