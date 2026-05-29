import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { id, mealId } = params;
    if (!id || !mealId) return NextResponse.json({ error: 'Missing id or mealId' }, { status: 400 });

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true },
    });
    if (!mb) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const meal = await prisma.bookingMeal.findFirst({
      where: { id: mealId, bookingId: mb.id },
    });
    if (!meal) return NextResponse.json({ error: 'Meal not found' }, { status: 404 });

    const body = await req.json();
    const allowed = ['mealCode', 'mealLabel', 'mealStatus'];
    const update: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.bookingMeal.update({ where: { id: mealId }, data: update });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: mb.id,
      action: 'UPDATE_MEAL',
      entityType: 'BookingMeal',
      entityId: mealId,
      before: { mealCode: meal.mealCode, mealLabel: meal.mealLabel, mealStatus: meal.mealStatus },
      after: update,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: mb.id,
        eventType: 'MEAL_UPDATED',
        eventTitle: 'Meal Updated by Admin',
        eventDescription: `Meal ${meal.mealLabel} updated: ${Object.keys(update).join(', ')}`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
      },
    });

    return NextResponse.json({ success: true, meal: updated });
  } catch (err: any) {
    console.error('[admin/bookings/[id]/meals/[mealId]] PATCH error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { id, mealId } = params;
    if (!id || !mealId) return NextResponse.json({ error: 'Missing id or mealId' }, { status: 400 });

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true },
    });
    if (!mb) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const meal = await prisma.bookingMeal.findFirst({
      where: { id: mealId, bookingId: mb.id },
      include: { passenger: { select: { firstName: true, lastName: true } } },
    });
    if (!meal) return NextResponse.json({ error: 'Meal not found' }, { status: 404 });

    await prisma.bookingMeal.delete({ where: { id: mealId } });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: mb.id,
      action: 'DELETE_MEAL',
      entityType: 'BookingMeal',
      entityId: mealId,
      before: { mealLabel: meal.mealLabel, mealCode: meal.mealCode, passenger: meal.passenger },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId: mb.id,
        eventType: 'MEAL_DELETED',
        eventTitle: 'Meal Removed by Admin',
        eventDescription: `Meal ${meal.mealLabel} removed for ${meal.passenger.firstName} ${meal.passenger.lastName}`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[admin/bookings/[id]/meals/[mealId]] DELETE error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
