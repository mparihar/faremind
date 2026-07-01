// FILE: src/app/api/agent/cancellation-request/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
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

  // Update status to CANCEL_REQUESTED
  try {
    await prisma.masterBooking.update({
      where: { id: booking.id },
      data: { bookingStatus: 'CANCEL_REQUESTED' },
    });
  } catch (err) {
    console.error('[cancellation-request] Status update failed:', err);
    return NextResponse.json({ error: 'Failed to update booking status' }, { status: 500 });
  }

  // Log event (use correct Prisma field names)
  try {
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'CANCELLATION_REQUESTED',
        eventTitle: 'Cancellation requested by agent',
        eventDescription: `Agent ${agent.name} (${agent.email}) requested cancellation. Reason: ${reason || 'Not provided'}`,
        actorType: 'agent',
        actorId: agent.id,
        actorName: agent.name,
        payloadJson: { reason: reason || null },
      },
    });
  } catch (err) {
    console.error('[cancellation-request] Event log failed:', err instanceof Error ? err.message : err);
  }

  // Create support ticket for admin review
  try {
    await prisma.supportTicket.create({
      data: {
        subject: `Agent Cancellation Request: ${booking.masterBookingReference} — ${booking.customerName}`,
        description: `Agent ${agent.name} has requested cancellation for booking ${booking.masterBookingReference}.\n\nCustomer: ${booking.customerName} (${booking.customerEmail})\nAmount: $${Number(booking.totalAmount).toLocaleString()} ${booking.currency}\nReason: ${reason || 'Not provided'}\n\nThis requires Admin/Super Admin review for refund processing.`,
        priority: 'HIGH',
        status: 'OPEN',
        category: 'Cancellation Request',
        customerName: booking.customerName ?? '',
        customerEmail: booking.customerEmail ?? '',
        bookingRef: booking.masterBookingReference,
      },
    });
  } catch (err) {
    console.error('[cancellation-request] Support ticket failed:', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({
    success: true,
    status: 'CANCEL_REQUESTED',
    message: 'Cancellation request submitted. An admin will review and process the refund.',
    note: 'Agents cannot approve refunds or process financial settlements. Admin/Super Admin review is required.',
  });
});
