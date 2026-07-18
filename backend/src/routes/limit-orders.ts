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
import {
  validateTravelBookingWindow,
  computeExpiresAt,
  computePurgeAt,
  buildPolicySnapshot,
  isOrderExpired,
  DEFAULT_TRAVEL_WINDOW_DAYS,
  DEFAULT_VALIDITY_DAYS,
  DEFAULT_PURGE_DELAY_HOURS,
  DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS,
} from '../services/limit-order-validator';

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

      // ── Travel Booking Window (180-day) validation ──
      const travelValidation = validateTravelBookingWindow(depDate);
      if (!travelValidation.valid) {
        return reply.code(400).send({
          error: travelValidation.message,
          code: travelValidation.code,
          maximumAllowedDepartureDate: travelValidation.maximumAllowedDepartureDate,
        });
      }

      // ── Fixed 90-day validity — no user override ──
      const now = new Date();
      const expiresAt = computeExpiresAt(now, DEFAULT_VALIDITY_DAYS);
      const purgeAt = computePurgeAt(expiresAt, DEFAULT_PURGE_DELAY_HOURS);
      const policySnapshot = buildPolicySnapshot();

      // Validate auto-purchase requires payment method
      const execMode = body.executionMode || 'NOTIFY_ONLY';
      if (execMode === 'AUTO_PURCHASE') {
        if (!body.stripeCustomerId || !body.stripePaymentMethodId) {
          return reply.code(400).send({ error: 'Auto-purchase requires stripeCustomerId and stripePaymentMethodId' });
        }
      }

      // Compute initial nextEvaluationAt (1 hour from now for active orders)
      const status = body.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT';
      const nextEval = status === 'ACTIVE' ? new Date(now.getTime() + 60 * 60 * 1000) : null;

      // Build accepted airport arrays — defaults to single origin/destination if not provided
      const primaryOrigin = body.origin.toUpperCase();
      const primaryDest = body.destination.toUpperCase();
      const acceptedOrigins: string[] = (body.acceptedOrigins && body.acceptedOrigins.length > 0)
        ? body.acceptedOrigins.map((c: string) => c.toUpperCase())
        : [primaryOrigin];
      const acceptedDestinations: string[] = (body.acceptedDestinations && body.acceptedDestinations.length > 0)
        ? body.acceptedDestinations.map((c: string) => c.toUpperCase())
        : [primaryDest];

      const order = await prisma.limitOrder.create({
        data: {
          userId,
          origin: primaryOrigin,
          destination: primaryDest,
          originCity: body.originCity || null,
          destinationCity: body.destinationCity || null,
          acceptedOrigins,
          acceptedDestinations,
          departureDate: depDate,
          returnDate: body.returnDate ? new Date(body.returnDate) : null,
          tripType: body.tripType || 'ONE_WAY',
          adults: body.adults ?? 1,
          children: body.children ?? 0,
          infants: body.infants ?? 0,
          infantsWithSeat: body.infantsWithSeat ?? 0,
          minFare: Number(body.minFare),
          maxFare: Number(body.maxFare),
          currency: body.currency || 'USD',
          maxDurationMinutes: body.maxDurationMinutes ? Number(body.maxDurationMinutes) : null,
          cabinClass: body.cabinClass || 'ECONOMY',
          airlinePreferenceMode: body.airlinePreferenceMode || 'ACCEPT',
          airlinePreferences: body.airlinePreferences || [],
          // Lifecycle — system-enforced
          travelWindowDays: DEFAULT_TRAVEL_WINDOW_DAYS,
          validityDays: DEFAULT_VALIDITY_DAYS,
          expiresAt,
          purgeAt,
          minPurchaseLeadTimeHours: DEFAULT_MIN_PURCHASE_LEAD_TIME_HOURS,
          policySnapshot: policySnapshot as any,
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

      // Create passengers if provided
      if (Array.isArray(body.passengers) && body.passengers.length > 0) {
        await prisma.limitOrderPassenger.createMany({
          data: body.passengers.map((p: any, i: number) => ({
            limitOrderId: order.id,
            passengerOrder: i + 1,
            passengerType: p.passengerType || 'adult',
            infantWithSeat: p.infantWithSeat ?? false,
            firstName: p.firstName,
            middleName: p.middleName || null,
            lastName: p.lastName,
            gender: p.gender || null,
            dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
            email: p.email || null,
            phone: p.phone || null,
            nationality: p.nationality || null,
            passportNumber: p.passportNumber || null,
            passportCountry: p.passportCountry || null,
            passportExpiry: p.passportExpiry ? new Date(p.passportExpiry) : null,
            knownTravelerNumber: p.knownTravelerNumber || null,
            redressNumber: p.redressNumber || null,
            isConfirmed: p.isConfirmed ?? false,
          })),
        });
      }

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
          passengers: { orderBy: { passengerOrder: 'asc' } },
          user: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { matches: true, events: true, passengers: true } },
        },
      });
      if (!order) return reply.code(404).send({ error: 'Limit order not found' });

      // Add lifecycle metadata
      const lifecycle: any = {
        canRenew: false,
        canCreateNew: true,
        renewalAllowed: false,
      };
      if (isOrderExpired(order)) {
        lifecycle.expired = true;
        lifecycle.message = 'This Limit Order has expired. Create a new Limit Order to continue monitoring.';
      } else {
        const daysRemaining = Math.max(0, Math.ceil((new Date(order.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
        lifecycle.expired = false;
        lifecycle.daysRemaining = daysRemaining;
      }

      return { success: true, order, lifecycle };
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

      // Block edits on expired orders
      if (isOrderExpired(existing)) {
        return reply.code(400).send({
          error: 'This Limit Order has expired and cannot be edited. Create a new Limit Order.',
          code: 'LIMIT_ORDER_EXPIRED',
          canRenew: false,
          canCreateNew: true,
        });
      }

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

      // Re-validate 180-day window if departure date changed
      if (body.departureDate) {
        const newDepDate = new Date(body.departureDate);
        const windowCheck = validateTravelBookingWindow(newDepDate);
        if (!windowCheck.valid) {
          return reply.code(400).send({
            error: windowCheck.message,
            code: windowCheck.code,
            maximumAllowedDepartureDate: windowCheck.maximumAllowedDepartureDate,
          });
        }
        updateData.departureDate = newDepDate;
      }

      // NEVER modify expiresAt, createdAt, or validityDays on update

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
      const existing = await prisma.limitOrder.findUnique({
        where: { id },
        include: { passengers: true },
      });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });

      // Block activation of expired orders
      if (isOrderExpired(existing)) {
        return reply.code(400).send({
          error: 'This Limit Order has expired and cannot be activated. Create a new Limit Order.',
          code: 'LIMIT_ORDER_EXPIRED',
          canRenew: false,
          canCreateNew: true,
        });
      }

      if (!['DRAFT'].includes(existing.status)) {
        return reply.code(400).send({ error: `Cannot activate an order with status ${existing.status}` });
      }

      // Validate auto-purchase has payment method
      if (existing.executionMode === 'AUTO_PURCHASE' && !existing.stripePaymentMethodId) {
        return reply.code(400).send({ error: 'Auto-purchase orders require a payment method before activation' });
      }

      // Validate auto-purchase passenger details
      if (existing.executionMode === 'AUTO_PURCHASE') {
        const expectedCount = existing.adults + existing.children + existing.infants;
        if (existing.passengers.length < expectedCount) {
          return reply.code(400).send({
            error: `Auto-purchase orders require all ${expectedCount} passenger(s) to be added. Currently have ${existing.passengers.length}.`,
          });
        }
        const unconfirmed = existing.passengers.filter(p => !p.isConfirmed);
        if (unconfirmed.length > 0) {
          return reply.code(400).send({
            error: `All passengers must be confirmed before activation. ${unconfirmed.length} passenger(s) not yet confirmed.`,
          });
        }
        // Validate required fields for each passenger
        const errors: string[] = [];
        for (const pax of existing.passengers) {
          if (!pax.firstName || !pax.lastName) errors.push(`Passenger ${pax.passengerOrder}: missing name`);
          if (!pax.dateOfBirth) errors.push(`Passenger ${pax.passengerOrder}: missing date of birth`);
          if (pax.passengerType === 'adult' && !pax.gender) errors.push(`Passenger ${pax.passengerOrder}: missing gender`);
        }
        if (errors.length > 0) {
          return reply.code(400).send({ error: `Passenger validation failed: ${errors.join('; ')}` });
        }
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

      // Block pausing expired orders
      if (isOrderExpired(existing)) {
        return reply.code(400).send({
          error: 'This Limit Order has expired and cannot be paused.',
          code: 'LIMIT_ORDER_EXPIRED',
        });
      }

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

      // Check if expired while paused — set full expiration metadata
      if (isOrderExpired(existing)) {
        const now = new Date();
        await prisma.limitOrder.update({
          where: { id },
          data: {
            status: 'EXPIRED',
            expiredAt: now,
            purgeAt: computePurgeAt(now),
            nextEvaluationAt: null,
          },
        });
        await prisma.limitOrderEvent.create({
          data: {
            limitOrderId: id,
            eventType: 'EXPIRED',
            eventTitle: 'Limit order expired while paused',
            eventDescription: 'The 90-day validity period ended while the order was paused. Pausing does not extend validity.',
            actorType: 'system',
          },
        });
        return reply.code(400).send({
          error: 'This Limit Order expired while paused. Pausing does not extend validity. Create a new Limit Order.',
          code: 'LIMIT_ORDER_EXPIRED',
          canRenew: false,
          canCreateNew: true,
        });
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

  // ── SAVED TRAVELERS ────────────────────────────────────────────────────────
  fastify.get('/:id/saved-travelers', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const order = await prisma.limitOrder.findUnique({ where: { id }, select: { userId: true } });
      if (!order) return reply.code(404).send({ error: 'Limit order not found' });

      // Get unique travelers from previous bookings
      const rawPassengers = await prisma.bookingPassenger.findMany({
        where: {
          booking: { userId: order.userId },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Deduplicate by firstName+lastName (case-insensitive)
      const seen = new Set<string>();
      const travelers = [];
      for (const p of rawPassengers) {
        const key = `${p.firstName.toLowerCase()}_${p.lastName.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        travelers.push({
          id: p.id,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          email: p.email,
          phone: p.phone,
          gender: p.gender,
          dateOfBirth: p.dateOfBirth,
          nationality: p.nationality,
          passportNumber: p.passportNumber,
          passportCountry: p.passportCountry,
          passportExpiry: p.passportExpiry,
          passengerType: p.passengerType,
        });
      }

      // Also include the user's own profile as a traveler option
      const user = await prisma.user.findUnique({
        where: { id: order.userId },
        select: { firstName: true, lastName: true, email: true, phone: true },
      });
      if (user) {
        const userKey = `${user.firstName.toLowerCase()}_${user.lastName.toLowerCase()}`;
        if (!seen.has(userKey)) {
          travelers.unshift({
            id: 'user-profile',
            firstName: user.firstName,
            middleName: null,
            lastName: user.lastName,
            email: user.email,
            phone: user.phone,
            gender: null,
            dateOfBirth: null,
            nationality: null,
            passportNumber: null,
            passportCountry: null,
            passportExpiry: null,
            passengerType: 'adult',
          });
        }
      }

      return { success: true, travelers };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET /:id/saved-travelers failed');
      reply.code(500).send({ error: err.message || 'Failed to get saved travelers' });
    }
  });

  // ── MANAGE PASSENGERS ──────────────────────────────────────────────────────
  fastify.post('/:id/passengers', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as any;
      const existing = await prisma.limitOrder.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'Limit order not found' });

      if (!Array.isArray(body.passengers) || body.passengers.length === 0) {
        return reply.code(400).send({ error: 'passengers array is required' });
      }

      // Delete existing passengers and replace
      await prisma.limitOrderPassenger.deleteMany({ where: { limitOrderId: id } });

      const created = await prisma.limitOrderPassenger.createMany({
        data: body.passengers.map((p: any, i: number) => ({
          limitOrderId: id,
          passengerOrder: i + 1,
          passengerType: p.passengerType || 'adult',
          infantWithSeat: p.infantWithSeat ?? false,
          firstName: p.firstName,
          middleName: p.middleName || null,
          lastName: p.lastName,
          gender: p.gender || null,
          dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
          email: p.email || null,
          phone: p.phone || null,
          nationality: p.nationality || null,
          passportNumber: p.passportNumber || null,
          passportCountry: p.passportCountry || null,
          passportExpiry: p.passportExpiry ? new Date(p.passportExpiry) : null,
          knownTravelerNumber: p.knownTravelerNumber || null,
          redressNumber: p.redressNumber || null,
          isConfirmed: p.isConfirmed ?? false,
        })),
      });

      await prisma.limitOrderEvent.create({
        data: {
          limitOrderId: id,
          eventType: 'UPDATED',
          eventTitle: 'Passenger details updated',
          eventDescription: `${body.passengers.length} passenger(s) saved.`,
          actorType: body.actorType || 'customer',
        },
      });

      const passengers = await prisma.limitOrderPassenger.findMany({
        where: { limitOrderId: id },
        orderBy: { passengerOrder: 'asc' },
      });

      return { success: true, passengers };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] POST /:id/passengers failed');
      reply.code(500).send({ error: err.message || 'Failed to save passengers' });
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

  // ── ADMIN: Notification Config ──────────────────────────────────────────────
  fastify.get('/admin/notification-config', async (request, reply) => {
    try {
      const configRow = await prisma.systemConfig.findUnique({
        where: { key: 'sms_notification_config' },
      });
      return { success: true, value: configRow?.value || null };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] GET /admin/notification-config failed');
      reply.code(500).send({ error: err.message || 'Failed to get notification config' });
    }
  });

  fastify.put('/admin/notification-config', async (request, reply) => {
    try {
      const body = request.body as any;
      if (!body.value) return reply.code(400).send({ error: 'value is required' });

      await prisma.systemConfig.upsert({
        where: { key: 'sms_notification_config' },
        update: {
          value: body.value,
          description: body.description || 'SMS notification configuration',
          updatedBy: body.updatedBy || 'admin',
        },
        create: {
          key: 'sms_notification_config',
          value: body.value,
          description: body.description || 'SMS notification configuration',
          updatedBy: body.updatedBy || 'admin',
        },
      });

      return { success: true };
    } catch (err: any) {
      fastify.log.error(err, '[limit-orders] PUT /admin/notification-config failed');
      reply.code(500).send({ error: err.message || 'Failed to save notification config' });
    }
  });
};

export default plugin;
