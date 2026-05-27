import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

export const DELETE = withAdmin(async (_req: NextRequest, { admin, params }: any) => {
  try {
    const { addonId } = params;

    // Try each add-on table until we find the record
    const seat = await prisma.bookingSeat.findUnique({ where: { id: addonId } });
    if (seat) {
      await prisma.bookingSeat.delete({ where: { id: addonId } });
      await prisma.bookingEvent.create({
        data: {
          bookingId:        seat.bookingId,
          eventType:        'ADDON_DELETED',
          eventTitle:       'Seat Removed',
          eventDescription: `Seat ${seat.seatNumber} removed by admin`,
          actorType:        'admin',
          actorId:          admin.sub,
          actorName:        admin.email,
        },
      });
      return NextResponse.json({ success: true });
    }

    const meal = await prisma.bookingMeal.findUnique({ where: { id: addonId } });
    if (meal) {
      await prisma.bookingMeal.delete({ where: { id: addonId } });
      await prisma.bookingEvent.create({
        data: {
          bookingId:        meal.bookingId,
          eventType:        'ADDON_DELETED',
          eventTitle:       'Meal Removed',
          eventDescription: `Meal ${meal.mealLabel} removed by admin`,
          actorType:        'admin',
          actorId:          admin.sub,
          actorName:        admin.email,
        },
      });
      return NextResponse.json({ success: true });
    }

    const bag = await prisma.bookingBaggage.findUnique({ where: { id: addonId } });
    if (bag) {
      await prisma.bookingBaggage.delete({ where: { id: addonId } });
      await prisma.bookingEvent.create({
        data: {
          bookingId:        bag.bookingId,
          eventType:        'ADDON_DELETED',
          eventTitle:       'Baggage Removed',
          eventDescription: `${bag.quantity} checked bag(s) removed by admin`,
          actorType:        'admin',
          actorId:          admin.sub,
          actorName:        admin.email,
        },
      });
      return NextResponse.json({ success: true });
    }

    const addon = await prisma.bookingAddon.findUnique({ where: { id: addonId } });
    if (addon) {
      await prisma.bookingAddon.delete({ where: { id: addonId } });
      await prisma.bookingEvent.create({
        data: {
          bookingId:        addon.bookingId,
          eventType:        'ADDON_DELETED',
          eventTitle:       'Add-on Removed',
          eventDescription: `${addon.addonName} removed by admin`,
          actorType:        'admin',
          actorId:          admin.sub,
          actorName:        admin.email,
        },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'OPS_ADMIN');
