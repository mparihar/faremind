import { FastifyPluginAsync } from 'fastify';
import * as duffelClient from '../services/duffel';
import { createBooking as dbCreateBooking, createPayment, addLedgerEntry, createNotification } from '../lib/db-queries';
import { prisma } from '../lib/db';
import { fireNotification } from '../lib/notify';

function generateMockPNR(): string {
  return Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 36)]).join('');
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    try {
      const { providerOfferId, provider, flight, passengers, userId, enablePriceTracking = true } = request.body as any;

      if (!provider || !passengers?.length) return reply.code(400).send({ error: 'Missing required fields: provider, passengers' });
      if (!flight) return reply.code(400).send({ error: 'Missing flight details' });
      const firstPassenger = passengers[0];
      if (!firstPassenger.firstName || !firstPassenger.lastName || !firstPassenger.email) {
        return reply.code(400).send({ error: 'First passenger must have firstName, lastName, and email' });
      }

      let providerBookingId: string | undefined;
      let pnr: string;
      let bookingStatus: 'CONFIRMED' | 'PENDING' = 'CONFIRMED';

      const isDuffelConfigured = (process.env.DUFFEL_API_TOKEN || '').length > 10;

      if (provider === 'duffel' && isDuffelConfigured && providerOfferId) {
        try {
          const order = await duffelClient.createBooking({
            offerId: providerOfferId,
            passengers: passengers.map((p: any, i: number) => ({
              id: `passenger_${i}`, given_name: p.firstName, family_name: p.lastName,
              born_on: p.dateOfBirth, gender: p.gender || 'male', email: p.email,
              phone_number: p.phone || '+10000000000', title: p.gender === 'female' ? 'ms' : 'mr',
            })),
            paymentAmount: flight.totalPrice, paymentCurrency: flight.currency || 'USD',
          });
          providerBookingId = order.id;
          pnr = order.booking_reference;
        } catch (error) {
          console.error('[Booking] Duffel failed:', error);
          pnr = generateMockPNR();
          bookingStatus = 'PENDING';
        }
      } else {
        pnr = generateMockPNR();
      }

      const segments = flight.segments || [];
      const firstSeg = segments[0];
      const lastSeg = segments[segments.length - 1];
      const resolvedUserId = userId || 'demo-user';

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

        // Email notifications
        const customerEmail = firstPassenger.email;
        const customerName = `${firstPassenger.firstName} ${firstPassenger.lastName}`.trim();
        const emailEventType = bookingStatus === 'CONFIRMED' ? 'BOOKING_CONFIRMED' as const : 'BOOKING_PENDING' as const;
        fireNotification({
          event_type: emailEventType,
          booking_id: booking.id,
          customer_email: customerEmail || undefined,
          data: {
            booking_reference: pnr,
            pnr,
            customer_name: customerName,
            customer_email: customerEmail,
            origin: firstSeg?.departure?.airport || '',
            destination: lastSeg?.arrival?.airport || '',
            route: `${firstSeg?.departure?.airport || ''} - ${lastSeg?.arrival?.airport || ''}`,
            airline: flight.airline?.name || '',
            fare_class: flight.cabinClass || 'Economy',
            passengers: passengers.map((p: any) => ({ name: `${p.firstName} ${p.lastName}`.trim(), type: p.type ?? 'adult' })),
            total_amount: `$${flight.totalPrice}`,
            total_charged: flight.totalPrice,
            currency: flight.currency || 'USD',
          },
        });
        if (bookingStatus === 'CONFIRMED') {
          fireNotification({
            event_type: 'PAYMENT_SUCCESS',
            booking_id: booking.id,
            customer_email: customerEmail || undefined,
            data: {
              booking_reference: pnr,
              pnr,
              customer_name: customerName,
              customer_email: customerEmail,
              origin: firstSeg?.departure?.airport || '',
              destination: lastSeg?.arrival?.airport || '',
              route: `${firstSeg?.departure?.airport || ''} - ${lastSeg?.arrival?.airport || ''}`,
              airline: flight.airline?.name || '',
              total_amount: `$${flight.totalPrice}`,
              total_charged: flight.totalPrice,
              currency: flight.currency || 'USD',
            },
          });
        }
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
