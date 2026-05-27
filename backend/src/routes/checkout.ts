import { FastifyPluginAsync } from 'fastify';
import { fireNotification } from '../lib/notify';

interface PassengerInfo {
  id?: string; firstName: string; lastName: string; email?: string;
  dateOfBirth?: string; passportNumber?: string; nationality?: string;
  type?: 'adult' | 'child' | 'infant';
}

interface PassengerPricing {
  id: string; type: 'adult' | 'child' | 'infant';
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/passengers/save', async (request, reply) => {
    try {
      const { sessionId, passengers } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (!Array.isArray(passengers) || passengers.length === 0) return reply.code(400).send({ error: 'passengers must be a non-empty array' });
      for (const p of passengers as PassengerInfo[]) {
        if (!p.firstName || !p.lastName) return reply.code(400).send({ error: 'Each passenger must have firstName and lastName' });
      }
      return { success: true, sessionId };
    } catch (err) {
      console.error('[checkout] POST /passengers/save error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.get('/seats/map', async (request, reply) => {
    try {
      const { origin, destination, flightNumber } = request.query as Record<string, string>;
      if (!origin || !destination || !flightNumber) return reply.code(400).send({ error: 'origin, destination, and flightNumber are required' });

      const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
      const seatTypes: Record<string, 'window' | 'middle' | 'aisle'> = { A: 'window', B: 'middle', C: 'aisle', D: 'aisle', E: 'middle', F: 'window' };

      const rows = [];
      for (let row = 1; row <= 30; row++) {
        let priceUsd = 0;
        if (row <= 5) priceUsd = 25;
        else if (row <= 10) priceUsd = 15;
        rows.push({ row, seats: seatLetters.map((letter) => ({ seat: `${row}${letter}`, available: Math.random() > 0.3, type: seatTypes[letter], priceUsd })) });
      }

      return { cabin: 'economy', rows };
    } catch (err) {
      console.error('[checkout] GET /seats/map error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/seats/select', async (request, reply) => {
    try {
      const { sessionId, selections } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (!Array.isArray(selections)) return reply.code(400).send({ error: 'selections must be an array' });
      return { success: true, selections };
    } catch (err) {
      console.error('[checkout] POST /seats/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/meals/select', async (request, reply) => {
    try {
      const { sessionId, meals } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (!Array.isArray(meals)) return reply.code(400).send({ error: 'meals must be an array' });
      return { success: true };
    } catch (err) {
      console.error('[checkout] POST /meals/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/baggage/select', async (request, reply) => {
    try {
      const { sessionId, extraBags } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      if (typeof extraBags !== 'number' || extraBags < 0) return reply.code(400).send({ error: 'extraBags must be a non-negative number' });
      return { success: true, extraBags, baggageFee: extraBags * 35 };
    } catch (err) {
      console.error('[checkout] POST /baggage/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/protection/select', async (request, reply) => {
    try {
      const { sessionId, travelInsurance, totalFare } = request.body as any;
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      const insuranceFee = travelInsurance && totalFare ? Math.round(totalFare * 0.04) : 0;
      return { success: true, protectionFee: 0, insuranceFee };
    } catch (err) {
      console.error('[checkout] POST /protection/select error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/pricing/recalculate', async (request, reply) => {
    try {
      const { selectedFare, passengers, extraBags, priceProtection, travelInsurance, seatSelections, currency } = request.body as any;
      if (!selectedFare || !Array.isArray(passengers) || passengers.length === 0) return reply.code(400).send({ error: 'selectedFare and passengers are required' });

      const taxRate = 0.156;
      const perPersonBase: number = selectedFare.basePrice ?? 0;

      const perPassenger = (passengers as PassengerPricing[]).map((pax, idx) => {
        const effectiveBase = pax.type === 'child' ? perPersonBase * 0.75 : perPersonBase;
        return {
          passengerId: pax.id ?? `pax_${idx}`,
          type: pax.type ?? 'adult',
          baseFare: Math.round(effectiveBase * (1 - taxRate)),
          taxes: Math.round(effectiveBase * taxRate),
          subtotal: Math.round(effectiveBase),
        };
      });

      const seatFees: number = Array.isArray(seatSelections) ? (seatSelections as { priceUsd: number }[]).reduce((sum, s) => sum + (s.priceUsd ?? 0), 0) : 0;
      const baggageFees: number = typeof extraBags === 'number' && extraBags > 0 ? extraBags * 35 : 0;
      const protectionFee: number = priceProtection ? (selectedFare.protectionFee ?? 0) : 0;
      const insuranceFee: number = travelInsurance ? Math.round((selectedFare.totalPrice ?? 0) * 0.04) : 0;
      const serviceFee: number = Math.round((selectedFare.totalPrice ?? 0) * 0.015);
      const passengerSubtotal = perPassenger.reduce((sum, p) => sum + p.subtotal, 0);
      const subtotal = passengerSubtotal + seatFees + baggageFees + protectionFee + insuranceFee + serviceFee;

      return { perPassenger, seatFees, mealFees: 0, baggageFees, protectionFee, insuranceFee, serviceFee, subtotal, total: subtotal, currency: currency ?? 'USD' };
    } catch (err) {
      console.error('[checkout] POST /pricing/recalculate error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/payment/create-intent', async (request, reply) => {
    try {
      const { amount, currency } = request.body as any;
      if (typeof amount !== 'number' || amount <= 0) return reply.code(400).send({ error: 'amount must be a positive number' });
      if (!currency) return reply.code(400).send({ error: 'currency is required' });
      const now = Date.now();
      return { clientSecret: `mock_pi_${now}_secret_mock`, paymentIntentId: `pi_${now}_mock`, amount, currency };
    } catch (err) {
      console.error('[checkout] POST /payment/create-intent error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/payment/confirm', async (request, reply) => {
    try {
      const { paymentIntentId, sessionId, amount, currency } = request.body as any;
      if (!paymentIntentId) return reply.code(400).send({ error: 'paymentIntentId is required' });
      if (!sessionId) return reply.code(400).send({ error: 'sessionId is required' });
      return { success: true, status: 'succeeded', chargedAmount: amount ?? 0, currency: currency ?? 'USD' };
    } catch (err) {
      console.error('[checkout] POST /payment/confirm error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/bookings/confirm', async (request, reply) => {
    try {
      const { paymentIntentId, sessionId, passengers, pricing } = request.body as any;
      if (!paymentIntentId || !sessionId) return reply.code(400).send({ error: 'paymentIntentId and sessionId are required' });
      if (!Array.isArray(passengers) || passengers.length === 0) return reply.code(400).send({ error: 'passengers must be a non-empty array' });
      if (!pricing) return reply.code(400).send({ error: 'pricing is required' });

      const pnrChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const pnr = `FM${Array.from({ length: 6 }, () => pnrChars[Math.floor(Math.random() * pnrChars.length)]).join('')}`;

      return {
        success: true, pnr,
        bookingId: `bk_${Date.now()}`,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        passengerNames: (passengers as PassengerInfo[]).map((p) => `${p.firstName} ${p.lastName}`),
        totalCharged: pricing.total,
        currency: pricing.currency,
      };
    } catch (err) {
      console.error('[checkout] POST /bookings/confirm error:', err);
      reply.code(500).send({ error: 'Internal server error' });
    }
  });

  fastify.post('/notifications/booking-confirm', async (request, reply) => {
    try {
      const {
        email, pnr, bookingId, paymentIntentId,
        customerName, passengerNames, passengers: passengersDetail,
        total, currency, routeLabel,
        airline, fareClass, last4,
        pricing: pricingInput,
      } = request.body as any;
      // Only pnr is required — customer email can be absent and admin still gets notified
      if (!pnr) return reply.code(400).send({ error: 'pnr is required' });

      // Parse origin / destination from routeLabel (e.g. "DFW ⇄ DEL" or "JFK → LHR")
      const routeParts = (routeLabel ?? '').split(/\s*[⇄→]\s*/);
      const origin      = routeParts[0]?.trim() ?? '';
      const destination = routeParts[1]?.trim() ?? '';

      const cur = currency ?? 'USD';
      const fmt = (n: number) => new Intl.NumberFormat('en-US', {
        style: 'currency', currency: cur, maximumFractionDigits: 0,
      }).format(n || 0);

      const totalAmount = fmt(Number(total) || 0);

      const confirmedAt = new Date().toLocaleString('en-US', {
        dateStyle: 'medium', timeStyle: 'short',
      });

      // Build passengers array expected by templates — use full detail if provided
      const passengersArr = Array.isArray(passengersDetail) && passengersDetail.length > 0
        ? passengersDetail
        : (Array.isArray(passengerNames) ? passengerNames : [passengerNames])
            .filter(Boolean)
            .map((name: string) => ({ name, type: 'Adult' }));

      // ── Build structured price breakdown for email templates ──────────────
      const pricePerPassenger = (pricingInput?.perPassenger ?? []).map((p: any, i: number) => ({
        name:  p.name ?? passengersArr[i]?.name ?? `Passenger ${i + 1}`,
        type:  p.type === 'child' ? 'Child' : 'Adult',
        fare:  fmt(Number(p.fare) || 0),
      }));

      const addOns: { label: string; amount: string; highlight?: boolean }[] = [];
      if ((pricingInput?.seatFees      ?? 0) > 0) addOns.push({ label: 'Seat fees',             amount: fmt(pricingInput.seatFees) });
      if ((pricingInput?.mealFees      ?? 0) > 0) addOns.push({ label: 'Meal fees',              amount: fmt(pricingInput.mealFees) });
      if ((pricingInput?.baggageFees   ?? 0) > 0) addOns.push({ label: 'Extra bags',             amount: fmt(pricingInput.baggageFees) });
      if ((pricingInput?.protectionFee ?? 0) > 0) addOns.push({ label: 'Price Drop Protection',  amount: fmt(pricingInput.protectionFee), highlight: true });
      if ((pricingInput?.insuranceFee  ?? 0) > 0) addOns.push({ label: 'Travel insurance',       amount: fmt(pricingInput.insuranceFee) });
      if ((pricingInput?.serviceFee    ?? 0) > 0) addOns.push({ label: 'Service fee',            amount: fmt(pricingInput.serviceFee) });

      const hasPriceBreakdown = pricePerPassenger.length > 0;

      // Fire via direct Brevo — no Python micro-service dependency
      fireNotification({
        event_type: 'BOOKING_CONFIRMED',
        booking_id: bookingId ?? pnr,
        customer_email: email,
        data: {
          booking_reference: pnr,
          pnr,
          provider_booking_id: bookingId ?? pnr,
          customer_name:  customerName ?? passengersArr[0]?.name ?? 'Traveler',
          customer_email: email,
          origin,
          destination,
          route:          routeLabel ?? `${origin} → ${destination}`,
          airline:        airline ?? '',
          fare_class:     fareClass ?? '',
          passengers:     passengersArr,
          total_amount:   totalAmount,
          total_charged:  total,
          currency:       cur,
          card_last4:     `•••• ${last4 ?? '****'}`,
          confirmed_at:   confirmedAt,
          payment_intent_id: paymentIntentId ?? '',
          has_price_breakdown:   hasPriceBreakdown,
          price_per_passenger:   pricePerPassenger,
          price_add_ons:         addOns,
        },
      });

      return { success: true, message: 'Notification queued' };
    } catch (err) {
      fastify.log.error({ err }, '[checkout] POST /notifications/booking-confirm error');
      reply.code(500).send({ error: 'Internal server error' });
    }
  });
};

export default plugin;
