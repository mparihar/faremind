import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (_req: NextRequest, { params }) => {
  const id = params?.id;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      passengers: true,
      segments: { orderBy: { segmentOrder: 'asc' } },
      payments: { orderBy: { createdAt: 'desc' } },
      priceHistory: { take: 20, orderBy: { checkedAt: 'desc' } },
      rebookings: { orderBy: { createdAt: 'desc' } },
      notifications: { take: 10, orderBy: { createdAt: 'desc' } },
    },
  });

  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [addons, tickets, events, notes, changeRequests, cancellation, providerSync] = await Promise.all([
    prisma.bookingAddon.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.bookingTicket.findMany({ where: { bookingId: id } }),
    prisma.bookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } }),
    prisma.supportNote.findMany({
      where: { bookingId: id },
      include: { adminUser: { select: { fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.changeRequest.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.cancellationRecord.findFirst({ where: { bookingId: id } }),
    prisma.providerSync.findFirst({ where: { bookingId: id }, orderBy: { createdAt: 'desc' } }),
  ]);

  return NextResponse.json({ booking, addons, tickets, events, notes, changeRequests, cancellation, providerSync });
}, 'READ_ONLY');
