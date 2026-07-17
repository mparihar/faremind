// FILE: src/app/api/admin/bookings/[id]/cancel-action/route.ts
// Admin approve / reject cancellation requests from agents
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';
import { agentNotifyAll } from '@/lib/agent-notify';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export const POST = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const body = await req.json();
    const { action, reason } = body; // action: 'approve' | 'reject'

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }

    // Fetch booking
    const booking = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      include: {
        pnrs: { where: { isPrimary: true }, take: 1 },
      },
    });

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    if (booking.bookingStatus !== 'CANCEL_REQUESTED') {
      return NextResponse.json({
        error: `Booking is not in CANCEL_REQUESTED status (current: ${booking.bookingStatus})`,
      }, { status: 400 });
    }

    const ref = booking.masterBookingReference;
    const route = `${booking.originAirport} - ${booking.destinationAirport}`;
    const amount = `$${Number(booking.totalAmount || 0).toLocaleString()}`;

    // ── REJECT ──────────────────────────────────────────────────────────────
    if (action === 'reject') {
      // Revert status to CONFIRMED
      await prisma.masterBooking.update({
        where: { id: booking.id },
        data: { bookingStatus: 'CONFIRMED' },
      });

      // Log event
      await prisma.bookingEvent.create({
        data: {
          bookingId: booking.id,
          eventType: 'CANCELLATION_REJECTED',
          eventTitle: 'Cancellation request rejected by admin',
          eventDescription: `Admin ${admin.email} rejected cancellation. Reason: ${reason || 'Not provided'}`,
          actorType: 'admin',
          actorId: admin.sub,
          actorName: admin.email,
          payloadJson: { reason: reason || null },
        },
      });

      // Notify all parties
      agentNotifyAll({
        event: 'Cancellation Rejected',
        bookingRef: ref,
        pnr: booking.masterPnr ?? ref,
        customerName: booking.customerName ?? 'Traveler',
        customerEmail: booking.customerEmail || undefined,
        route,
        agentName: booking.agentName ?? '',
        agentEmail: booking.agentEmail ?? '',
        subject: `Cancellation request declined – ${ref}`,
        adminSubject: `[FAREMIND] Cancellation Rejected – ${ref}`,
        bodyHtml: `
          <h2 style="margin:0 0 8px;color:#ef4444;font-size:20px;font-weight:800;">Cancellation Request Declined</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
            The cancellation request for booking <strong style="color:#0f172a">${ref}</strong> has been reviewed and <strong style="color:#ef4444">declined</strong>.
          </p>
          <div style="background:#fef2f2;border:1px solid #ef4444;border-radius:12px;padding:20px;margin-bottom:20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              <tr><td style="padding:6px 0;color:#64748b;">Booking Ref</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${ref}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Route</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${route}</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Status</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#22c55e;">CONFIRMED (Restored)</td></tr>
              <tr><td style="padding:6px 0;color:#64748b;">Reason</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${reason || 'Not provided'}</td></tr>
            </table>
          </div>
          <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">
            Your booking remains active. If you have questions, please contact FAREMIND support.
          </p>
          <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND</p>
          <p style="margin:4px 0;color:#1abc9c;font-size:12px;font-weight:600;">Your Personal Travel Consultant</p>
        `,
        bodyText: `Cancellation request for booking ${ref} (${route}) has been declined. Reason: ${reason || 'Not provided'}. Your booking remains active.`,
      }).catch(err => console.error('[cancel-action] Reject notify failed:', err));

      return NextResponse.json({
        success: true,
        action: 'rejected',
        newStatus: 'CONFIRMED',
        message: 'Cancellation request rejected. Booking restored to CONFIRMED.',
      });
    }

    // ── APPROVE ─────────────────────────────────────────────────────────────
    // Step 1: Get cancellation quote from backend (Duffel provider)
    const providerPnr = booking.pnrs?.[0];
    let quoteData: any = null;
    let providerCancelResult: any = null;

    if (providerPnr?.providerOrderId) {
      try {
        // Get cancellation quote
        const quoteRes = await fetch(`${BACKEND_URL}/api/manage-booking/${booking.id}/cancel/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (quoteRes.ok) {
          quoteData = await quoteRes.json();
        } else {
          console.warn('[cancel-action] Quote failed:', quoteRes.status, await quoteRes.text().catch(() => ''));
        }
      } catch (err) {
        console.warn('[cancel-action] Quote request failed:', err instanceof Error ? err.message : err);
      }

      // Step 2: Confirm cancellation with provider
      const quoteId = quoteData?.quoteId || quoteData?.quote?.id || `est_${booking.id}`;
      try {
        const confirmRes = await fetch(`${BACKEND_URL}/api/manage-booking/${booking.id}/cancel/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quoteId, refundMethod: 'ORIGINAL_PAYMENT' }),
        });
        if (confirmRes.ok) {
          providerCancelResult = await confirmRes.json();
        } else {
          const errText = await confirmRes.text().catch(() => '');
          console.error('[cancel-action] Provider cancellation failed:', confirmRes.status, errText);
          // Continue anyway — we'll cancel on our side
        }
      } catch (err) {
        console.error('[cancel-action] Confirm request failed:', err instanceof Error ? err.message : err);
      }
    }

    // Step 3: Update booking status (fallback if backend didn't do it)
    const currentBooking = await prisma.masterBooking.findUnique({ where: { id: booking.id }, select: { bookingStatus: true } });
    if (currentBooking?.bookingStatus !== 'CANCELLED') {
      await prisma.masterBooking.update({
        where: { id: booking.id },
        data: { bookingStatus: 'CANCELLED' },
      });
      // Also cancel PNRs
      await prisma.bookingPnr.updateMany({ where: { bookingId: booking.id }, data: { status: 'CANCELLED' } });
    }

    // Extract refund info
    const refundAmount = providerCancelResult?.refundAmount ?? providerCancelResult?.cancellation?.refundAmount ?? 0;
    const refundCurrency = providerCancelResult?.refundCurrency ?? booking.currency ?? 'USD';
    const penaltyAmount = Number(booking.totalAmount || 0) - refundAmount;
    const refundFormatted = refundAmount > 0 ? `$${refundAmount.toLocaleString()}` : 'Non-refundable';

    // Log event
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'CANCELLATION_APPROVED',
        eventTitle: 'Cancellation approved by admin',
        eventDescription: `Admin ${admin.email} approved cancellation. Refund: ${refundFormatted}. ${reason ? `Reason: ${reason}` : ''}`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
        payloadJson: { reason, refundAmount, refundCurrency, penaltyAmount, providerResult: providerCancelResult },
      },
    });

    // Notify all parties
    agentNotifyAll({
      event: 'Cancellation Confirmed',
      bookingRef: ref,
      pnr: booking.masterPnr ?? ref,
      customerName: booking.customerName ?? 'Traveler',
      customerEmail: booking.customerEmail || undefined,
      route,
      agentName: booking.agentName ?? '',
      agentEmail: booking.agentEmail ?? '',
      subject: `Booking cancelled – ${ref}`,
      adminSubject: `[FAREMIND] Cancellation Confirmed – ${ref}`,
      bodyHtml: `
        <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Booking Cancellation Confirmed</h2>
        <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
          Your cancellation request for booking <strong style="color:#0f172a">${ref}</strong> has been approved and processed.
        </p>
        <div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:12px;padding:20px;margin-bottom:20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
            <tr><td style="padding:6px 0;color:#64748b;">Booking Ref</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${ref}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Route</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${route}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Status</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#ef4444;">CANCELLED</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Original Amount</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${amount}</td></tr>
            ${refundAmount > 0 ? `<tr><td style="padding:6px 0;color:#64748b;">Refund Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#22c55e;">${refundFormatted}</td></tr>` : ''}
            ${penaltyAmount > 0 ? `<tr><td style="padding:6px 0;color:#64748b;">Cancellation Fee</td><td style="padding:6px 0;text-align:right;color:#ef4444;">$${penaltyAmount.toLocaleString()}</td></tr>` : ''}
            <tr><td style="padding:6px 0;color:#64748b;">Refund Status</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${refundAmount > 0 ? 'Processing (5–10 business days)' : 'Non-refundable fare'}</td></tr>
          </table>
        </div>
        <p style="margin:0 0 16px;color:#64748b;font-size:14px;line-height:1.6;">
          ${refundAmount > 0 ? 'Your refund will be processed to the original payment method within 5–10 business days.' : 'This fare was non-refundable. No refund will be issued.'}
        </p>
        <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND</p>
        <p style="margin:4px 0;color:#1abc9c;font-size:12px;font-weight:600;">Your Personal Travel Consultant</p>
      `,
      bodyText: `Booking ${ref} (${route}) has been cancelled. Refund: ${refundFormatted}. ${refundAmount > 0 ? 'Refund will be processed within 5–10 business days.' : 'Non-refundable fare.'}`,
    }).catch(err => console.error('[cancel-action] Approve notify failed:', err));

    return NextResponse.json({
      success: true,
      action: 'approved',
      newStatus: 'CANCELLED',
      refundAmount,
      refundCurrency,
      penaltyAmount,
      message: `Cancellation approved. ${refundAmount > 0 ? `Refund: $${refundAmount.toLocaleString()}` : 'Non-refundable fare.'}`,
    });

  } catch (err: any) {
    console.error('[cancel-action] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
});
