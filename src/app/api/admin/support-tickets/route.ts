import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

// Support users and above can view the queue
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const category = url.searchParams.get('category');

    const where: Record<string, unknown> = {};
    if (category) where.category = category;

    const tickets = await prisma.supportTicket.findMany({
      where,
      include: {
        assignedTo: { select: { fullName: true, email: true } },
        failureAudit: true,
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formatted = tickets.map(t => ({
      ...t,
      assignedTo: t.assignedTo?.fullName ?? null,
      messageCount: t._count.messages,
    }));

    return NextResponse.json({ tickets: formatted });
  } catch (err: any) {
    console.error('[support-tickets] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
}, 'SUPPORT');

export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();
    
    // Minimal validation
    if (!body.subject || !body.description || !body.customerName || !body.customerEmail || !body.category) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        subject: body.subject,
        description: body.description,
        priority: body.priority || 'MEDIUM',
        status: 'OPEN',
        category: body.category,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        bookingRef: body.bookingRef || null,
      },
    });

    await auditLog({
      adminUserId: admin.sub,
      action: 'CREATE_SUPPORT_TICKET',
      entityType: 'SupportTicket',
      entityId: ticket.id,
      after: { subject: ticket.subject, status: ticket.status },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err: any) {
    console.error('[support-tickets] POST error:', err);
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
}, 'SUPPORT');

// Bulk delete by category (SUPER_ADMIN only)
export const DELETE = withAdmin(async (req: NextRequest, { admin }) => {
  try {
    const body = await req.json();
    const { category, ticketIds } = body as { category?: string; ticketIds?: string[] };

    if (!category && (!ticketIds || ticketIds.length === 0)) {
      return NextResponse.json({ error: 'Either category or ticketIds is required' }, { status: 400 });
    }

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (ticketIds && ticketIds.length > 0) where.id = { in: ticketIds };

    // Delete related messages first (foreign key constraint)
    await prisma.supportTicketMessage.deleteMany({
      where: { ticket: where },
    });

    const result = await prisma.supportTicket.deleteMany({ where });

    await auditLog({
      adminUserId: admin.sub,
      action: 'BULK_DELETE_SUPPORT_TICKETS',
      entityType: 'SupportTicket',
      entityId: category || 'bulk',
      after: { category, ticketIds, deletedCount: result.count },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, deletedCount: result.count });
  } catch (err: any) {
    console.error('[support-tickets] BULK DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete tickets' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
