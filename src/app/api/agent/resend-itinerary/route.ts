// FILE: src/app/api/agent/resend-itinerary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { generateItineraryHtmlFromBooking } from '@/lib/fare-utils';
import { agentNotifyAll } from '@/lib/agent-notify';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'support@faremind.ai';
const SENDER_NAME   = 'FAREMIND';

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  const body = await req.json();
  const { bookingReference, recipientEmail } = body;

  if (!bookingReference) {
    return NextResponse.json({ error: 'bookingReference is required' }, { status: 400 });
  }

  // Verify ownership & fetch full booking data for itinerary
  const booking = await prisma.masterBooking.findFirst({
    where: {
      masterBookingReference: bookingReference,
      OR: [
        { agentUserId: agent.id },
        { userId: agent.id },
      ],
    },
    include: {
      journeys: { include: { segments: true }, orderBy: { journeyOrder: 'asc' } },
      passengers: { orderBy: { passengerOrder: 'asc' } },
      segments: { orderBy: { segmentOrder: 'asc' } },
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
  const ref = booking.masterBookingReference;

  if (!targetEmail) {
    return NextResponse.json({ error: 'No recipient email available' }, { status: 400 });
  }

  // Check Brevo key
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.error('[resend-itinerary] BREVO_API_KEY not set');
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
  }

  // Generate the detailed itinerary HTML
  let htmlContent: string;
  try {
    htmlContent = generateItineraryHtmlFromBooking(booking);
  } catch (err) {
    console.error('[resend-itinerary] ❌ generateItineraryHtmlFromBooking failed:', err);
    // Fallback to simple confirmation
    htmlContent = `
      <html><body style="font-family:sans-serif;padding:20px;">
        <h2>Booking Confirmation – ${ref}</h2>
        <p>Hi ${customerName},</p>
        <p>Your booking <strong>${ref}</strong> (${booking.originAirport} → ${booking.destinationAirport}) is <strong>${booking.bookingStatus}</strong>.</p>
        <p>PNR: <strong>${booking.masterPnr || ref}</strong></p>
        <p>Total: <strong>$${Number(booking.totalAmount || 0).toLocaleString()}</strong></p>
        <p>Manage your booking at <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://faremind.ai'}/manage-booking">FAREMIND</a>.</p>
      </body></html>
    `;
  }

  // Send directly via Brevo
  const subject = `Your FAREMIND Itinerary – ${ref}`;
  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: targetEmail, name: customerName }],
        subject,
        htmlContent,
        textContent: `Hi ${customerName}, your booking ${ref} (${booking.originAirport} → ${booking.destinationAirport}) is ${booking.bookingStatus}. PNR: ${booking.masterPnr || ref}. Total: $${Number(booking.totalAmount || 0).toLocaleString()}.`,
      }),
    });

    const responseBody = await res.text();

    if (!res.ok) {
      console.error(`[resend-itinerary] ❌ Brevo rejected: ${res.status} ${responseBody}`);
      return NextResponse.json({ 
        error: `Email service returned error: ${res.status}`,
        details: responseBody.slice(0, 200),
      }, { status: 502 });
    }

  } catch (err) {
    console.error('[resend-itinerary] ❌ Failed to send via Brevo:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }

  // Log to email_logs (non-blocking)
  try {
    await prisma.emailLog.create({
      data: {
        recipient: targetEmail,
        recipientName: customerName,
        subject,
        template: 'Resend Itinerary',
        status: 'SENT',
        provider: 'Brevo',
        bookingRef: ref,
      },
    });
  } catch {}

  // Log booking event (correct Prisma field names)
  try {
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'ITINERARY_RESENT',
        eventTitle: 'Itinerary resent by agent',
        eventDescription: `Agent ${agent.name} resent itinerary to ${targetEmail}`,
        actorType: 'agent',
        actorId: agent.id,
        actorName: agent.name,
        payloadJson: { recipientEmail: targetEmail },
      },
    });
  } catch {}

  // Notify agent + admin with the FULL itinerary attached
  const route = `${booking.originAirport} - ${booking.destinationAirport}`;
  const itinerarySummaryHtml = `
    <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Itinerary Resent</h2>
    <p style="margin:0 0 16px;color:#64748b;font-size:14px;">Agent <strong>${agent.name}</strong> resent the itinerary for booking <strong>${ref}</strong> (${route}) to <strong>${targetEmail}</strong>.</p>
    <div style="margin-top:24px;border-top:2px solid #e2e8f0;padding-top:24px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Detailed Itinerary</p>
      ${htmlContent}
    </div>
  `;
  agentNotifyAll({
    event: 'Itinerary Resent',
    bookingRef: ref,
    pnr: booking.masterPnr ?? ref,
    customerName,
    customerEmail: undefined, // Customer already received the itinerary above
    route,
    agentName: agent.name,
    agentEmail: agent.email,
    subject: `Itinerary resent – ${ref}`,
    adminSubject: `[FAREMIND] Agent Resent Itinerary – ${ref}`,
    bodyHtml: itinerarySummaryHtml,
    bodyText: `Agent ${agent.name} resent itinerary for booking ${ref} (${route}) to ${targetEmail}.`,
  }).catch(err => console.error('[resend-itinerary] Agent/admin notify failed:', err));

  return NextResponse.json({
    success: true,
    sentTo: targetEmail,
    message: `Itinerary sent to ${targetEmail}`,
  });
});
