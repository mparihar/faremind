import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/user/support-tickets/[id]
 * Returns a single ticket detail for the logged-in user.
 * Only shows non-internal messages (admin internal notes are hidden).
 * Excludes SYSTEM-channel tickets.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: ticketId } = await params;

    // Extract session token
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!session || !session.user || new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          where: { isInternal: false }, // Only show non-internal messages
          orderBy: { createdAt: 'asc' },
          include: {
            sender: { select: { fullName: true } },
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Verify ownership — customerEmail must match the logged-in user
    if (ticket.customerEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Note: all tickets are visible to the user, including auto-generated ones

    return NextResponse.json({
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        sequenceNumber: ticket.sequenceNumber,
        subject: ticket.subject,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        channel: ticket.channel,
        bookingRef: ticket.bookingRef,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        messages: (ticket as any).messages.map((m: any) => ({
          id: m.id,
          content: m.content,
          createdAt: m.createdAt,
          senderName: m.sender?.fullName || null, // null = customer message
        })),
      },
    });
  } catch (err: any) {
    console.error('[user/support-tickets/[id]] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch ticket' }, { status: 500 });
  }
}
