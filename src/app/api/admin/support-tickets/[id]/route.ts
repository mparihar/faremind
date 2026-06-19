import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const ticketId = params?.id;
    if (!ticketId) return NextResponse.json({ error: 'Missing ticket ID' }, { status: 400 });

    const target = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!target) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });

    const body = await req.json();
    const allowed = ['status', 'priority', 'assignedToId'];
    const update: any = {};

    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: update,
      include: { assignedTo: { select: { fullName: true, email: true } } },
    });

    await auditLog({
      adminUserId: admin.sub,
      action: 'UPDATE_SUPPORT_TICKET',
      entityType: 'SupportTicket',
      entityId: ticketId,
      after: update,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    // Check if ticket was assigned to a new user
    if (update.assignedToId && update.assignedToId !== target.assignedToId) {
      if (updated.assignedTo?.email) {
        import('@/lib/email')
          .then(m => m.sendTicketAssignedEmail(updated.assignedTo!.email, updated.assignedTo!.fullName, updated.id, updated.subject))
          .catch(e => console.error(e));
      }
    }

    return NextResponse.json({ ticket: updated });
  } catch (err: any) {
    console.error('[support-tickets/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 });
  }
}, 'SUPPORT');

export const GET = withAdmin(async (req: NextRequest, { params }: any) => {
  try {
    const ticketId = params?.id;
    if (!ticketId) return NextResponse.json({ error: 'Missing ticket ID' }, { status: 400 });

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true } },
        failureAudit: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { adminUser: { select: { fullName: true } } }
        }
      }
    });

    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    return NextResponse.json({ ticket });
  } catch (err: any) {
    console.error('[support-tickets/[id]] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch ticket' }, { status: 500 });
  }
}, 'SUPPORT');

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const ticketId = params?.id;
    if (!ticketId) return NextResponse.json({ error: 'Missing ticket ID' }, { status: 400 });

    await prisma.supportTicket.delete({ where: { id: ticketId } });

    await auditLog({
      adminUserId: admin.sub,
      action: 'DELETE_SUPPORT_TICKET',
      entityType: 'SupportTicket',
      entityId: ticketId,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[support-tickets/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete ticket' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
