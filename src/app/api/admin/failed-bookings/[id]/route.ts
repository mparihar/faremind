import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const bookingId = params?.id;
    if (!bookingId) return NextResponse.json({ error: 'Missing booking ID' }, { status: 400 });

    const target = await prisma.bookingFailureAudit.findUnique({
      where: { id: bookingId },
    });
    if (!target) return NextResponse.json({ error: 'Failed booking not found' }, { status: 404 });

    const body = await req.json();
    const allowed = ['status', 'assignedToId', 'resolutionNotes'];
    const update: any = {};

    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    if (update.status === 'RESOLVED' && target.status !== 'RESOLVED') {
      update.resolvedAt = new Date();
      update.resolvedBy = admin.email;
    }

    if (update.status === 'CLOSED') {
      // Ensure only SUPER_ADMIN or ADMIN can close it
      if (!['SUPER_ADMIN', 'ADMIN'].includes(admin.role)) {
         return NextResponse.json({ error: 'Only Admins or Super Admins can CLOSE an issue.' }, { status: 403 });
      }
    }

    const updated = await prisma.bookingFailureAudit.update({
      where: { id: bookingId },
      data: update,
      include: { assignedTo: { select: { fullName: true, email: true } } },
    });

    await auditLog({
      adminUserId: admin.sub,
      action: 'UPDATE_FAILED_BOOKING',
      entityType: 'BookingFailureAudit',
      entityId: bookingId,
      after: update,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    // Email Triggers
    import('@/lib/email').then(async m => {
      // 1. Send Assignment Email
      if (update.assignedToId && update.assignedToId !== target.assignedToId) {
        if (updated.assignedTo?.email) {
          await m.sendFailedBookingAssignedEmail(updated.assignedTo.email, updated.assignedTo.fullName, updated.id, updated.customerName);
        }
      }

      // 2. Send Resolution Email to Admins/Super Admins
      if (update.status === 'RESOLVED' && target.status !== 'RESOLVED') {
        const admins = await prisma.adminUser.findMany({
          where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true },
          select: { email: true, fullName: true }
        });
        const emails = admins.map(a => ({ email: a.email, name: a.fullName }));
        await m.sendFailedBookingResolvedEmail(emails, updated.id, admin.fullName || admin.email);
      }
    }).catch(e => console.error(e));

    return NextResponse.json({ booking: updated });
  } catch (err: any) {
    console.error('[failed-bookings/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Failed to update booking failure' }, { status: 500 });
  }
}, 'SUPPORT'); // Support can access, but logic inside restricts CLOSED state

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const bookingId = params?.id;
    if (!bookingId) return NextResponse.json({ error: 'Missing booking ID' }, { status: 400 });

    await prisma.bookingFailureAudit.delete({ where: { id: bookingId } });

    await auditLog({
      adminUserId: admin.sub,
      action: 'DELETE_FAILED_BOOKING',
      entityType: 'BookingFailureAudit',
      entityId: bookingId,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, deletedId: bookingId });
  } catch (err: any) {
    console.error('[failed-bookings/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete booking failure' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
