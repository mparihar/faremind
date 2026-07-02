// FILE: src/app/api/agent/bookings/[fbr]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const GET = withAgent(async (_req: NextRequest, { agent, params }) => {
  const fbr = params.fbr;

  const booking = await prisma.masterBooking.findFirst({
    where: {
      masterBookingReference: fbr,
      OR: [
        { agentUserId: agent.id },
        { userId: agent.id },
      ],
    },
    include: {
      pnrs: true,
      journeys: true,
      segments: { orderBy: { segmentOrder: 'asc' } },
      passengers: true,
      tickets: true,
      seats: true,
      meals: true,
      baggage: true,
      addons: true,
      payments: { select: { id: true, paymentMethodType: true, amount: true, currency: true, status: true, stripePaymentIntentId: true, cardLast4: true, createdAt: true } },
      events: { orderBy: { createdAt: 'desc' }, take: 20 },
      cancellations: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });
  }

  // Strip sensitive fields that agents should not see
  const { rawProviderPayload, providerCapabilities, ...safeBooking } = booking as any;

  return NextResponse.json({
    booking: {
      ...safeBooking,
      totalAmount: Number(safeBooking.totalAmount),
      providerPayableTotal: safeBooking.providerPayableTotal ? Number(safeBooking.providerPayableTotal) : null,
      markupAmount: undefined,          // Hide from agent
      serviceFeeAmount: undefined,      // Hide from agent
      fareMindRevenueTotal: undefined,  // Hide from agent
    },
  });
});
