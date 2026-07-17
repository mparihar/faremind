import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * POST /api/service-payments/confirm
 * Called after Stripe confirms payment client-side.
 * 1. Updates ServicePayment status → SUCCEEDED
 * 2. Creates BookingEvent on linked booking
 * 3. Auto-creates a SupportTicket so admin/support can process the request
 * 4. Sends email notification to all admin/support recipients
 *
 * Body: { paymentId: string, stripePaymentIntentId?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { paymentId, stripePaymentIntentId } = body;

    if (!paymentId && !stripePaymentIntentId) {
      return NextResponse.json({ error: 'paymentId or stripePaymentIntentId required' }, { status: 400 });
    }

    const payment = await prisma.servicePayment.findFirst({
      where: paymentId ? { id: paymentId } : { stripePaymentIntentId },
      include: {
        booking: { select: { id: true, masterBookingReference: true, originAirport: true, destinationAirport: true, departureDate: true } },
      },
    });

    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (payment.status === 'SUCCEEDED') return NextResponse.json({ success: true, message: 'Already confirmed' });

    // ── 1. Update payment status ──
    await prisma.servicePayment.update({
      where: { id: payment.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });

    const svcLabel = formatServiceType(payment.serviceType);
    const amtStr = `$${Number(payment.amount).toFixed(2)} ${payment.currency}`;
    const bookingRef = payment.booking?.masterBookingReference || 'N/A';
    const route = payment.booking ? `${payment.booking.originAirport} → ${payment.booking.destinationAirport}` : '';

    // ── 2. Create BookingEvent ──
    if (payment.bookingId) {
      await prisma.bookingEvent.create({
        data: {
          bookingId: payment.bookingId,
          eventType: 'SERVICE_PAYMENT',
          eventTitle: `Service Payment: ${svcLabel}`,
          eventDescription: `Payment of ${amtStr} for ${payment.description}. PNR: ${payment.pnrCode || 'N/A'}, Ticket: ${payment.ticketNumber || 'N/A'}. A support ticket has been auto-created.`,
          actorType: payment.requestedBy === 'AGENT' ? 'agent' : 'customer',
          payloadJson: {
            servicePaymentId: payment.id,
            serviceType: payment.serviceType,
            amount: Number(payment.amount),
            currency: payment.currency,
            pnrCode: payment.pnrCode,
            ticketNumber: payment.ticketNumber,
          },
        },
      });
    }

    // ── 3. Auto-create SupportTicket ──
    const totalCount = await prisma.supportTicket.count();
    const ticketNumber = `FM-PAY-${String(totalCount + 1).padStart(4, '0')}`;
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: `Service Payment: ${svcLabel} — ${amtStr}`,
        description: buildTicketDescription(payment, bookingRef, route),
        priority: 'MEDIUM',
        status: 'OPEN',
        category: svcLabel,
        customerName: payment.customerName,
        customerEmail: payment.customerEmail,
        customerPhone: payment.customerPhone || undefined,
        bookingRef: bookingRef !== 'N/A' ? bookingRef : null,
        airlinePnr: payment.pnrCode || null,
      },
    });

    // Add initial message with full details
    await prisma.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        content: buildTicketDescription(payment, bookingRef, route),
        isInternal: false,
      },
    });

    // ── 4. Email notifications (non-blocking) ──
    notifyAdminsOfPayment(payment, ticketNumber).catch(e =>
      console.error('[ServicePayment] Notification error:', e)
    );

    // Also fire general notification
    import('@/lib/notify').then(m =>
      m.fireNotification({
        event_type: 'PAYMENT_SUCCESS',
        customer_email: payment.customerEmail,
        data: {
          customer_name: payment.customerName,
          booking_reference: bookingRef,
          service_type: svcLabel,
          amount: amtStr,
          pnr: payment.pnrCode || 'N/A',
          ticket_number: payment.ticketNumber || 'N/A',
          support_ticket: ticketNumber,
        },
      })
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      supportTicketId: ticket.id,
      supportTicketNumber: ticketNumber,
    });
  } catch (err: any) {
    console.error('[POST /api/service-payments/confirm]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/* ─── Helpers ─── */

function formatServiceType(type: string): string {
  const map: Record<string, string> = {
    CFAR: 'Cancel For Any Reason (CFAR)',
    PRICE_DROP_PROTECTION: 'Price Drop Protection',
    TRAVEL_INSURANCE: 'Travel Insurance',
    SEAT_CHANGE: 'Seat Change',
    DATE_CHANGE: 'Flight Date Change',
    BAGGAGE_CHANGE: 'Baggage Change',
    UPGRADE: 'Cabin Upgrade',
    OTHER: 'Other Service',
  };
  return map[type] || type;
}

function buildTicketDescription(payment: any, bookingRef: string, route: string): string {
  const lines = [
    `Service payment received and requires processing.`,
    ``,
    `── Payment Details ──`,
    `Service: ${formatServiceType(payment.serviceType)}`,
    `Amount: $${Number(payment.amount).toFixed(2)} ${payment.currency}`,
    `Description: ${payment.description}`,
    `Paid At: ${new Date().toUTCString()}`,
    ``,
    `── Booking Details ──`,
    `Booking Ref: ${bookingRef}`,
    route ? `Route: ${route}` : null,
    `PNR: ${payment.pnrCode || 'N/A'}`,
    `Ticket #: ${payment.ticketNumber || 'N/A'}`,
    ``,
    `── Customer Details ──`,
    `Name: ${payment.customerName}`,
    `Email: ${payment.customerEmail}`,
    payment.customerPhone ? `Phone: ${payment.customerPhone}` : null,
    ``,
    `── Internal ──`,
    `Requested By: ${payment.requestedBy}`,
    `Stripe PI: ${payment.stripePaymentIntentId || 'N/A'}`,
    payment.notes ? `Notes: ${payment.notes}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

async function notifyAdminsOfPayment(payment: any, ticketNumber: string) {
  const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) { console.warn('[ServicePayment] No BREVO_API_KEY — skipping notification'); return; }

  const recipients = await prisma.notificationRecipient.findMany({
    where: { isActive: true },
    select: { email: true },
  });

  const svcLabel = formatServiceType(payment.serviceType);
  const amtStr = `$${Number(payment.amount).toFixed(2)} ${payment.currency}`;
  const bookingRef = payment.booking?.masterBookingReference || 'N/A';

  const subject = `💳 Service Payment — ${svcLabel} — ${amtStr} — Ticket ${ticketNumber}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;padding:24px;border-radius:12px;">
      <h2 style="color:#1ABC9C;margin-bottom:4px;">Service Payment Received</h2>
      <p style="color:#64748b;margin-bottom:16px;font-size:13px;">A support ticket <strong style="color:#fff;">${ticketNumber}</strong> has been auto-created.</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#94a3b8;">Service</td><td style="padding:8px 0;color:#fff;font-weight:bold;">${svcLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Amount</td><td style="padding:8px 0;color:#1ABC9C;font-weight:bold;font-size:18px;">${amtStr}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Booking</td><td style="padding:8px 0;color:#fff;">${bookingRef}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">PNR</td><td style="padding:8px 0;color:#fff;font-family:monospace;">${payment.pnrCode || 'N/A'}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Ticket #</td><td style="padding:8px 0;color:#fff;font-family:monospace;">${payment.ticketNumber || 'N/A'}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Customer</td><td style="padding:8px 0;color:#fff;">${payment.customerName}<br/><span style="color:#94a3b8;">${payment.customerEmail}</span>${payment.customerPhone ? `<br/><span style="color:#94a3b8;">${payment.customerPhone}</span>` : ''}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Requested By</td><td style="padding:8px 0;color:#fff;">${payment.requestedBy}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Support Ticket</td><td style="padding:8px 0;color:#1ABC9C;font-weight:bold;">${ticketNumber}</td></tr>
      </table>
      ${payment.notes ? `<p style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;color:#94a3b8;"><strong style="color:#fff;">Notes:</strong> ${payment.notes}</p>` : ''}
      <p style="margin-top:16px;color:#64748b;font-size:11px;">Action required: Please review and process this service request.</p>
    </div>
  `;
  const text = `Service Payment: ${svcLabel} — ${amtStr}. Booking: ${bookingRef}. PNR: ${payment.pnrCode || 'N/A'}. Customer: ${payment.customerName} (${payment.customerEmail}). Support Ticket: ${ticketNumber}.`;

  for (const r of recipients) {
    fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'FAREMIND', email: process.env.BREVO_SENDER_EMAIL || 'support@faremind.ai' },
        to: [{ email: r.email }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
    }).catch(() => {});
  }
}
