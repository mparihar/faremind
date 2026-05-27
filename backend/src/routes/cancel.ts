import { FastifyPluginAsync } from 'fastify';
import * as duffelClient from '../services/duffel';
import * as amadeusClient from '../services/amadeus';
import { getBookingById, updateBookingStatus, createNotification, addLedgerEntry } from '../lib/db-queries';
import { prisma } from '../lib/db';
import { fireNotification } from '../lib/notify';

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.post('/', async (request, reply) => {
    try {
      const { bookingId } = request.body as { bookingId?: string };
      if (!bookingId) return reply.code(400).send({ error: 'bookingId is required' });

      const booking = await getBookingById(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.status === 'CANCELLED') return reply.code(400).send({ error: 'Booking is already cancelled' });

      let providerCancelled = false;
      let refundAmount = 0;

      if (booking.providerBookingId) {
        try {
          if (booking.provider === 'DUFFEL') {
            const result = await duffelClient.cancelBooking(booking.providerBookingId);
            providerCancelled = true;
            refundAmount = parseFloat(result.cancellation.refund_amount || '0');
          } else if (booking.provider === 'AMADEUS') {
            await amadeusClient.cancelBooking(booking.providerBookingId);
            providerCancelled = true;
            refundAmount = Number(booking.totalPrice) - Number(booking.cancellationFee || 0);
          }
        } catch (error) {
          console.error('[Cancel] Provider cancellation failed:', error);
        }
      }

      await updateBookingStatus(bookingId, 'CANCELLED');
      await prisma.priceTrackingJob.updateMany({ where: { bookingId }, data: { status: 'CANCELLED' } }).catch(() => {});

      if (refundAmount > 0) {
        await addLedgerEntry({ type: 'CANCELLATION_REFUND', bookingId, amount: -refundAmount, currency: booking.currency, description: `Cancellation refund for ${booking.pnr}` }).catch(() => {});
      }

      await createNotification({
        userId: booking.userId ?? '', bookingId, type: 'BOOKING_CANCELLATION', channel: 'IN_APP',
        title: 'Booking Cancelled',
        body: `Your ${booking.airlineName} flight ${booking.originAirport} → ${booking.destinationAirport} (PNR: ${booking.pnr}) has been cancelled.${refundAmount > 0 ? ` Refund: $${refundAmount.toFixed(2)}` : ''}`,
      }).catch(() => {});

      // Email notification
      const primaryPax = (booking as any).passengers?.[0];
      const customerEmail = primaryPax?.email ?? '';
      const customerName = primaryPax ? `${primaryPax.firstName} ${primaryPax.lastName}`.trim() : '';
      fireNotification({
        event_type: 'BOOKING_CANCELLED',
        booking_id: bookingId,
        customer_email: customerEmail || undefined,
        data: {
          booking_reference: booking.pnr,
          pnr: booking.pnr,
          customer_name: customerName,
          customer_email: customerEmail,
          origin: booking.originAirport,
          destination: booking.destinationAirport,
          route: `${booking.originAirport} - ${booking.destinationAirport}`,
          airline: booking.airlineName ?? '',
          cancellation_reason: 'Passenger request',
          refund_amount: refundAmount > 0 ? `$${refundAmount.toFixed(2)}` : 'Non-refundable',
          refund_policy: refundAmount > 0 ? 'Refund will be processed within 5–10 business days' : 'Non-refundable fare',
        },
      });

      return { success: true, bookingId, pnr: booking.pnr, status: 'cancelled', providerCancelled, refundAmount, message: `Booking ${booking.pnr} cancelled${refundAmount > 0 ? `. Refund: $${refundAmount.toFixed(2)}` : ''}` };
    } catch (error) {
      console.error('[Cancel] Critical error:', error);
      reply.code(500).send({ error: 'Cancellation failed' });
    }
  });
};

export default plugin;
