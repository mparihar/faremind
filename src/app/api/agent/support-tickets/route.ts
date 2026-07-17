import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/agent/support-tickets
 * Returns support tickets visible to agents (excludes SYSTEM-channel tickets).
 * Optional query params: ?ticketId=xxx for single ticket detail.
 */
export const GET = withAgent(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const ticketId = url.searchParams.get('ticketId');

    // Single ticket detail mode
    if (ticketId) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: ticketId },
        include: {
          messages: {
            where: { isInternal: false }, // Hide internal admin notes from agents
            orderBy: { createdAt: 'asc' },
            include: {
              sender: { select: { fullName: true } },
            },
          },
        },
      });

      if (!ticket || ticket.channel === 'SYSTEM') {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

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
          airlinePnr: ticket.airlinePnr,
          customerName: ticket.customerName,
          customerEmail: ticket.customerEmail,
          customerPhone: ticket.customerPhone,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
          messages: (ticket as any).messages.map((m: any) => ({
            id: m.id,
            content: m.content,
            createdAt: m.createdAt,
            senderName: m.sender?.fullName || null,
          })),
        },
      });
    }

    // List mode — all non-SYSTEM tickets
    const tickets = await prisma.supportTicket.findMany({
      where: {
        channel: { not: 'SYSTEM' },
      },
      include: {
        _count: {
          select: {
            messages: { where: { isInternal: false } },
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
      customerName: t.customerName,
      customerEmail: t.customerEmail,
      customerPhone: t.customerPhone,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t._count.messages,
    }));

    return NextResponse.json({ tickets: formatted });
  } catch (err: any) {
    console.error('[agent/support-tickets] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
});
