import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const FALLBACK_WHATSAPP_NUMBER = '19453695543';

/**
 * Public API — no auth required.
 * Creates an urgent support ticket and returns a WhatsApp URL with the case ID pre-filled.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, phone, fbr, pnr, issueType, issueDetails } = body;

    // Validate required fields
    if (!firstName?.trim() || !email?.trim() || !phone?.trim() || !issueDetails?.trim()) {
      return NextResponse.json(
        { error: 'First name, email, phone, and issue details are required.' },
        { status: 400 }
      );
    }

    // Load active WhatsApp support number from database
    let whatsappNumber = FALLBACK_WHATSAPP_NUMBER;
    let whatsappDisplayName = 'FareMind Support';
    try {
      const dbNumber = await prisma.whatsAppSupportNumber.findFirst({
        where: { isActive: true },
        orderBy: [{ isPrimary: 'desc' }, { priority: 'asc' }],
      });
      if (dbNumber) {
        whatsappNumber = dbNumber.fullWhatsAppNumber;
        whatsappDisplayName = dbNumber.displayName;
      }
    } catch {
      // Fallback to hardcoded number if table doesn't exist yet
    }

    const fullName = `${firstName.trim()}${lastName?.trim() ? ' ' + lastName.trim() : ''}`;
    const resolvedCategory = issueType || 'General Inquiry';

    // Create the support ticket
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: `[URGENT] ${resolvedCategory} — ${fullName}`,
        description: issueDetails.trim(),
        priority: 'URGENT',
        status: 'OPEN',
        category: resolvedCategory,
        channel: 'WHATSAPP',
        urgency: 'URGENT',
        customerName: fullName,
        customerEmail: email.trim().toLowerCase(),
        customerPhone: phone.trim(),
        bookingRef: fbr?.trim() || null,
        airlinePnr: pnr?.trim() || null,
        whatsappNumberUsed: whatsappNumber,
      },
    });

    // Generate case number: FS-URG-{10000 + sequenceNumber}
    const seqNum = ticket.sequenceNumber ?? 1;
    const caseNumber = `FS-URG-${String(10000 + seqNum).padStart(5, '0')}`;

    // Build WhatsApp message
    const messageParts = [
      '🚨 *Urgent FareMind Support Request*',
      '',
      `*Case ID:* ${caseNumber}`,
      '',
      `*Issue Type:* ${resolvedCategory}`,
      '',
      `*Name:* ${fullName}`,
      `*Email:* ${email.trim()}`,
      `*Phone:* ${phone.trim()}`,
    ];

    if (fbr?.trim()) messageParts.push(`*FareMind Booking Reference:* ${fbr.trim()}`);
    if (pnr?.trim()) messageParts.push(`*Airline PNR:* ${pnr.trim()}`);

    messageParts.push('', `*Issue Details:*`, issueDetails.trim());
    messageParts.push('', '_Please assign this case from Support Queue → Urgent Issues._');

    const whatsappMessage = messageParts.join('\n');
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;

    // Update ticket with the message text and case number
    await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        ticketNumber: caseNumber,
        whatsappMessageText: whatsappMessage,
      },
    });

    return NextResponse.json(
      {
        success: true,
        caseNumber,
        ticketId: ticket.id,
        whatsappUrl,
        message: `Your urgent support case ${caseNumber} has been created.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[urgent-whatsapp-case] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to create urgent support case. Please call +1 (945) 369-5543 directly.' },
      { status: 500 }
    );
  }
}
