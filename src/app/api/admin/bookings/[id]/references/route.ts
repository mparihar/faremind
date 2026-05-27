import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

export const POST = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const bookingId = params?.id;
    const { pnrCode, pnrType, journeyDirection, isPrimary, provider, airlineCode, airlineName } = await req.json();

    if (!pnrCode) {
      return NextResponse.json({ error: 'pnrCode is required' }, { status: 400 });
    }

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id: bookingId }, { masterBookingReference: bookingId }] },
      select: { id: true },
    });
    if (!mb) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const pnr = await prisma.bookingPnr.create({
      data: {
        bookingId:        mb.id,
        pnrCode,
        pnrType:          pnrType ?? 'AIRLINE_PNR',
        journeyDirection: journeyDirection ?? 'ALL',
        isPrimary:        isPrimary ?? false,
        status:           'ACTIVE',
        provider:         provider ?? null,
        airlineCode:      airlineCode ?? null,
        airlineName:      airlineName ?? null,
        displayLabel:     pnrType === 'MASTER_AIRLINE_PNR' ? 'Full Trip PNR' : `PNR (${pnrCode})`,
      },
    });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        mb.id,
        eventType:        'PNR_ADDED',
        eventTitle:       'PNR Added',
        eventDescription: `${pnr.pnrType}: ${pnrCode} added by admin`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    return NextResponse.json({ success: true, pnr });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'OPS_ADMIN');
