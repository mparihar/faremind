/**
 * Limit Orders — CRUD API
 *
 * Prefix: /api/limit-orders
 *
 * Provides full lifecycle management for customer limit orders:
 * create, list, get, update, activate, pause, resume, cancel,
 * payment authorization, and audit trail.
 */
import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/db';
import crypto from 'crypto';

const plugin: FastifyPluginAsync = async (fastify) => {

  // ── CREATE ──────────────────────────────────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    try {
      const body = request.body as any;
      const { userId } = body;
      if (!userId) return reply.code(400).send({ error: 'userId is required' });

      // Validate required fields
      const required = ['origin', 'destination', 'departureDate', 'minFare', 'maxFare'];
      for (const field of required) {
        if (!body[field]) return reply.code(400).send({ error: `${field} is required` });
      }

      if (body.origin.length !== 3 || body.destination.length !== 3) {
        return reply.code(400).send({ error: 'origin and destination must be 3-letter IATA codes' });
      }
      if (Number(body.minFare) > Number(body.maxFare)) {
        return reply.code(400).send({ error: 'minFare cannot exceed maxFare' });
      }

      const depDate = new Date(body.departureDate);
      if (depDate <= new Date()) {
        return reply.code(400).send({ error: 'departureDate must be in the future' });
      }

      // Compute expiration
      let expiresAt: Date | null = null;
      if (body.expirationDays) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + Number(body.expirationDays));
      } else {
        // Default: expire at departure date
        expiresAt = depDate;
      }

      // Validate auto-purchase requires payment method
      const execMode = body.executionMode || 'NOTIFY_ONLY';
      if (execMode === 'AUTO_PURCHASE') {
        if (!body.stripeCustomerId || !body.stripePaymentMethodId) {
          return reply.code(400).send({ error: 'Auto-purchase requires stripeCustomerId and stripePaymentMethodId' });
        }
      }

      // Compute initial nextEvaluationAt (1 hour from now for active orders)
      const status = body.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT';
      const now = new Date();
      const nextEval = status === 'ACTIVE' ? new Date(now.getTime() + 60 * 60 * 1000) : null;

      const order = await prisma.limitOrder.create({
        data: {
          userId,
          origin: body.origin.toUpperCase(),
          destination: body.destination.toUpperCase(),
          departureDate: depDate,
          returnDate: body.returnDate ? new Date(body.returnDate) : null,
          tripType: body.tripType || 'ONE_WAY',
          adults: body.adults ?? 1,
          children: body.children ?? 0,
          infants: body.infants ?? 0,
          minFare: Number(body.minFare),
          maxFare: Number(body.maxFare),
          currency: body.currency || 'USD',
          maxDurationMinutes: body.maxDurationMinutes ? Number(body.maxDurationMinutes) : null,
          cabinClass: body.cabinClass || 'ECONOMY',
          airlinePreferenceMode: body.airlinePreferenceMode || 'ACCEPT',
          airlinePreferences: body.airlinePreferences || [],
          bookingWindowDays: body.bookingWindowDays ?? 30,
          expirationDays: body.expirationDays ? Number(body.expirationDays) : null,
          expiresAt,
          executionMode: execMode,
          status,
          stripeCustomerId: body.stripeCustomerId || null,
          stripePaymentMethodId: body.stripePaymentMethodId || null,
          cardBrand: body.cardBrand || null,
          cardLast4: body.cardLast4 || null,
          paymentAuthorizedAt: body.stripePaymentMethodId ? now : null,
          nextEvaluationAt: nextEval,
          createdByRole: body.createdByRole || 'CUSTOMER',
          agentUserId: body.agentUserId || null,
          agentName: body.agentName || null,
        },
      });

      // Create audit event
      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: order.id,
          eventType: 'CREATED',
          eventTitle: 'Limit order created',
          eventDescription: `${order.origin} → ${order.destination} | $${order.minFare}–$${order.maxFare} | ${order.cabinClass} | ${order.executionMode}`,
          actorType: body.createdByRole === 'AGENT' ? 'agent' : 'customer',
          actorId: body.createdByRole === 'AGENT' ? body.agentUserId : userId,
        },
      });

      if (status === 'ACTIVE') {
        await prisma.limitOrderEvent.create({
          data: {
            limitOrderId: order.id,
            eventType: 'ACTIVATED',
            eventTitle: 'Limit order activated',
            eventDescription: 'Order is now being monitored.',
            actorType: 'system',
          },
        });
      }

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST / failed');
      reply.code(500).send({ error: err.message || 'Failed to create limit order' });
    }
  });

  // ── LIST ────────────────────────────────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    try {
      const q = request.query as Record<string, string>;
      const userId = q.userId;
      const status = q.status;
      const page = Math.max(1, parseInt(q.page || '1'));
      const limit = Math.min(50, Math.max(1, parseInt(q.limit || '20')));
      const skip = (page - 1) * limit;

      const where: any = {};
      if (userId) where.userId = userId;
      if (status) where.status = status;

      // Agent search by customer email
      if (q.customerEmail) {
        const user = await prisma.user.findUnique({ where: { email: q.customerEmail.toLowerCase() }, select: { id: true } });
        if (user) where.userId = user.id;
        else return { success: true, orders: [], total: 0, page, limit };
      }

      // Route filter
      if (q.origin) where.origin = q.origin.toUpperCase();
      if (q.destination) where.destination = q.destination.toUpperCase();

      const [orders, total] = await Promise.all([
        prisma.limitOrder.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            _count: { select: { matches: true } },
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        }),
        prisma.limitOrder.count({ where }),
      ]);

      return { success: true, orders, total, page, limit };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET / failed');
      reply.code(500).send({ error: err.message || 'Failed to list limit orders' });
    }
  });

  // ── GET SINGLE ──────────────────────────────────────────────────────────────
  fastify.get('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const order = await prisma.limitOrder.findUnique({
        where: { id },
        include: {
          matches: { orderBy: { createdAt: 'desc' }, take: 20 },
          events: { orderBy: { createdAt: 'desc' }, take: 30 },
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { matches: true, events: true } },
        },
      });
      if (!order) return reply.code(404).send({ error: 'Limit order not found' });
      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET /:id failed');
      reply.code(500).send({ error: err.message || 'Failed to get limit order' });
    }
  });

  // ── UPDATE ──────────────────────────────────────────────────────────────────
  fastify.put('/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;

      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });

      // Only allow edits if DRAFT or ACTIVE
      if (!['DRAFT', 'ACTIVE'].includes(existing.status)) {
        return reply.code(400).send({ error: `Cannot edit an order with status ${existing.status}` });
      }

      const updateData: any = {};
      const editableFields = [
        'minFare', 'maxFare', 'maxDurationMinutes', 'cabinClass',
        'airlinePreferenceMode', 'airlinePreferences',
        'bookingWindowDays', 'expirationDays', 'executionMode',
        'adults', 'children', 'infants',
      ];

      for (const field of editableFields) {
        if (body[field] !== undefined) {
          if (['minFare', 'maxFare'].includes(field)) {
            updateData[field] = Number(body[field]);
          } else if (field === 'maxDurationMinutes') {
            updateData[field] = body[field] ? Number(body[field]) : null;
          } else {
            updateData[field] = body[field];
          }
        }
      }

      // Recompute expiration if expirationDays changed
      if (body.expirationDays !== undefined) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + Number(body.expirationDays));
        updateData.expiresAt = expiresAt;
      }

      const order = await prisma.limitOrder.update({ where: { id }, data: updateData });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'UPDATED',
          eventTitle: 'Limit order updated',
          eventDescription: `Fields updated: ${Object.keys(updateData).join(', ')}`,
          actorType: body.actorType || 'customer',
          actorId: body.actorId,
          payloadJson: updateData,
        },
      });

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] PUT /:id failed');
      reply.code(500).send({ error: err.message || 'Failed to update limit order' });
    }
  });

  // ── ACTIVATE ────────────────────────────────────────────────────────────────
  fastify.post('/:id/activate', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });
      if (!['DRAFT'].includes(existing.status)) {
        return reply.code(400).send({ error: `Cannot activate an order with status ${existing.status}` });
      }

      // Validate auto-purchase has payment method
      if (existing.executionMode === 'AUTO_PURCHASE' && !existing.stripePaymentMethodId) {
        return reply.code(400).send({ error: 'Auto-purchase orders require a payment method before activation' });
      }

      const now = new Date();
      const order = await prisma.limitOrder.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          nextEvaluationAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'ACTIVATED',
          eventTitle: 'Limit order activated',
          eventDescription: 'Order is now being monitored for matching flights.',
          actorType: 'customer',
        },
      });

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST /:id/activate failed');
      reply.code(500).send({ error: err.message || 'Failed to activate limit order' });
    }
  });

  // ── PAUSE ───────────────────────────────────────────────────────────────────
  fastify.post('/:id/pause', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });
      if (!['ACTIVE', 'MONITORING', 'MATCHED', 'AWAITING_CUSTOMER'].includes(existing.status)) {
        return reply.code(400).send({ error: `Cannot pause an order with status ${existing.status}` });
      }

      const order = await prisma.limitOrder.update({
        where: { id },
        data: { status: 'DRAFT', pausedAt: new Date(), nextEvaluationAt: null },
      });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'PAUSED',
          eventTitle: 'Limit order paused',
          eventDescription: body?.reason || 'Order monitoring paused by user.',
          actorType: body?.actorType || 'customer',
          actorId: body?.actorId,
        },
      });

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST /:id/pause failed');
      reply.code(500).send({ error: err.message || 'Failed to pause limit order' });
    }
  });

  // ── RESUME ──────────────────────────────────────────────────────────────────
  fastify.post('/:id/resume', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });
      if (existing.status !== 'DRAFT') {
        return reply.code(400).send({ error: `Cannot resume an order with status ${existing.status}. Only paused (DRAFT) orders can be resumed.` });
      }

      // Check if expired while paused
      if (existing.expiresAt && existing.expiresAt < new Date()) {
        await prisma.limitOrder.update({ where: { id }, data: { status: 'EXPIRED' } });
        return reply.code(400).send({ error: 'This order has expired while paused.' });
      }

      const now = new Date();
      const order = await prisma.limitOrder.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          pausedAt: null,
          nextEvaluationAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'RESUMED',
          eventTitle: 'Limit order resumed',
          eventDescription: 'Order monitoring resumed.',
          actorType: body?.actorType || 'customer',
          actorId: body?.actorId,
        },
      });

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST /:id/resume failed');
      reply.code(500).send({ error: err.message || 'Failed to resume limit order' });
    }
  });

  // ── CANCEL ──────────────────────────────────────────────────────────────────
  fastify.post('/:id/cancel', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });
      if (['BOOKED', 'CANCELLED'].includes(existing.status)) {
        return reply.code(400).send({ error: `Cannot cancel an order with status ${existing.status}` });
      }

      const order = await prisma.limitOrder.update({
        where: { id },
        data: { status: 'CANCELLED', nextEvaluationAt: null },
      });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'CANCELLED',
          eventTitle: 'Limit order cancelled',
          eventDescription: body?.reason || 'Order cancelled by user.',
          actorType: body?.actorType || 'customer',
          actorId: body?.actorId,
        },
      });

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST /:id/cancel failed');
      reply.code(500).send({ error: err.message || 'Failed to cancel limit order' });
    }
  });

  // ── MATCHES ─────────────────────────────────────────────────────────────────
  fastify.get('/:id/matches', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const q = request.query as Record<string, string>;
      const page = Math.max(1, parseInt(q.page || '1'));
      const limit = Math.min(50, Math.max(1, parseInt(q.limit || '20')));

      const [matches, total] = await Promise.all([
        prisma.limitOrderMatch.findMany({
          where: { limitOrderId: id },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.limitOrderMatch.count({ where: { limitOrderId: id } }),
      ]);

      return { success: true, matches, total, page, limit };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET /:id/matches failed');
      reply.code(500).send({ error: err.message || 'Failed to get matches' });
    }
  });

  // ── EVENTS ──────────────────────────────────────────────────────────────────
  fastify.get('/:id/events', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const q = request.query as Record<string, string>;
      const page = Math.max(1, parseInt(q.page || '1'));
      const limit = Math.min(50, Math.max(1, parseInt(q.limit || '30')));

      const [events, total] = await Promise.all([
        prisma.limitOrderEvent.findMany({
          where: { limitOrderId: id },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.limitOrderEvent.count({ where: { limitOrderId: id } }),
      ]);

      return { success: true, events, total, page, limit };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET /:id/events failed');
      reply.code(500).send({ error: err.message || 'Failed to get events' });
    }
  });

  // ── AUTHORIZE PAYMENT ───────────────────────────────────────────────────────
  fastify.post('/:id/authorize-payment', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const { stripeCustomerId, stripePaymentMethodId, cardBrand, cardLast4 } = body;

      if (!stripeCustomerId || !stripePaymentMethodId) {
        return reply.code(400).send({ error: 'stripeCustomerId and stripePaymentMethodId are required' });
      }

      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });

      const order = await prisma.limitOrder.update({
        where: { id },
        data: {
          stripeCustomerId,
          stripePaymentMethodId,
          cardBrand: cardBrand || null,
          cardLast4: cardLast4 || null,
          paymentAuthorizedAt: new Date(),
          executionMode: 'AUTO_PURCHASE',
        },
      });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'PAYMENT_AUTHORIZED',
          eventTitle: 'Payment method authorized',
          eventDescription: `${cardBrand || 'Card'} ending in ${cardLast4 || '****'} authorized for auto-purchase.`,
          actorType: 'customer',
          actorId: existing.userId,
        },
      });

      return { success: true, order };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST /:id/authorize-payment failed');
      reply.code(500).send({ error: err.message || 'Failed to authorize payment' });
    }
  });

  // ── ADMIN: Stats ────────────────────────────────────────────────────────────
  fastify.get('/admin/stats', async (request, reply) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const [
        activeCount,
        triggeredToday,
        autoBookedToday,
        notifyOnlyToday,
        failedCount,
        totalOrders,
        supportTicketsToday,
      ] = await Promise.all([
        prisma.limitOrder.count({ where: { status: { in: ['ACTIVE', 'MONITORING'] } } }),
        prisma.limitOrderMatch.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.limitOrderMatch.count({ where: { action: 'AUTO_PURCHASED', createdAt: { gte: todayStart } } }),
        prisma.limitOrderMatch.count({ where: { action: 'NOTIFIED', createdAt: { gte: todayStart } } }),
        prisma.limitOrder.count({ where: { status: { in: ['FAILED', 'SUPPORT_REQUIRED'] } } }),
        prisma.limitOrder.count(),
        prisma.limitOrderMatch.count({ where: { supportTicketId: { not: null }, createdAt: { gte: todayStart } } }),
      ]);

      // Live search reuse rate — matches from LIVE_SEARCH vs SCHEDULER
      const [liveSearchMatches, schedulerMatches] = await Promise.all([
        prisma.limitOrderMatch.count({ where: { matchSource: 'LIVE_SEARCH' } }),
        prisma.limitOrderMatch.count({ where: { matchSource: 'SCHEDULER' } }),
      ]);
      const totalMatches = liveSearchMatches + schedulerMatches;
      const liveSearchReuseRate = totalMatches > 0 ? Math.round((liveSearchMatches / totalMatches) * 100) : 0;

      // Auto-purchase success rate
      const [autoPurchaseSuccess, autoPurchaseTotal] = await Promise.all([
        prisma.limitOrderMatch.count({ where: { action: 'AUTO_PURCHASED' } }),
        prisma.limitOrderMatch.count({ where: { action: { in: ['AUTO_PURCHASED', 'SKIPPED'] } } }),
      ]);
      const autoPurchaseSuccessRate = autoPurchaseTotal > 0 ? Math.round((autoPurchaseSuccess / autoPurchaseTotal) * 100) : 0;

      return {
        success: true,
        stats: {
          activeOrders: activeCount,
          triggeredToday,
          autoBookedToday,
          notifyOnlyToday,
          failedOrders: failedCount,
          totalOrders,
          supportTicketsToday,
          liveSearchReuseRate,
          autoPurchaseSuccessRate,
          liveSearchMatches,
          schedulerMatches,
        },
      };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET /admin/stats failed');
      reply.code(500).send({ error: err.message || 'Failed to get stats' });
    }
  });
};

export default plugin;
