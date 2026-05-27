import { NextRequest, NextResponse } from 'next/server';
import * as duffelClient from '@/lib/providers/duffel';
import * as amadeusClient from '@/lib/providers/amadeus';
import { getBookingById, updateBookingStatus, createNotification, addLedgerEntry } from '@/lib/db-queries';
import prisma from '@/lib/db';
import { fireNotification } from '@/lib/notify';

/**
 * POST /api/cancel
 *
 * Cancellation flow:
 * 1. Retrieve booking from database
 * 2. Cancel with provider (Duffel/Amadeus)
 * 3. Update booking status to CANCELLED
 * 4. Deactivate price tracking
 * 5. Record ledger entry
 * 6. Send cancellation notification
 */
export async function POST(request: NextRequest) {
  try {
    const { bookingId } = await request.json();

    if (!bookingId) {
      return NextResponse.json(
        { error: 'bookingId is required' },
        { status: 400 }
      );
    }

    // Get booking details
    const booking = await getBookingById(bookingId);
    if (!booking) {
      return NextResponse.json(
        { error: 'Booking not found' },
        { status: 404 }
      );
    }

    if (booking.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Booking is already cancelled' },
        { status: 400 }
      );
    }

    let providerCancelled = false;
    let refundAmount = 0;

    // Cancel with provider
    if (booking.providerBookingId) {
      try {
        if (booking.provider === 'DUFFEL') {
          const result = await duffelClient.cancelBooking(booking.providerBookingId);
          providerCancelled = true;
          refundAmount = parseFloat(result.cancellation.refund_amount || '0');
        } else if (booking.provider === 'AMADEUS') {
          await amadeusClient.cancelBooking(booking.providerBookingId);
          providerCancelled = true;
          // Amadeus doesn't return refund in DELETE response
          const cancellationFee = Number(booking.cancellationFee || 0);
          refundAmount = Number(booking.totalPrice) - cancellationFee;
        }
      } catch (error) {
        console.error(`[Cancel] Provider cancellation failed:`, error);
        // Continue with local cancellation even if provider fails
      }
    }

    // Update booking status
    await updateBookingStatus(bookingId, 'CANCELLED');

    // Deactivate price tracking
    await prisma.priceTrackingJob.updateMany({
      where: { bookingId },
      data: { status: 'CANCELLED' },
    }).catch(() => {});

    // Ledger entry for refund
    if (refundAmount > 0) {
      await addLedgerEntry({
        type: 'CANCELLATION_REFUND',
        bookingId,
        amount: -refundAmount, // Negative for refunds
        currency: booking.currency,
        description: `Cancellation refund for ${booking.pnr}`,
      }).catch(() => {});
    }

    // In-app notification
    if (booking.userId) {
      await createNotification({
        userId: booking.userId,
        bookingId,
        type: 'BOOKING_CANCELLATION',
        channel: 'IN_APP',
        title: 'Booking Cancelled',
        body: `Your ${booking.airlineName} flight ${booking.originAirport} → ${booking.destinationAirport} (PNR: ${booking.pnr}) has been cancelled.${refundAmount > 0 ? ` Refund: $${refundAmount.toFixed(2)}` : ''}`,
      }).catch(() => {});
    }

    // Email notification
    const primaryPax = booking.passengers?.[0];
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

    return NextResponse.json({
      success: true,
      bookingId,
      pnr: booking.pnr,
      status: 'cancelled',
      providerCancelled,
      refundAmount,
      message: `Booking ${booking.pnr} cancelled${refundAmount > 0 ? `. Refund: $${refundAmount.toFixed(2)}` : ''}`,
    });
  } catch (error) {
    console.error('[Cancel] Critical error:', error);
    return NextResponse.json(
      { error: 'Cancellation failed' },
      { status: 500 }
    );
  }
}
