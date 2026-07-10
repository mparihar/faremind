import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/operations/ticket-queue
 * Returns all ticketing reconciliation records for the admin queue view.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const records = await prisma.ticketingReconciliation.findMany({
      include: {
        booking: {
          select: {
            masterBookingReference: true,
            customerEmail: true,
            customerName: true,
            totalAmount: true,
            currency: true,
            primaryProvider: true,
          },
        },
      },
      orderBy: [
        { status: 'asc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    });

    return NextResponse.json({ records });
  } catch (err: any) {
    console.error('[Admin Operations] Ticket queue error:', err.message);
    return NextResponse.json({ error: 'Failed to load ticket queue' }, { status: 500 });
  }
}, 'SUPPORT');

/**
 * POST /api/admin/operations/ticket-queue
 * Handles admin actions: retry and resolve.
 */
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'retry') {
      const { reconciliationId } = body;
      if (!reconciliationId) {
        return NextResponse.json({ error: 'reconciliationId required' }, { status: 400 });
      }

      // Reset to PENDING for immediate re-poll
      await prisma.ticketingReconciliation.update({
        where: { id: reconciliationId },
        data: {
          status: 'PENDING',
          nextPollAt: new Date(),
        },
      });

      return NextResponse.json({ success: true });
    }

    if (action === 'resolve') {
      const { reconciliationId, resolution, ticketNumbers, notes } = body;
      if (!reconciliationId || !resolution) {
        return NextResponse.json({ error: 'reconciliationId and resolution required' }, { status: 400 });
      }

      const now = new Date();
      const record = await prisma.ticketingReconciliation.findUnique({
        where: { id: reconciliationId },
      });

      if (!record) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }

      // Update reconciliation
      await prisma.ticketingReconciliation.update({
        where: { id: reconciliationId },
        data: {
          status: resolution === 'TICKETED' ? 'TICKETED' : 
                  resolution === 'NOT_BOOKED' ? 'NOT_BOOKED' : 'RESOLVED',
          ticketNumbers: ticketNumbers || [],
          resolvedAt: now,
          resolvedBy: 'admin',
          resolutionNotes: notes || `Manually resolved as ${resolution}`,
        },
      });

      // Update MasterBooking
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

      // Log event
      await prisma.bookingEvent.create({
        data: {
          bookingId: record.bookingId,
          eventType: 'TICKETING_MANUALLY_RESOLVED',
          eventTitle: `Ticketing Resolved: ${resolution}`,
          eventDescription: notes || `Resolved as ${resolution} by admin`,
          actorType: 'admin',
          actorName: 'Admin',
          payloadJson: { resolution, ticketNumbers, reconciliationId },
        },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    console.error('[Admin Operations] Ticket queue action error:', err.message);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}, 'SUPPORT');
