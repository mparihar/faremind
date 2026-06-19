import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const POST = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const ticketId = params?.id;
    if (!ticketId) return NextResponse.json({ error: 'Missing ticket ID' }, { status: 400 });

    const body = await req.json();
    if (!body.message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

    const isInternal = Boolean(body.isInternal);

    const message = await prisma.supportTicketMessage.create({
      data: {
        ticketId,
        adminUserId: admin.sub,
        message: body.message,
        isInternal,
      },
      include: { adminUser: { select: { fullName: true } } }
    });

    // Update ticket's updatedAt timestamp
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() }
    });

    await auditLog({
      adminUserId: admin.sub,
      action: 'ADD_TICKET_MESSAGE',
      entityType: 'SupportTicket',
      entityId: ticketId,
      after: { messageId: message.id, isInternal },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ message });
  } catch (err: any) {
    console.error('[support-tickets/[id]/messages] POST error:', err);
    return NextResponse.json({ error: 'Failed to add message' }, { status: 500 });
  }
}, 'SUPPORT');
