// FILE: src/app/api/admin/bookings/[id]/force-cancel/route.ts
// Admin "Force Cancel + Refund" — for refundable tickets where the auto-quote could
// not confirm a trustworthy refund. Runs provider execute (PTR) → Stripe refund →
// status via the backend orchestrator, optionally with a staff-confirmed amount.
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export const POST = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const { overrideRefundAmount, refundMethod, reason } = body || {};

    const booking = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true, bookingStatus: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

    const res = await fetch(`${BACKEND_URL}/api/manage-booking/${booking.id}/force-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overrideRefundAmount: typeof overrideRefundAmount === 'number' ? overrideRefundAmount : undefined,
        refundMethod: refundMethod || 'ORIGINAL_PAYMENT',
        requestedBy: admin.email,
        role: 'ADMIN',
      }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`[Admin][ForceCancel] admin=${admin.email} bookingRef=${booking.masterBookingReference} httpStatus=${res.status} success=${data?.success} refundAmount=${data?.refundAmount ?? data?.netRefundAmount ?? 'n/a'}`);

    // Audit event (best-effort)
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'FORCE_CANCELLATION',
        eventTitle: 'Force Cancel + Refund triggered by admin',
        eventDescription: `Admin ${admin.email} triggered Force Cancel + Refund. Override refund: ${overrideRefundAmount ?? 'auto'}. Reason: ${reason || 'N/A'}. Result: ${res.ok ? 'success' : 'failed'}.`,
        actorType: 'admin',
        actorId: admin.sub,
        actorName: admin.email,
        payloadJson: { overrideRefundAmount: overrideRefundAmount ?? null, reason: reason ?? null, result: data },
      },
    }).catch(() => {});

    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (err: any) {
    console.error('[admin/force-cancel] Error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
