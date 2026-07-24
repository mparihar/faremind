import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';
import { fireNotification } from '@/lib/notify';
import { auditLog } from '@/lib/admin-auth';

const FULL_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  pnrs: { orderBy: { createdAt: 'asc' as const } },
  journeys: {
    include: {
      segments: { orderBy: { segmentOrder: 'asc' as const } },
    },
    orderBy: { journeyOrder: 'asc' as const },
  },
  passengers: { orderBy: { passengerOrder: 'asc' as const } },
  tickets: {
    include: { passenger: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  seats: {
    include: {
      passenger: { select: { firstName: true, lastName: true } },
      segment: { select: { originAirport: true, destinationAirport: true, flightNumber: true } },
    },
  },
  meals: {
    include: {
      passenger: { select: { firstName: true, lastName: true } },
      segment:   { select: { originAirport: true, destinationAirport: true, flightNumber: true, airlineCode: true } },
      journey:   {
        select: {
          direction: true,
          segments: {
            select: { originAirport: true, destinationAirport: true, flightNumber: true, airlineCode: true },
            orderBy: { segmentOrder: 'asc' as const },
          },
        },
      },
    },
  },
  baggage: true,
  addons: { orderBy: { createdAt: 'asc' as const } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
  notes: {
    include: { createdBy: { select: { fullName: true, role: true } } },
    orderBy: { createdAt: 'desc' as const },
  },
  providerPayloads: { orderBy: { createdAt: 'desc' as const } },
  scheduleChange: true,
} as const;

async function resolve(idOrRef: string) {
  // 1. By cuid
  let mb: any = await prisma.masterBooking.findUnique({
    where: { id: idOrRef },
    include: FULL_INCLUDE,
  });
  if (mb) return mb;

  // 2. By masterBookingReference
  mb = await prisma.masterBooking.findUnique({
    where: { masterBookingReference: idOrRef },
    include: FULL_INCLUDE,
  });
  if (mb) return mb;

  // 3. By masterPnr
  mb = await prisma.masterBooking.findFirst({
    where: { masterPnr: { equals: idOrRef, mode: 'insensitive' } },
    include: FULL_INCLUDE,
  });
  if (mb) return mb;

  // 4. By any BookingPnr code
  const pnrRow = await prisma.bookingPnr.findFirst({
    where: { pnrCode: { equals: idOrRef, mode: 'insensitive' } },
    select: { bookingId: true },
  });
  if (pnrRow) {
    mb = await prisma.masterBooking.findUnique({
      where: { id: pnrRow.bookingId },
      include: FULL_INCLUDE,
    });
  }
  return mb ?? null;
}

export const GET = withAdmin(async (_req: NextRequest, { params }: any) => {
  try {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const mb = await resolve(id);
  if (!mb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Flatten segments across all journeys
  const allSegments = mb.journeys.flatMap((j: any) =>
    j.segments.map((seg: any) => ({
      id:           seg.id,
      depAirport:   seg.originAirport,
      depTime:      seg.departureDateTime,
      depTerminal:  seg.originTerminal,
      arrAirport:   seg.destinationAirport,
      arrTime:      seg.arrivalDateTime,
      arrTerminal:  seg.destinationTerminal,
      airlineCode:  seg.airlineCode,
      airlineName:  seg.airlineName,
      flightNumber: seg.flightNumber,
      duration:     seg.durationMinutes,
      aircraft:     seg.aircraftType,
      direction:    seg.direction,
      layoverAfterMinutes: seg.layoverAfterMinutes,
    }))
  );

  const outJourney = mb.journeys.find((j: any) => j.direction === 'OUTBOUND');
  const retJourney = mb.journeys.find((j: any) => j.direction === 'RETURN');
  const totalDuration = mb.journeys.reduce((s: number, j: any) => s + (j.totalDurationMinutes ?? 0), 0);
  const primaryAirlineCode = allSegments[0]?.airlineCode ?? 'XX';
  const primaryAirlineName = outJourney?.primaryAirline ?? allSegments[0]?.airlineName ?? 'Unknown';

  // Normalize booking to match admin page field names
  const booking = {
    id:                 mb.id,
    masterBookingReference: mb.masterBookingReference,
    pnr:                mb.masterPnr ?? mb.masterBookingReference,
    status:             mb.bookingStatus,
    customerEmail:      mb.customerEmail,
    customerName:       mb.customerName,
    originAirport:      mb.originAirport,
    originCity:         mb.originCity,
    destinationAirport: mb.destinationAirport,
    destinationCity:    mb.destinationCity,
    departureTime:      mb.departureDate,
    returnDate:         mb.returnDate ?? null,
    arrivalTime:        outJourney?.arrivalDateTime ?? mb.departureDate,
    totalDuration,
    stops:              outJourney?.totalStops ?? 0,
    cabinClass:         allSegments[0]?.cabin ?? outJourney?.cabinSummary?.toUpperCase() ?? 'ECONOMY',
    fareClass:          allSegments[0]?.fareClass ?? null,
    airlineCode:        primaryAirlineCode,
    airlineName:        primaryAirlineName,
    provider:           mb.primaryProvider,
    providerBookingId:  null,
    totalPrice:         Number(mb.totalAmount),
    taxes:              mb.pnrs.reduce((s: number, p: any) => s + Number(p.taxes ?? 0), 0),
    platformFee:        mb.pnrs.reduce((s: number, p: any) => s + Number(p.platformFee ?? 0), 0),
    currency:           mb.currency,
    refundable:         false,
    changeable:         false,
    cancellationFee:    null,
    changeFee:          null,
    carryOnBags:        1,
    checkedBags:        mb.baggage.reduce((s: number, b: any) => s + b.quantity, 0),
    tripType:           mb.tripType,
    paymentStatus:      mb.paymentStatus,
    ticketingStatus:    mb.ticketingStatus,
    user: mb.user ?? null,
    segments: allSegments,
    passengers: mb.passengers.map((p: any) => ({
      id:              p.id,
      firstName:       p.firstName,
      middleName:      p.middleName,
      lastName:        p.lastName,
      email:           p.email,
      phone:           p.phone,
      gender:          p.gender,
      dateOfBirth:     p.dateOfBirth,
      nationality:     p.nationality,
      passportNumber:  p.passportNumber,
      passportExpiry:  p.passportExpiry,
      issuingCountry:  p.passportCountry,
      type:            p.passengerType.toUpperCase(),
    })),
    payments: mb.payments.map((p: any) => ({
      id:                p.id,
      stripePaymentId:   p.stripePaymentIntentId,
      type:              'BOOKING',
      amount:            Number(p.amount),
      currency:          p.currency,
      paymentMethodType: p.paymentMethodType ?? null,
      cardLast4:         p.cardLast4 ?? null,
      status:            p.status,
      paidAt:            p.paidAt ?? null,
      refundedAmount:    null,
      createdAt:         p.createdAt,
    })),
    pnrStrategy:         mb.pnrStrategy ?? null,
    isSplitTicket:       mb.isSplitTicket,
    connectionProtStatus: mb.connectionProtStatus,
    riskLabel:           mb.riskLabel ?? null,
    riskExplanation:     mb.riskExplanation ?? null,
    pnrs: mb.pnrs.map((p: any) => ({
      id:               p.id,
      pnrCode:          p.pnrCode,
      pnrType:          p.pnrType,
      journeyDirection: p.journeyDirection,
      isPrimary:        p.isPrimary,
      status:           p.status,
      provider:         p.provider,
      airlineCode:      p.airlineCode,
      airlineName:      p.airlineName,
      displayLabel:     p.displayLabel,
      providerOrderId:  p.providerOrderId,
    })),
    journeys: mb.journeys,
    returnJourney: retJourney ?? null,
    createdAt: mb.createdAt,
    updatedAt: mb.updatedAt,
  };

  // Addons: seats + meals + baggage + addons
  const addons = [
    ...mb.seats.map((s: any) => ({
      id:            s.id,
      type:          'SEAT',
      passengerName: `${s.passenger.firstName} ${s.passenger.lastName}`,
      description:   `Seat ${s.seatNumber} — ${s.passenger.firstName} ${s.passenger.lastName}`,
      segmentRef:    s.segment ? `${s.segment.originAirport}→${s.segment.destinationAirport} ${s.segment.flightNumber}` : null,
      seatNumber:    s.seatNumber,
      seatType:      s.seatType ?? null,
      zone:          s.zone ?? null,
      quantity:      1,
      unitPrice:     Number(s.seatPrice),
      totalPrice:    Number(s.seatPrice),
      currency:      s.currency,
    })),
    ...(() => {
      // Group meals by passengerId+journeyId to match each meal to its journey segment by index
      const mealsByPaxJourney = new Map<string, number>();
      return mb.meals.map((m: any) => {
        const fmtSeg = (seg: any) =>
          `${seg.originAirport}→${seg.destinationAirport} ${seg.airlineCode ?? ''}${seg.flightNumber ?? ''}`.trim();

        let segmentRef: string | null = null;
        if (m.segment) {
          segmentRef = fmtSeg(m.segment);
        } else if (m.journey?.segments?.length) {
          // Match meal to a journey segment by index within same passenger+journey
          const key = `${m.passengerId}:${m.journeyId}`;
          const idx = mealsByPaxJourney.get(key) ?? 0;
          mealsByPaxJourney.set(key, idx + 1);
          const seg = m.journey.segments[idx] ?? m.journey.segments[0];
          segmentRef = fmtSeg(seg);
        }

        return {
          id:            m.id,
          type:          'MEAL',
          passengerName: `${m.passenger.firstName} ${m.passenger.lastName}`,
          description:   `${m.mealLabel} — ${m.passenger.firstName} ${m.passenger.lastName}`,
          mealCode:      m.mealCode ?? null,
          mealLabel:     m.mealLabel ?? null,
          segmentRef,
          seatNumber:    null,
          quantity:      1,
          unitPrice:     Number(m.mealPrice),
          totalPrice:    Number(m.mealPrice),
          currency:      m.currency,
        };
      });
    })(),
    ...mb.baggage.map((b: any) => ({
      id:          b.id,
      type:        'BAGGAGE',
      description: `${b.quantity} checked bag${b.quantity > 1 ? 's' : ''}`,
      segmentRef:  null,
      seatNumber:  null,
      quantity:    b.quantity,
      unitPrice:   Number(b.baggagePrice) / b.quantity,
      totalPrice:  Number(b.baggagePrice),
      currency:    b.currency,
    })),
    ...mb.addons.map((a: any) => ({
      id:          a.id,
      type:        a.addonType,
      description: a.addonName,
      segmentRef:  null,
      seatNumber:  null,
      quantity:    1,
      unitPrice:   Number(a.amount),
      totalPrice:  Number(a.amount),
      currency:    a.currency,
    })),
  ];

  const tickets = mb.tickets.map((t: any) => ({
    id:            t.id,
    ticketNumber:  t.ticketNumber ?? null,
    eTicketNumber: t.eTicketNumber ?? null,
    couponNumber:  t.couponNumber ?? null,
    airlineCode:   t.airlineCode ?? null,
    pnrReference:  t.pnrReference ?? null,
    status:        t.ticketStatus,
    issuedAt:      t.issuedAt ?? null,
    passenger:     t.passenger,
  }));

  const events = mb.events.map((ev: any) => ({
    id:          ev.id,
    title:       ev.eventTitle,
    description: ev.eventDescription,
    actorName:   ev.actorName,
    actorType:   ev.actorType,
    createdAt:   ev.createdAt,
  }));

  const notes = mb.notes.map((n: any) => ({
    id:         n.id,
    note:       n.noteText,
    isInternal: n.isInternal,
    createdAt:  n.createdAt,
    adminUser:  n.createdBy ?? null,
  }));

  return NextResponse.json({
    booking,
    addons,
    tickets,
    events,
    notes,
    providerPayloads: mb.providerPayloads,
    providerSync: null,
  });
  } catch (err: any) {
    console.error('[admin/bookings/[id]] GET error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'READ_ONLY');

// ── PATCH — update booking status fields ─────────────────────────────────────
export const PATCH = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, bookingStatus: true, paymentStatus: true, ticketingStatus: true,
                masterPnr: true, masterBookingReference: true, customerEmail: true,
                customerName: true, originAirport: true, destinationAirport: true },
    });
    if (!mb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = await req.json();
    const allowed = ['bookingStatus', 'paymentStatus', 'ticketingStatus', 'masterPnr', 'customerEmail', 'customerName'];
    const update: any = {};
    for (const key of allowed) {
      if (body[key] !== undefined) update[key] = body[key];
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.masterBooking.update({ where: { id: mb.id }, data: update });

    await prisma.bookingEvent.create({
      data: {
        bookingId:        mb.id,
        eventType:        'BOOKING_UPDATED',
        eventTitle:       'Booking Updated by Admin',
        eventDescription: `Fields updated: ${Object.keys(update).join(', ')}`,
        actorType:        'admin',
        actorId:          admin.sub,
        actorName:        admin.email,
      },
    });

    // Fire email notification when booking or payment status changes
    const newStatus = update.bookingStatus ?? update.paymentStatus;
    const statusActuallyChanged = !update.bookingStatus || update.bookingStatus !== mb.bookingStatus;
    if (newStatus && statusActuallyChanged) {
      const eventType = update.bookingStatus === 'CANCELLED' ? 'BOOKING_CANCELLED'
        : update.bookingStatus === 'CONFIRMED' ? 'BOOKING_CONFIRMED'
        : 'BOOKING_UPDATED';
      
      // Build notification data with refund details for cancellations
      const notifyData: Record<string, unknown> = {
        booking_reference: mb.masterBookingReference,
        pnr: mb.masterPnr ?? mb.masterBookingReference,
        customer_name: mb.customerName ?? '',
        customer_email: mb.customerEmail ?? '',
        origin: mb.originAirport,
        destination: mb.destinationAirport,
        route: `${mb.originAirport} - ${mb.destinationAirport}`,
        updated_by: admin.email,
        updated_fields: Object.keys(update).join(', '),
        new_status: newStatus,
      };

      // Add refund info for cancellations
      if (eventType === 'BOOKING_CANCELLED') {
        const totalAmt = Number((updated as any).totalAmount || 0);
        notifyData.refund_amount = body.refundAmount ? `$${Number(body.refundAmount).toLocaleString()}` : (totalAmt > 0 ? `$${totalAmt.toLocaleString()}` : 'Non-refundable');
        notifyData.refund_status = body.refundStatus || 'Pending';
        notifyData.cancellation_reason = body.cancellationReason || 'Cancelled by admin';
        notifyData.refund_policy = 'Refund will be processed within 5–10 business days';
      }

      fireNotification({
        event_type: eventType,
        booking_id: mb.id,
        customer_email: mb.customerEmail || undefined,
        data: notifyData,
      }).catch(err => console.error(`[admin/bookings] ${eventType} notification error:`, err instanceof Error ? err.message : err));
    }

    return NextResponse.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error('[admin/bookings/[id]] PATCH error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');

// ── DELETE — permanently remove booking ──────────────────────────────────────
export const DELETE = withAdmin(async (req: NextRequest, { admin, params }: any) => {
  try {
    const id = params?.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const mb = await prisma.masterBooking.findFirst({
      where: { OR: [{ id }, { masterBookingReference: id }] },
      select: { id: true, masterBookingReference: true, customerEmail: true, customerName: true,
                originAirport: true, destinationAirport: true, bookingStatus: true,
                totalAmount: true, currency: true },
    });
    if (!mb) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Cascading deletes handle all child records (FK onDelete: Cascade)
    await prisma.masterBooking.delete({ where: { id: mb.id } });

    await auditLog({
      adminUserId: admin.sub,
      bookingId: mb.id,
      action: 'DELETE_BOOKING',
      entityType: 'MasterBooking',
      entityId: mb.masterBookingReference,
      before: {
        masterBookingReference: mb.masterBookingReference,
        customerEmail: mb.customerEmail,
        customerName: mb.customerName,
        route: `${mb.originAirport} → ${mb.destinationAirport}`,
        status: mb.bookingStatus,
        totalAmount: Number(mb.totalAmount),
        currency: mb.currency,
      },
      ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
    });

    console.info(`[admin] Booking ${mb.masterBookingReference} deleted by admin ${admin.email}`);
    return NextResponse.json({ success: true, deleted: mb.masterBookingReference });
  } catch (err: any) {
    console.error('[admin/bookings/[id]] DELETE error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}, 'OPS_ADMIN');
