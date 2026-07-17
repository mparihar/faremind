import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { stripe } from '@/lib/stripe';

/**
 * POST /api/service-payments
 * Create a service payment + Stripe PaymentIntent.
 * Auth: session token (user or agent).
 *
 * GET /api/service-payments
 * List service payments for the logged-in user.
 */

async function getSessionUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true } } },
  });
  if (!session || !session.user || new Date(session.expiresAt) < new Date()) return null;
  return session.user;
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { bookingId, serviceType, description, amount, currency = 'USD', pnrCode, ticketNumber, notes } = body;

    if (!serviceType || !description || !amount || amount <= 0) {
      return NextResponse.json({ error: 'serviceType, description, and amount are required' }, { status: 400 });
    }

    const validTypes = ['CFAR', 'PRICE_DROP_PROTECTION', 'TRAVEL_INSURANCE', 'SEAT_CHANGE', 'DATE_CHANGE', 'BAGGAGE_CHANGE', 'UPGRADE', 'OTHER'];
    if (!validTypes.includes(serviceType)) {
      return NextResponse.json({ error: `Invalid serviceType. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    // If bookingId provided, verify it belongs to this user
    let booking: any = null;
    let resolvedPnr = pnrCode || null;
    let resolvedTicket = ticketNumber || null;
    if (bookingId) {
      booking = await prisma.masterBooking.findFirst({
        where: {
          id: bookingId,
          OR: [
            { userId: user.id },
            { customerEmail: { equals: user.email, mode: 'insensitive' } },
            { agentUserId: user.id },
          ],
        },
        include: {
          pnrs: { take: 1, select: { pnrCode: true } },
          tickets: { take: 1, select: { ticketNumber: true, eTicketNumber: true } },
        },
      });
      if (!booking) {
        return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });
      }
      // Auto-fill PNR and ticket if not provided
      if (!resolvedPnr && booking.pnrs[0]) resolvedPnr = booking.pnrs[0].pnrCode;
      if (!resolvedTicket && booking.tickets[0]) resolvedTicket = booking.tickets[0].ticketNumber || booking.tickets[0].eTicketNumber;
    }

    const isAgent = user.role === 'FAREMIND_AGENT';
    const amountInCents = Math.round(amount * 100);

    // Create Stripe PaymentIntent (auto-capture for service payments)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      description: `FAREMIND Service Payment: ${serviceType} — ${description}`,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: {
        booked_via: 'faremind',
        service_type: serviceType,
        booking_ref: booking?.masterBookingReference || '',
        pnr_code: resolvedPnr || '',
        ticket_number: resolvedTicket || '',
        customer_email: user.email,
      },
    });

    // Create ServicePayment record
    const payment = await prisma.servicePayment.create({
      data: {
        bookingId: bookingId || null,
        userId: user.id,
        serviceType: serviceType as any,
        description,
        amount,
        currency,
        status: 'PENDING',
        stripePaymentIntentId: paymentIntent.id,
        pnrCode: resolvedPnr,
        ticketNumber: resolvedTicket,
        customerEmail: user.email,
        customerName: `${user.firstName} ${user.lastName}`.trim(),
        customerPhone: user.phone || null,
        requestedBy: isAgent ? 'AGENT' : 'USER',
        notes: notes || null,
      },
    });

    return NextResponse.json({
      paymentId: payment.id,
      clientSecret: paymentIntent.client_secret,
      stripePaymentIntentId: paymentIntent.id,
    });
  } catch (err: any) {
    console.error('[POST /api/service-payments]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payments = await prisma.servicePayment.findMany({
      where: {
        OR: [
          { userId: user.id },
          { customerEmail: { equals: user.email, mode: 'insensitive' } },
        ],
      },
      include: {
        booking: {
          select: {
            masterBookingReference: true,
            originAirport: true,
            destinationAirport: true,
            departureDate: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ payments });
  } catch (err: any) {
    console.error('[GET /api/service-payments]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
