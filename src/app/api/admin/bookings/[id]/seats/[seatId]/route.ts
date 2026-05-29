import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { id, seatId } = params;
    if (!id || !seatId) return NextResponse.json({ error: 'Missing id or seatId' }, { status: 400 });

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true },
    });
    if (!mb) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const seat = await prisma.bookingSeat.findFirst({
      where: { id: seatId, bookingId: mb.id },
    });
    if (!seat) return NextResponse.json({ error: 'Seat not found' }, { status: 404 });

    const body = await req.json();
    const allowed = ['seatNumber', 'seatType', 'seatStatus'];
    const update: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.bookingSeat.update({ where: { id: seatId }, data: update });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: mb.id,
      action: 'UPDATE_SEAT',
      entityType: 'BookingSeat',
      entityId: seatId,
      before: { seatNumber: seat.seatNumber, seatType: seat.seatType, seatStatus: seat.seatStatus },
      after: update,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: mb.id,
        eventType: 'SEAT_UPDATED',
        eventTitle: 'Seat Updated by Admin',
        eventDescription: `Seat ${seat.seatNumber} updated: ${Object.keys(update).join(', ')}`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
      },
    });

    return NextResponse.json({ success: true, seat: updated });
  } catch (err: any) {
    console.error('[admin/bookings/[id]/seats/[seatId]] PATCH error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { id, seatId } = params;
    if (!id || !seatId) return NextResponse.json({ error: 'Missing id or seatId' }, { status: 400 });

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true },
    });
    if (!mb) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const seat = await prisma.bookingSeat.findFirst({
      where: { id: seatId, bookingId: mb.id },
      include: { passenger: { select: { firstName: true, lastName: true } } },
    });
    if (!seat) return NextResponse.json({ error: 'Seat not found' }, { status: 404 });

    await prisma.bookingSeat.delete({ where: { id: seatId } });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: mb.id,
      action: 'DELETE_SEAT',
      entityType: 'BookingSeat',
      entityId: seatId,
      before: { seatNumber: seat.seatNumber, seatType: seat.seatType, passenger: seat.passenger },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: mb.id,
        eventType: 'SEAT_DELETED',
        eventTitle: 'Seat Removed by Admin',
        eventDescription: `Seat ${seat.seatNumber} removed for ${seat.passenger.firstName} ${seat.passenger.lastName}`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[admin/bookings/[id]/seats/[seatId]] DELETE error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
