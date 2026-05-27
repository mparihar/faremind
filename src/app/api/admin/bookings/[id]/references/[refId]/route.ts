import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

export const DELETE = withAdmin(async (_req: NextRequest, { admin, params }: any) => {
  try {
    const { refId } = params;
    const pnr = await prisma.bookingPnr.findUnique({ where: { id: refId } });
    if (!pnr) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (pnr.isPrimary) return NextResponse.json({ error: 'Cannot delete the primary PNR' }, { status: 400 });

    await prisma.bookingPnr.delete({ where: { id: refId } });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        pnr.bookingId,
        eventType:        'PNR_DELETED',
        eventTitle:       'PNR Removed',
        eventDescription: `${pnr.pnrType}: ${pnr.pnrCode} removed by admin`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}, 'OPS_ADMIN');
