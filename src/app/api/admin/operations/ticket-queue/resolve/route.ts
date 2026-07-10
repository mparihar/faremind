import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/operations/ticket-queue/resolve
 * Manually resolve a ticketing reconciliation record.
 */
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const { reconciliationId, resolution, ticketNumbers, notes } = await req.json();

    if (!reconciliationId || !resolution) {
      return NextResponse.json({ error: 'reconciliationId and resolution required' }, { status: 400 });
    }

    if (!['TICKETED', 'NOT_BOOKED', 'RESOLVED'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution. Use TICKETED, NOT_BOOKED, or RESOLVED' }, { status: 400 });
    }

    const now = new Date();
    const record = await prisma.ticketingReconciliation.findUnique({
      where: { id: reconciliationId },
    });

    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Update reconciliation record
    const reconStatus = resolution === 'TICKETED' ? 'TICKETED'
      : resolution === 'NOT_BOOKED' ? 'NOT_BOOKED'
      : 'RESOLVED';

    await prisma.ticketingReconciliation.update({
      where: { id: reconciliationId },
      data: {
        status: reconStatus,
        ticketNumbers: ticketNumbers || [],
        resolvedAt: now,
        resolvedBy: 'admin',
        resolutionNotes: notes || `Manually resolved as ${resolution}`,
      },
    });

    // Update MasterBooking status
    if (resolution === 'TICKETED') {
      await prisma.masterBooking.update({
        where: { id: record.bookingId },
        data: {
          bookingStatus: 'TICKETED',
          ticketingStatus: 'ISSUED',
        },
      });
    } else if (resolution === 'NOT_BOOKED') {
      await prisma.masterBooking.update({
        where: { id: record.bookingId },
        data: {
          bookingStatus: 'NOT_BOOKED',
          ticketingStatus: 'FAILED',
        },
      });
    }

    // Log timeline event
    await prisma.bookingEvent.create({
      data: {
        bookingId: record.bookingId,
        eventType: 'TICKETING_MANUALLY_RESOLVED',
        eventTitle: `Ticketing Resolved: ${resolution}`,
        eventDescription: notes || `Manually resolved as ${resolution} by admin`,
        actorType: 'admin',
        actorName: 'Admin',
        payloadJson: { resolution, ticketNumbers, reconciliationId },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Admin Operations] Resolve error:', err.message);
    return NextResponse.json({ error: 'Resolve failed' }, { status: 500 });
  }
}, 'SUPPORT');
