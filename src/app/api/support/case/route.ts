import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Generic Support Case API — public, no auth required.
 * Accepts support cases from any source: AI_BOT, WEB, WHATSAPP.
 * Reuses the existing SupportTicket table so all cases appear in Admin → Support Queue.
 */

const URGENT_CATEGORIES = new Set([
  'Flight Today / Urgent Issue',
  'Ticket Not Issued',
  'Payment Issue',
  'Booking Failed',
]);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      source = 'WEB',
      channel = 'WEB',
      issueType,
      firstName,
      lastName,
      email,
      phone,
      fbr,
      pnr,
      issueDetails,
    } = body;

    // Validate required fields
    if (!firstName?.trim()) {
      return NextResponse.json({ error: 'First name is required.' }, { status: 400 });
    }
    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }
    if (!phone?.trim()) {
      return NextResponse.json({ error: 'Phone number is required.' }, { status: 400 });
    }
    if (!issueDetails?.trim()) {
      return NextResponse.json({ error: 'Issue details are required.' }, { status: 400 });
    }

    // Email validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    // Phone validation — at least 10 digits
    const phoneDigits = phone.replace(/[^\d]/g, '');
    if (phoneDigits.length < 10) {
      return NextResponse.json({ error: 'Phone number must have at least 10 digits.' }, { status: 400 });
    }

    const fullName = `${firstName.trim()}${lastName?.trim() ? ' ' + lastName.trim() : ''}`;
    const resolvedCategory = issueType || 'General Inquiry';
    const isUrgent = URGENT_CATEGORIES.has(resolvedCategory);
    const urgency = isUrgent ? 'URGENT' : 'NORMAL';
    const priority = isUrgent ? 'URGENT' : 'MEDIUM';

    // Create the support ticket
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: isUrgent
          ? `[URGENT] ${resolvedCategory} — ${fullName}`
          : `${resolvedCategory} — ${fullName}`,
        description: issueDetails.trim(),
        priority,
        status: 'OPEN',
        category: resolvedCategory,
        channel: channel.toUpperCase(),
        urgency,
        customerName: fullName,
        customerEmail: email.trim().toLowerCase(),
        customerPhone: phone.trim(),
        bookingRef: fbr?.trim() || null,
        airlinePnr: pnr?.trim() || null,
      },
    });

    // Generate case number based on urgency
    const seqNum = ticket.sequenceNumber ?? 1;
    const caseNumber = isUrgent
      ? `FS-URG-${String(10000 + seqNum).padStart(5, '0')}`
      : `FS-SUP-${String(10000 + seqNum).padStart(5, '0')}`;

    // Update ticket with the case number
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { ticketNumber: caseNumber },
    });

    // SLA message
    const slaMessage = isUrgent
      ? `Our support team will review this immediately. For urgent issues, we aim to respond within 1–2 hours.`
      : `Our support team will get back to you within 24 hours.`;

    // Fire notification (non-blocking)
    import('@/lib/notify').then(m =>
      m.fireNotification({
        event_type: isUrgent ? 'SUPPORT_URGENT' : 'SUPPORT_MANUAL',
        customer_email: email.trim().toLowerCase(),
        data: {
          customer_name: fullName,
          booking_reference: fbr?.trim() || null,
          ticket_id: caseNumber,
          subject: `${resolvedCategory} — ${fullName}`,
          category: resolvedCategory,
          source,
          channel,
        },
      })
    ).catch(e => console.error('[support/case] Notification error:', e));

    return NextResponse.json(
      {
        success: true,
        caseNumber,
        ticketId: ticket.id,
        urgency,
        slaMessage,
        message: `Your support case ${caseNumber} has been created.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[support/case] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to create support case. Please try again or call +1 (972) 697-1532 directly.' },
      { status: 500 }
    );
  }
}
