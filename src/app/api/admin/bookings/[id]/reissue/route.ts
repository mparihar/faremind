// FILE: src/app/api/admin/bookings/[id]/reissue/route.ts
// Admin "Reissue + Collect Difference" — quotes the reissue (mode:'quote') or executes
// it (charge customer's card → provider reissue) via the backend orchestrator.
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export const POST = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { newFareSourceCode, mode, reason } = body || {};
    if (!newFareSourceCode) return NextResponse.json({ error: 'newFareSourceCode is required' }, { status: 400 });
    const isQuoteOnly = mode === 'quote';

    const booking = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true, bookingStatus: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const res = await fetch(`${BACKEND_URL}/api/manage-booking/${booking.id}/reissue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newFareSourceCode, mode, requestedBy: admin.email, role: 'ADMIN' }),
    });
    const data = await res.json().catch(() => ({}));

    if (isQuoteOnly) return NextResponse.json(data, { status: res.ok ? 200 : res.status });

    console.log(`[Admin][Reissue] admin=${admin.email} bookingRef=${booking.masterBookingReference} httpStatus=${res.status} success=${data?.success} collected=${data?.collected ?? 'n/a'} ptr=${data?.ptrNumber ?? 'n/a'}`);

    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'REISSUE',
        eventTitle: 'Reissue + Collect Difference triggered by admin',
        eventDescription: `Admin ${admin.email} triggered a reissue. Collected: ${data?.collected ?? '—'} USD. PTR: ${data?.ptrNumber ?? '—'}. Reason: ${reason || 'N/A'}. Result: ${res.ok ? 'success' : 'failed'}.`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
        payloadJson: { newFareSourceCode, reason: reason ?? null, result: data },
      },
    }).catch(() => {});

    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err: any) {
    console.error('[admin/reissue] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
