import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

const EDITABLE = [
  'firstName', 'middleName', 'lastName', 'email', 'phone', 'gender',
  'dateOfBirth', 'nationality', 'passportCountry', 'passportNumber', 'passportExpiry',
];

export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { paxId } = params;

    const before = await prisma.bookingPassenger.findUnique({ where: { id: paxId } });
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const update: any = {};
    for (const key of EDITABLE) {
      if (body[key] !== undefined) {
        update[key] = (key === 'dateOfBirth' || key === 'passportExpiry') && body[key]
          ? new Date(body[key])
          : (body[key] === '' ? null : body[key]);
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    }

    const pax = await prisma.bookingPassenger.update({ where: { id: paxId }, data: update });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        pax.bookingId,
        eventType:        'PASSENGER_UPDATED',
        eventTitle:       'Passenger Updated',
        eventDescription: `${pax.firstName} ${pax.lastName} updated by admin. Fields: ${Object.keys(update).join(', ')}`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: pax.bookingId,
      action: 'UPDATE_PASSENGER',
      entityType: 'BookingPassenger',
      entityId: paxId,
      before: Object.fromEntries(Object.keys(update).map(k => [k, (before as any)[k]])),
      after: update,
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true, passenger: pax });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'OPS_ADMIN');

export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const { paxId } = params;
    const pax = await prisma.bookingPassenger.findUnique({ where: { id: paxId } });
    if (!pax) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.bookingPassenger.delete({ where: { id: paxId } });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        pax.bookingId,
        eventType:        'PASSENGER_DELETED',
        eventTitle:       'Passenger Removed',
        eventDescription: `${pax.firstName} ${pax.lastName} removed by admin`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: pax.bookingId,
      action: 'DELETE_PASSENGER',
      entityType: 'BookingPassenger',
      entityId: paxId,
      before: { firstName: pax.firstName, lastName: pax.lastName, email: pax.email },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'OPS_ADMIN');

