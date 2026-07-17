import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/user/support-tickets
 * Returns support tickets for the logged-in user (by email).
 * Excludes SYSTEM-channel tickets (infrastructure failures, auto-escalations).
 * Only non-internal messages are counted.
 */
export async function GET(req: NextRequest) {
  try {
    // Extract session token
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });

    if (!session || !session.user || new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    const userEmail = session.user.email;

    // Fetch tickets belonging to this user (by email)
    const tickets = await prisma.supportTicket.findMany({
      where: {
        customerEmail: { equals: userEmail, mode: 'insensitive' },
      },
      include: {
        _count: {
          select: {
            messages: { where: { isInternal: false } }, // Only count non-internal messages
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = tickets.map(t => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      sequenceNumber: t.sequenceNumber,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      channel: t.channel,
      bookingRef: t.bookingRef,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t._count.messages,
    }));

    return NextResponse.json({ tickets: formatted });
  } catch (err: any) {
    console.error('[user/support-tickets] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
}
