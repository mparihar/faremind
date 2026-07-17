import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/user/refunds
 * Returns refund/cancellation records for the logged-in user's bookings.
 * Includes CancellationRecord, BookingRefund, PNR details, and related support tickets.
 * Works for both cancelled bookings WITH and WITHOUT CancellationRecords.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!session || !session.user || new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    const userId = session.user.id;
    const userEmail = session.user.email;

    // Fetch ALL cancelled bookings with full details
    const bookings = await prisma.masterBooking.findMany({
      where: {
        OR: [
          { userId },
          { customerEmail: { equals: userEmail, mode: 'insensitive' } },
        ],
        bookingStatus: 'CANCELLED',
      },
      include: {
        cancellations: {
          include: {
            refunds: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        journeys: {
          select: {
            originAirport: true,
            destinationAirport: true,
            originCity: true,
            destinationCity: true,
            journeyDirection: true,
            journeyStatus: true,
          },
        },
        pnrs: {
          select: {
            id: true,
            pnrCode: true,
            pnrType: true,
            journeyDirection: true,
            isPrimary: true,
            status: true,
            airlineCode: true,
            airlineName: true,
            refundable: true,
            cancellationFee: true,
            displayLabel: true,
          },
        },
        segments: {
          select: {
            departureAirport: true,
            arrivalAirport: true,
            airlineName: true,
            airlineCode: true,
            flightNumber: true,
            departureTime: true,
            arrivalTime: true,
            segmentStatus: true,
          },
          orderBy: { departureTime: 'asc' },
        },
        payments: {
          where: { status: 'SUCCEEDED' },
          select: {
            amount: true,
            currency: true,
            method: true,
            stripePaymentIntentId: true,
          },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // Fetch related support tickets for these bookings
    const bookingRefs = bookings.map(b => b.masterBookingReference).filter(Boolean);
    const supportTickets = bookingRefs.length > 0
      ? await prisma.supportTicket.findMany({
          where: {
            bookingRef: { in: bookingRefs },
          },
          select: {
            id: true,
            ticketNumber: true,
            sequenceNumber: true,
            status: true,
            subject: true,
            category: true,
            channel: true,
            bookingRef: true,
          },
        })
      : [];

    const ticketsByRef: Record<string, typeof supportTickets> = {};
    for (const t of supportTickets) {
      if (t.bookingRef) {
        if (!ticketsByRef[t.bookingRef]) ticketsByRef[t.bookingRef] = [];
        ticketsByRef[t.bookingRef].push(t);
      }
    }

    // Format response
    const refunds = bookings.map(b => {
      const cancel = b.cancellations[0] || null;
      const refundRecords = cancel?.refunds || [];
      const journey = b.journeys[0];
      const primaryPnr = b.pnrs.find(p => p.isPrimary) || b.pnrs[0];
      const allTickets = ticketsByRef[b.masterBookingReference] || [];

      // Separate customer-visible vs system tickets
      const customerTickets = allTickets.filter(t => t.channel !== 'SYSTEM');
      const systemTickets = allTickets.filter(t => t.channel === 'SYSTEM');

      // Determine overall refund status
      let refundStatus = 'PENDING';
      if (cancel) {
        if (cancel.status === 'REFUNDED') refundStatus = 'COMPLETED';
        else if (cancel.status === 'REFUND_PENDING') refundStatus = 'PROCESSING';
        else if (cancel.status === 'FAILED') refundStatus = 'FAILED';
        else if (cancel.status === 'CANCELLED') refundStatus = 'PROCESSING';
        else refundStatus = 'PENDING';
      }

      // Override with BookingRefund status for more granularity
      if (refundRecords.length > 0) {
        const latest = refundRecords[0]; // already ordered by createdAt desc
        if (latest.status === 'COMPLETED') refundStatus = 'COMPLETED';
        else if (latest.status === 'FAILED') refundStatus = 'FAILED';
        else if (latest.status === 'PROCESSING') refundStatus = 'PROCESSING';
        else if (latest.status === 'PARTIAL') refundStatus = 'PARTIAL';
        else if (latest.status === 'INITIATED') refundStatus = 'PROCESSING';
      }

      // If no cancellation record but booking is CANCELLED — still show it
      const refundAmount = cancel?.refundAmount ? Number(cancel.refundAmount) : 0;
      const originalAmount = cancel?.originalAmount ? Number(cancel.originalAmount) : Number(b.totalAmount);

      return {
        bookingId: b.id,
        bookingRef: b.masterBookingReference,
        masterPnr: b.masterPnr,

        // PNR details — all PNRs with their individual data
        pnrs: b.pnrs.map(p => ({
          id: p.id,
          pnrCode: p.pnrCode,
          direction: p.journeyDirection,
          isPrimary: p.isPrimary,
          status: p.status,
          airlineCode: p.airlineCode,
          airlineName: p.airlineName,
          refundable: p.refundable,
          cancellationFee: p.cancellationFee ? Number(p.cancellationFee) : null,
          displayLabel: p.displayLabel,
        })),

        // Primary PNR for quick display
        primaryPnrCode: primaryPnr?.pnrCode || b.masterPnr,
        isRefundable: primaryPnr?.refundable ?? false,

        // Route info
        origin: journey?.originAirport || b.originAirport,
        originCity: journey?.originCity || b.originCity,
        destination: journey?.destinationAirport || b.destinationAirport,
        destinationCity: journey?.destinationCity || b.destinationCity,
        departureDate: b.departureDate,
        tripType: b.tripType,

        // Segments for detail view
        segments: b.segments.map(s => ({
          flight: `${s.airlineCode || ''}${s.flightNumber || ''}`.trim(),
          airlineName: s.airlineName,
          from: s.departureAirport,
          to: s.arrivalAirport,
          departureTime: s.departureTime,
          arrivalTime: s.arrivalTime,
          status: s.segmentStatus,
        })),

        // Financial
        totalAmount: Number(b.totalAmount),
        currency: b.currency,
        paymentStatus: b.paymentStatus,
        ticketingStatus: b.ticketingStatus,

        // Cancellation details
        hasCancellationRecord: !!cancel,
        cancellationStatus: cancel?.status || null,
        originalAmount,
        penaltyAmount: cancel?.penaltyAmount ? Number(cancel.penaltyAmount) : 0,
        airlinePenalty: cancel?.airlinePenalty ? Number(cancel.airlinePenalty) : 0,
        refundAmount,
        refundMethod: cancel?.refundMethod || null,
        creditAmount: cancel?.creditAmount ? Number(cancel.creditAmount) : null,
        creditExpiresAt: cancel?.creditExpiresAt || null,
        cancelledAt: cancel?.cancelledAt || cancel?.createdAt || b.updatedAt,
        refundedAt: cancel?.refundedAt || null,
        failedAt: cancel?.failedAt || null,
        failureReason: cancel?.failureReason || null,
        notes: cancel?.notes || null,
        stripeRefundId: cancel?.stripeRefundId || null,

        // Overall status
        refundStatus,

        // Refund records (BookingRefund entries)
        refundRecords: refundRecords.map(r => ({
          id: r.id,
          amount: Number(r.amount),
          currency: r.currency,
          method: r.method,
          status: r.status,
          stripeRefundId: r.stripeRefundId,
          processingDays: r.processingDays,
          initiatedAt: r.initiatedAt,
          completedAt: r.completedAt,
          failedAt: r.failedAt,
          failureReason: r.failureReason,
        })),

        // Support tickets — only customer-visible ones
        supportTickets: customerTickets.map(t => ({
          id: t.id,
          ticketNumber: t.ticketNumber || (t.sequenceNumber ? `FM-TKT-${String(t.sequenceNumber).padStart(4, '0')}` : t.id.slice(-6).toUpperCase()),
          status: t.status,
          subject: t.subject,
          category: t.category,
        })),

        // Whether there's an internal system ticket (for admin visibility, don't expose details to user)
        hasSystemTicket: systemTickets.length > 0,

        // Payment method
        paymentMethod: b.payments[0]?.method || null,
      };
    });

    // Summary counts
    const pending = refunds.filter(r => ['PENDING', 'PROCESSING'].includes(r.refundStatus)).length;
    const completed = refunds.filter(r => r.refundStatus === 'COMPLETED').length;
    const failed = refunds.filter(r => r.refundStatus === 'FAILED').length;
    const noRefund = refunds.filter(r => r.refundAmount === 0 && !r.isRefundable).length;

    return NextResponse.json({
      refunds,
      summary: {
        total: refunds.length,
        pending,
        completed,
        failed,
        noRefund,
        totalRefundable: refunds.reduce((s, r) => s + r.refundAmount, 0),
        totalRefunded: refunds.filter(r => r.refundStatus === 'COMPLETED').reduce((s, r) => s + r.refundAmount, 0),
      },
    });
  } catch (err: any) {
    console.error('[GET /api/user/refunds]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
