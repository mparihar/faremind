import { FastifyPluginAsync } from 'fastify';
import { getPrisma } from '../lib/db';

const sessions = new Map<string, object>();

const DEFAULT_EXPIRY_MINUTES = 20;

/**
 * Reads the configured offer expiry minutes from the SystemConfig table.
 * Falls back to DEFAULT_EXPIRY_MINUTES if the config doesn't exist or DB fails.
 */
async function getOfferExpiryMinutes(): Promise<number> {
  try {
    const prisma = getPrisma();
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'offer_expiry_minutes' },
    });
    if (config) {
      const minutes = parseInt(config.value, 10);
      if (!isNaN(minutes) && minutes >= 5 && minutes <= 60) {
        return minutes;
      }
    }
  } catch (err: any) {
    console.warn('[OfferSession] Failed to read offer_expiry_minutes from DB, using default:', err.message);
  }
  return DEFAULT_EXPIRY_MINUTES;
}

function calcProtectionFee(totalPrice: number): number {
  return Math.min(Math.max(Math.round(totalPrice * 0.06), 49), 399);
}

function getRemainingSeconds(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

function computeStatus(expiresAt: Date, warningThreshold = 180): string {
  const remaining = getRemainingSeconds(expiresAt);
  if (remaining <= 0) return 'EXPIRED';
  if (remaining <= warningThreshold) return 'WARNING';
  return 'ACTIVE';
}

const plugin: FastifyPluginAsync = async (fastify) => {

  // ═══════════════════════════════════════════════
  // Existing endpoints
  // ═══════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════
  // Offer Session — Expiry Countdown
  // ═══════════════════════════════════════════════

  /**
   * POST /offer-session/start
   * Creates a new offer session for tracking offer expiry during checkout.
   */
  fastify.post('/offer-session/start', async (request, reply) => {
    try {
      const {
        provider,
        providerOfferId,
        offerExpiryTimestamp,
        searchCriteria,
      } = request.body as {
        provider: string;
        providerOfferId: string;
        offerExpiryTimestamp?: string;
        searchCriteria?: object;
      };

      if (!provider || !providerOfferId) {
        return reply.code(400).send({ error: 'provider and providerOfferId are required' });
      }

      // Always cap at admin-configured minutes.
      // If the provider gives a longer window, we still limit to our config.
      // If the provider gives a shorter window, we respect that.
      const expiryMinutes = await getOfferExpiryMinutes();
      const configuredExpiry = new Date(Date.now() + expiryMinutes * 60 * 1000);
      let expiresAt: Date;

      if (offerExpiryTimestamp) {
        const providerExpiry = new Date(offerExpiryTimestamp);
        // Use whichever is sooner: provider expiry or our configured limit
        expiresAt = providerExpiry.getTime() < configuredExpiry.getTime()
          ? providerExpiry
          : configuredExpiry;
      } else {
        expiresAt = configuredExpiry;
      }

      // Validate the expiry date
      if (isNaN(expiresAt.getTime())) {
        return reply.code(400).send({ error: 'Invalid offerExpiryTimestamp' });
      }

      const prisma = getPrisma();
      const session = await prisma.bookingOfferSession.create({
        data: {
          provider,
          providerOfferId,
          offerExpiryTimestamp: expiresAt,
          fallbackExpiryMinutes: offerExpiryTimestamp ? 0 : expiryMinutes,
          searchCriteria: searchCriteria ?? undefined,
          status: computeStatus(expiresAt),
          bookingStartedAt: new Date(),
        },
      });

      const remaining = getRemainingSeconds(expiresAt);




      return reply.send({
        offerSessionId: session.id,
        expiresAt: expiresAt.toISOString(),
        remainingSeconds: remaining,
        status: session.status,
      });
    } catch (err) {
      console.error('[OfferSession] start error:', err);
      reply.code(500).send({ error: 'Failed to start offer session' });
    }
  });

  /**
   * GET /offer-session/:id/status
   * Returns current session status with remaining time.
   */
  fastify.get('/offer-session/:id/status', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const session = await prisma.bookingOfferSession.findUnique({
        where: { id },
      });

      if (!session) {
        return reply.code(404).send({ error: 'Offer session not found' });
      }

      const currentStatus = computeStatus(session.offerExpiryTimestamp);

      // Auto-transition to EXPIRED if time is up
      if (currentStatus === 'EXPIRED' && session.status !== 'EXPIRED' && session.status !== 'BOOKED') {
        await prisma.bookingOfferSession.update({
          where: { id },
          data: { status: 'EXPIRED', expiredAt: new Date() },
        });

      }

      return reply.send({
        offerSessionId: session.id,
        status: session.status === 'BOOKED' ? 'BOOKED' : currentStatus,
        expiresAt: session.offerExpiryTimestamp.toISOString(),
        remainingSeconds: getRemainingSeconds(session.offerExpiryTimestamp),
      });
    } catch (err) {
      console.error('[OfferSession] status error:', err);
      reply.code(500).send({ error: 'Failed to get session status' });
    }
  });

  /**
   * POST /offer-session/:id/expire
   * Explicitly marks a session as expired.
   */
  fastify.post('/offer-session/:id/expire', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const session = await prisma.bookingOfferSession.update({
        where: { id },
        data: {
          status: 'EXPIRED',
          expiredAt: new Date(),
        },
      });



      return reply.send({
        offerSessionId: session.id,
        status: 'EXPIRED',
        expiredAt: session.expiredAt?.toISOString(),
      });
    } catch (err) {
      console.error('[OfferSession] expire error:', err);
      reply.code(500).send({ error: 'Failed to expire session' });
    }
  });

  /**
   * POST /offer-session/:id/booked
   * Marks session as successfully booked (stops countdown).
   */
  fastify.post('/offer-session/:id/booked', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const prisma = getPrisma();

      const session = await prisma.bookingOfferSession.update({
        where: { id },
        data: { status: 'BOOKED' },
      });



      return reply.send({
        offerSessionId: session.id,
        status: 'BOOKED',
      });
    } catch (err) {
      console.error('[OfferSession] booked error:', err);
      reply.code(500).send({ error: 'Failed to mark session as booked' });
    }
  });
};

export default plugin;
