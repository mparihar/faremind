// FILE: src/app/api/agent/cancellation-request/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { agentNotifyAll } from '@/lib/agent-notify';

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
    where: {
      masterBookingReference: bookingReference,
      OR: [
        { agentUserId: agent.id },
        { userId: agent.id },
      ],
    },
    select: {
      id: true,
      bookingStatus: true,
      masterBookingReference: true,
      masterPnr: true,
      customerName: true,
      customerEmail: true,
      originAirport: true,
      destinationAirport: true,
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
    await prisma.$executeRaw`UPDATE master_bookings SET booking_status = 'CANCEL_REQUESTED'::"MbBookingStatus", updated_at = NOW() WHERE id = ${booking.id}`;
  } catch (err) {
    console.error('[cancellation-request] Status update failed:', err);
    return NextResponse.json({ error: 'Failed to update booking status' }, { status: 500 });
  }

  // Log event (correct Prisma field names)
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

  // Send email notifications to ALL parties (customer, agent, admin, super-admin)
  const ref = booking.masterBookingReference;
  const route = `${booking.originAirport} - ${booking.destinationAirport}`;
  const amount = `$${Number(booking.totalAmount || 0).toLocaleString()}`;
  const reasonText = reason || 'Not provided';

  agentNotifyAll({
    event: 'Cancellation Request',
    bookingRef: ref,
    pnr: booking.masterPnr ?? ref,
    customerName: booking.customerName ?? 'Traveler',
    customerEmail: booking.customerEmail || undefined,
    route,
    agentName: agent.name,
    agentEmail: agent.email,
    subject: `Cancellation request received – ${ref}`,
    adminSubject: `[FAREMIND] Agent Cancellation Request – ${ref}`,
    bodyHtml: `
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Cancellation Request Received</h2>
      <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
        Hi <strong style="color:#0f172a">${booking.customerName ?? 'Traveler'}</strong>, we have received a cancellation request for your booking.
      </p>
      <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:20px;margin-bottom:20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          <tr><td style="padding:6px 0;color:#92400e;">Status</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#92400e;">Cancellation Requested</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Booking Reference</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${ref}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Route</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${route}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Booking Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${amount}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Reason</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${reasonText}</td></tr>
        </table>
      </div>
      <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">
        An admin will review your request and process any applicable refund. You will receive a confirmation email once the cancellation is finalized.
      </p>
      <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND</p>
      <p style="margin:4px 0;color:#1abc9c;font-size:12px;font-weight:600;">Your Personal Travel Consultant</p>
    `,
    adminBodyHtml: `
      <h2 style="margin:0 0 8px;color:#f59e0b;font-size:20px;font-weight:800;">⏳ Agent Cancellation Request</h2>
      <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
        Agent <strong style="color:#0f172a">${agent.name}</strong> (${agent.email}) has requested cancellation for the following booking.
      </p>
      <div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;padding:20px;margin-bottom:20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          <tr><td style="padding:6px 0;color:#64748b;">Booking Ref</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${ref}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Customer</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${booking.customerName} (${booking.customerEmail})</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Route</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${route}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#1abc9c;">${amount}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;">Reason</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${reasonText}</td></tr>
        </table>
      </div>
      <p style="margin:0;color:#ef4444;font-size:14px;font-weight:600;">⚠️ Action Required: Review and process this cancellation request.</p>
    `,
    bodyText: `Cancellation request received for booking ${ref} (${route}). Amount: ${amount}. Reason: ${reasonText}. An admin will review and process any refund.`,
  }).catch(err => console.error('[cancellation-request] Notify failed:', err));

  return NextResponse.json({
    success: true,
    status: 'CANCEL_REQUESTED',
    message: 'Cancellation request submitted. An admin will review and process the refund.',
  });
});
