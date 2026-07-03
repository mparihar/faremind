// FILE: src/app/api/manage-booking/email-itinerary/route.ts
// User-facing email itinerary endpoint for AI Bot Manage Booking.
// Generates itinerary HTML server-side and sends via Brevo.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateItineraryHtmlFromBooking } from '@/lib/fare-utils';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL  = process.env.BREVO_SENDER_EMAIL ?? 'support@faremind.ai';
const SENDER_NAME   = 'FAREMIND';

export async function POST(request: NextRequest) {
  try {
    const { bookingId, recipientEmail } = await request.json();

    if (!bookingId) {
      return NextResponse.json({ error: 'bookingId is required' }, { status: 400 });
    }

    // Fetch full booking with all relations for itinerary generation
    const booking = await prisma.masterBooking.findUnique({
      where: { id: bookingId },
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
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
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
      console.error('[email-itinerary] BREVO_API_KEY not set');
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 });
    }

    // Generate the detailed itinerary HTML
    let htmlContent: string;
    try {
      htmlContent = generateItineraryHtmlFromBooking(booking);
    } catch (err) {
      console.error('[email-itinerary] generateItineraryHtmlFromBooking failed:', err);
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

    // Send via Brevo
    const subject = `Your FAREMIND Itinerary – ${ref}`;
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

    if (!res.ok) {
      const responseBody = await res.text();
      console.error(`[email-itinerary] Brevo rejected: ${res.status} ${responseBody}`);
      return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
    }

    console.log(`[email-itinerary] ✅ Email sent to ${targetEmail} for booking ${ref}`);

    // Log to email_logs (non-blocking)
    try {
      await prisma.emailLog.create({
        data: {
          recipient: targetEmail,
          recipientName: customerName,
          subject,
          template: 'AI Bot Email Itinerary',
          status: 'SENT',
          provider: 'Brevo',
          bookingRef: ref,
        },
      });
    } catch {}

    // Log booking event
    try {
      await prisma.bookingEvent.create({
        data: {
          bookingId: booking.id,
          eventType: 'ITINERARY_EMAILED',
          eventTitle: 'Itinerary emailed via AI Bot',
          eventDescription: `Itinerary sent to ${targetEmail}`,
        },
      });
    } catch {}

    return NextResponse.json({
      success: true,
      sentTo: targetEmail,
      message: `Itinerary sent to ${targetEmail}`,
    });
  } catch (e) {
    console.error('[email-itinerary] Error:', e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
