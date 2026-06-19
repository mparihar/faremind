import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Public API — no auth required.
 * Creates a support ticket from the public Contact Support page.
 * The ticket is then visible in Admin → Support Queue.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { name, email, subject, message, category, bookingRef } = body;

    // Validation
    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: 'Name, email, and message are required.' },
        { status: 400 }
      );
    }

    // Map frontend category values to admin-friendly labels
    const categoryMap: Record<string, string> = {
      cancellation: 'Cancellation',
      change:       'Change Request',
      ticket:       'Booking Issue',
      baggage:      'Baggage Claim',
      payment:      'Payment Problem',
      other:        'General Inquiry',
    };
    const resolvedCategory = categoryMap[category] || 'General Inquiry';

    // Create the support ticket
    const ticket = await prisma.supportTicket.create({
      data: {
        subject: subject?.trim() || `Support request from ${name.trim()}`,
        description: message.trim(),
        priority: 'MEDIUM',
        status: 'OPEN',
        category: resolvedCategory,
        customerName: name.trim(),
        customerEmail: email.trim().toLowerCase(),
        bookingRef: bookingRef?.trim() || null,
      },
    });

    // Generate human-readable ticket reference from total count
    const totalCount = await prisma.supportTicket.count();
    const ticketNumber = `FM-TKT-${String(totalCount).padStart(4, '0')}`;

    // Send notification email to admin (non-blocking)
    import('@/lib/notify').then(m =>
      m.fireNotification({
        event_type: 'SUPPORT_MANUAL',
        customer_email: email.trim().toLowerCase(),
        data: {
          customer_name: name.trim(),
          booking_reference: bookingRef?.trim() || null,
          ticket_id: ticketNumber,
          subject: subject?.trim() || 'Support Request',
          category: resolvedCategory,
        },
      })
    ).catch(e => console.error('[support-ticket] Notification error:', e));

    return NextResponse.json(
      {
        success: true,
        ticketId: ticket.id,
        ticketNumber,
        message: `Your support ticket ${ticketNumber} has been created. We'll respond within 24 hours.`,
      },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[support-tickets] Public POST error:', err);
    return NextResponse.json(
      { error: 'Failed to create support ticket. Please try again or email support@faremind.ai directly.' },
      { status: 500 }
    );
  }
}
