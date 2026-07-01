// FILE: src/app/api/agent/resend-itinerary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { fireNotification } from '@/lib/notify';

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  const body = await req.json();
  const { bookingReference, recipientEmail } = body;

  if (!bookingReference) {
    return NextResponse.json({ error: 'bookingReference is required' }, { status: 400 });
  }

  // Verify ownership & fetch full booking data for itinerary
  const booking = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: bookingReference, agentUserId: agent.id },
    include: {
      journeys: { include: { segments: true }, orderBy: { journeyOrder: 'asc' } },
      passengers: { orderBy: { passengerOrder: 'asc' } },
      seats: true,
      meals: true,
      baggage: true,
      addons: true,
      pnrs: true,
      payments: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });
  }

  const targetEmail = recipientEmail?.trim() || booking.customerEmail;
  const customerName = booking.customerName || 'Traveler';

  // Re-send booking confirmation via the notification system
  try {
    await fireNotification({
      event_type: 'BOOKING_CONFIRMED',
      booking_id: booking.id,
      customer_email: targetEmail || undefined,
      data: {
        booking_reference: booking.masterBookingReference,
        pnr: booking.masterPnr || booking.masterBookingReference,
        airline_pnr: booking.masterPnr || booking.masterBookingReference,
        customer_name: customerName,
        customer_email: targetEmail,
        origin: booking.originAirport,
        destination: booking.destinationAirport,
        route: `${booking.originAirport} - ${booking.destinationAirport}`,
        airline: booking.primaryProvider || 'Unknown',
        total_amount: `$${Number(booking.totalAmount || 0).toLocaleString()}`,
        total_charged: Number(booking.totalAmount || 0),
        currency: booking.currency || 'USD',
        confirmed_at: booking.createdAt
          ? new Date(booking.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
          : '',
        full_booking_data: booking,
        agent_email: agent.email,
        agent_name: agent.name,
      },
    });
    console.log(`[Agent] ✅ Itinerary resent to ${targetEmail} for booking ${bookingReference}`);
  } catch (err) {
    console.error('[Agent] ❌ Resend itinerary failed:', err);
    return NextResponse.json({ error: 'Failed to send itinerary' }, { status: 500 });
  }

  // Log event
  try {
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: 'ITINERARY_RESENT',
        title: 'Itinerary resent by agent',
        description: `Agent ${agent.name} resent itinerary to ${targetEmail}`,
        metadata: { agent: agent.email, recipientEmail: targetEmail },
      },
    });
  } catch {}

  return NextResponse.json({
    success: true,
    sentTo: targetEmail,
    message: `Itinerary confirmation resent to ${targetEmail}`,
  });
});
