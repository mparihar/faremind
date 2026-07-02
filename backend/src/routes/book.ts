import { FastifyPluginAsync } from 'fastify';
import * as duffelClient from '../services/duffel';
import { createBooking as dbCreateBooking, createPayment, addLedgerEntry, createNotification } from '../lib/db-queries';
import { prisma } from '../lib/db';



const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    try {
      const { providerOfferId, provider, flight, passengers, userId, enablePriceTracking = true, wheelchairSelections } = request.body as any;

      if (!provider || !passengers?.length) return reply.code(400).send({ error: 'Missing required fields: provider, passengers' });
      if (!flight) return reply.code(400).send({ error: 'Missing flight details' });
      const firstPassenger = passengers[0];
      if (!firstPassenger.firstName || !firstPassenger.lastName || !firstPassenger.email) {
        return reply.code(400).send({ error: 'First passenger must have firstName, lastName, and email' });
      }

      if (!providerOfferId) {
        return reply.code(400).send({ error: 'Missing providerOfferId — cannot create booking without a valid provider offer' });
      }

      const isDuffelConfigured = (process.env.DUFFEL_API_TOKEN || '').length > 10;
      if (!isDuffelConfigured) {
        return reply.code(503).send({ error: 'Booking service is not configured. Please contact support.' });
      }

      // Map wheelchair selections to Duffel SSR services
      const wheelchairServices = (wheelchairSelections || [])
        .filter((w: any) => w.code && w.code !== 'NONE')
        .map((w: any, i: number) => ({
          passenger_id: `passenger_${i}`,
          ssr_code: w.code,
        }));

      let providerBookingId: string | undefined;
      let pnr: string;
      const bookingStatus: 'CONFIRMED' | 'PENDING' = 'CONFIRMED';

      if (provider === 'duffel') {
        const order = await duffelClient.createBooking({
          offerId: providerOfferId,
          passengers: passengers.map((p: any, i: number) => ({
            id: `passenger_${i}`, given_name: p.firstName, family_name: p.lastName,
            born_on: p.dateOfBirth, gender: p.gender || 'male', email: p.email,
            phone_number: p.phone || '+10000000000', title: p.gender === 'female' ? 'ms' : 'mr',
            type: p.type || 'adult',
          })),
          paymentAmount: flight.totalPrice, paymentCurrency: flight.currency || 'USD',
          ...(wheelchairServices.length > 0 ? { services: wheelchairServices } : {}),
        });
        providerBookingId = order.id;
        pnr = order.booking_reference;
      } else {
        return reply.code(400).send({ error: `Unsupported provider: ${provider}` });
      }

      const segments = flight.segments || [];
      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];
      const resolvedUserId = userId || 'anonymous';

      let booking;
      try {
        booking = await dbCreateBooking({
          userId: resolvedUserId, provider: provider.toUpperCase() as 'DUFFEL' | 'AMADEUS',
          providerBookingId, providerOfferId, pnr, status: bookingStatus,
          airlineCode: flight.airline?.code || 'XX', airlineName: flight.airline?.name || 'Unknown',
          originAirport: firstSeg?.departure?.airport || '', originCity: firstSeg?.departure?.city || '',
          destinationAirport: lastSeg?.arrival?.airport || '', destinationCity: lastSeg?.arrival?.city || '',
          departureTime: new Date(firstSeg?.departure?.time || Date.now()),
          arrivalTime: new Date(lastSeg?.arrival?.time || Date.now()),
          totalDuration: flight.totalDuration || 0, stops: flight.stops || 0,
          cabinClass: (flight.cabinClass || 'economy').toUpperCase() as any,
          fareClass: flight.fareClass, totalPrice: flight.totalPrice,
          baseFare: flight.totalPrice * 0.85, taxes: flight.totalPrice * 0.15,
          currency: flight.currency || 'USD', refundable: flight.fareRules?.refundable || false,
          changeable: flight.fareRules?.changeable || false,
          cancellationFee: flight.fareRules?.cancellationFee, changeFee: flight.fareRules?.changeFee,
          carryOnBags: flight.baggage?.carryOn || 1, checkedBags: flight.baggage?.checked || 0,
          priceTracking: enablePriceTracking, flightDataSnapshot: flight,
          passengers: passengers.map((p: any) => ({
            firstName: p.firstName, lastName: p.lastName,
            dateOfBirth: new Date(p.dateOfBirth || '1990-01-01'),
            gender: (p.gender || 'male').toUpperCase() as any,
            email: p.email, phone: p.phone, type: (p.type || 'adult').toUpperCase() as any,
            passportNumber: p.passportNumber, nationality: p.nationality,
          })),
          segments: segments.map((seg: any, i: number) => ({
            segmentOrder: i, depAirport: seg.departure?.airport || '', depAirportName: seg.departure?.airportName,
            depCity: seg.departure?.city, depTime: new Date(seg.departure?.time || Date.now()),
            depTerminal: seg.departure?.terminal, arrAirport: seg.arrival?.airport || '',
            arrAirportName: seg.arrival?.airportName, arrCity: seg.arrival?.city,
            arrTime: new Date(seg.arrival?.time || Date.now()), arrTerminal: seg.arrival?.terminal,
            airlineCode: seg.airline?.code || '', airlineName: seg.airline?.name,
            flightNumber: seg.flightNumber || '', duration: seg.duration || 0,
            aircraft: seg.aircraft, operatingCarrier: seg.operatingCarrier?.code,
          })),
        });

        await createPayment({ bookingId: booking.id, type: 'BOOKING', amount: flight.totalPrice, currency: flight.currency || 'USD', description: `Flight booking ${pnr}` }).catch(() => {});

        if (enablePriceTracking) {
          await prisma.priceTrackingJob.create({
            data: {
              bookingId: booking.id, origin: firstSeg?.departure?.airport || '', destination: lastSeg?.arrival?.airport || '',
              departureDate: new Date(firstSeg?.departure?.time || Date.now()),
              cabinClass: (flight.cabinClass || 'economy').toUpperCase() as any,
              bookedPrice: flight.totalPrice, currency: flight.currency || 'USD',
              threshold: 0.05, status: 'ACTIVE', nextRunAt: new Date(Date.now() + 4 * 3600000),
            },
          }).catch(() => {});
        }

        await addLedgerEntry({ type: 'BOOKING_PAYMENT', bookingId: booking.id, amount: flight.totalPrice, currency: flight.currency || 'USD', description: `Booking ${pnr}` }).catch(() => {});
        await createNotification({ userId: resolvedUserId, bookingId: booking.id, type: 'BOOKING_CONFIRMATION', channel: 'IN_APP', title: `Booking Confirmed`, body: `PNR: ${pnr}. Price tracking ${enablePriceTracking ? 'enabled' : 'disabled'}.` }).catch(() => {});

        // NOTE: Email notifications (BOOKING_CONFIRMED + PAYMENT_SUCCESS) are NOT sent here.
        // The checkout flow (checkout.ts POST /notifications/booking-confirm) handles
        // customer email with the correct FAREMIND booking reference.
        // Previously this route sent duplicate emails using the Airline PNR as the
        // Faremind reference, which was incorrect.
      } catch (dbError) {
        console.error('[Booking] DB error:', dbError);
        booking = { id: `temp-${Date.now()}`, pnr, status: bookingStatus };
      }

      return {
        booking: { id: booking.id, pnr, status: bookingStatus.toLowerCase(), provider, providerBookingId: providerBookingId || null, priceTracking: enablePriceTracking, bookedAt: new Date().toISOString() },
        success: true, message: `Booking confirmed! PNR: ${pnr}`,
      };
    } catch (error) {
      console.error('[Booking] Critical error:', error);
      reply.code(500).send({ error: 'Failed to process booking', success: false });
    }
  });
};

export default plugin;
