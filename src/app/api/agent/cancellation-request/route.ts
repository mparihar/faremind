// FILE: src/app/api/agent/cancellation-request/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  const body = await req.json();
  const { bookingReference, reason } = body;

  if (!bookingReference) {
    return NextResponse.json({ error: 'bookingReference is required' }, { status: 400 });
  }

  // Verify ownership
  const booking = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: bookingReference, agentUserId: agent.id },
    select: {
      id: true,
      bookingStatus: true,
      masterBookingReference: true,
      customerName: true,
      customerEmail: true,
      departureDate: true,
      totalAmount: true,
      currency: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });
  }

  // Check if cancellation is possible
  const nonCancellableStatuses = ['CANCELLED', 'CANCEL_REQUESTED', 'REFUNDED', 'FAILED'];
  if (nonCancellableStatuses.includes(booking.bookingStatus)) {
    return NextResponse.json({
      error: `Cannot cancel — booking is already ${booking.bookingStatus.toLowerCase().replace(/_/g, ' ')}.`,
      currentStatus: booking.bookingStatus,
    }, { status: 400 });
  }

  // Check if departure is in the past
  if (booking.departureDate < new Date()) {
    return NextResponse.json({
      error: 'Cannot cancel — departure date has already passed.',
    }, { status: 400 });
  }

  // Update status to CANCEL_REQUESTED
  await prisma.masterBooking.update({
    where: { id: booking.id },
    data: { bookingStatus: 'CANCEL_REQUESTED' },
  });

  // Log event
  try {
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: 'CANCELLATION_REQUESTED',
        title: 'Cancellation requested by agent',
        description: `Agent ${agent.name} (${agent.email}) requested cancellation. Reason: ${reason || 'Not provided'}`,
        metadata: { agent: agent.email, reason: reason || null },
      },
    });
  } catch {}

  // Create support ticket for admin review
  try {
    await prisma.supportTicket.create({
      data: {
        subject: `Agent Cancellation Request: ${booking.masterBookingReference} — ${booking.customerName}`,
        description: `Agent ${agent.name} has requested cancellation for booking ${booking.masterBookingReference}.\n\nCustomer: ${booking.customerName} (${booking.customerEmail})\nAmount: $${Number(booking.totalAmount).toLocaleString()} ${booking.currency}\nReason: ${reason || 'Not provided'}\n\nThis requires Admin/Super Admin review for refund processing.`,
        priority: 'HIGH',
        status: 'OPEN',
        category: 'Cancellation Request',
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
      },
    });
  } catch {}

  return NextResponse.json({
    success: true,
    status: 'CANCEL_REQUESTED',
    message: 'Cancellation request submitted. An admin will review and process the refund.',
    note: 'Agents cannot approve refunds or process financial settlements. Admin/Super Admin review is required.',
  });
});
