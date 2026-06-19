// FILE: src/app/api/agent/resend-itinerary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  const body = await req.json();
  const { bookingReference, recipientEmail } = body;

  if (!bookingReference) {
    return NextResponse.json({ error: 'bookingReference is required' }, { status: 400 });
  }

  // Verify ownership
  const booking = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: bookingReference, agentUserId: agent.id },
    select: {
      id: true,
      masterBookingReference: true,
      customerName: true,
      customerEmail: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });
  }

  const targetEmail = recipientEmail?.trim() || booking.customerEmail;

  // Trigger re-send via the existing notification system
  try {
    await fetch(new URL('/api/checkout/notifications/booking-confirm', req.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pnr: booking.masterBookingReference,
        bookingId: booking.id,
        email: targetEmail,
        customerName: booking.customerName,
        resend: true,
        agentResend: true,
        agentEmail: agent.email,
      }),
    });
  } catch (err) {
    console.error('[Agent] Resend itinerary failed:', err);
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
