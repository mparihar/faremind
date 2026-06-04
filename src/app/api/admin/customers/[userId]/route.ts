import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';

/**
 * GET /api/admin/customers/[userId]
 * Get a single customer user with their bookings + sessions.
 */
export const GET = withAdmin(async (_req: NextRequest, { params }) => {
  const userId = params.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      phone: true, role: true, emailVerified: true, isActive: true,
      createdAt: true, updatedAt: true, lastLoginAt: true,
      masterBookings: {
        select: {
          id: true, masterBookingReference: true, masterPnr: true,
          bookingStatus: true, tripType: true,
          originAirport: true, destinationAirport: true,
          totalAmount: true, currency: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      sessions: {
        select: {
          id: true, ipAddress: true, userAgent: true,
          createdAt: true, expiresAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: {
        select: { masterBookings: true, sessions: true, searchHistory: true },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ user });
}, 'OPS_ADMIN');

/**
 * PATCH /api/admin/customers/[userId]
 * Toggle user active status (soft disable/enable).
 */
export const PATCH = withAdmin(async (req: NextRequest, { admin, params }) => {
  const userId = params.userId;
  const body = await req.json();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const data: any = {};
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive;

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, isActive: true },
  });

  await auditLog({
    adminUserId: admin.sub,
    action: body.isActive ? 'ENABLE_CUSTOMER' : 'DISABLE_CUSTOMER',
    entityType: 'User',
    entityId: userId,
    before: { isActive: user.isActive },
    after: { isActive: updated.isActive },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ user: updated });
}, 'OPS_ADMIN');

/**
 * DELETE /api/admin/customers/[userId]
 * Hard-delete a customer user and ALL associated data.
 * Only SUPER_ADMIN can perform this action.
 */
export const DELETE = withAdmin(async (req: NextRequest, { admin, params }) => {
  const userId = params.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Delete all user-related data in the correct order (child → parent)
  await prisma.$transaction(async (tx) => {
    // Get all booking IDs for this user
    const bookings = await tx.masterBooking.findMany({
      where: { userId },
      select: { id: true },
    });
    const bookingIds = bookings.map(b => b.id);

    if (bookingIds.length > 0) {
      // Delete booking children in dependency order
      await tx.bookingEvent.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingProviderPayload.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingPayment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingAddon.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingBaggage.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingMeal.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingSeat.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingTicket.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingPassenger.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingPnr.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingSegment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingJourney.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingRefund.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await tx.bookingNote.deleteMany({ where: { bookingId: { in: bookingIds } } });

      // Try optional tables that might not exist
      try { await tx.bookingCommercialCharge.deleteMany({ where: { bookingId: { in: bookingIds } } }); } catch {}
      try { await tx.cancellation.deleteMany({ where: { bookingId: { in: bookingIds } } }); } catch {}
      try { await tx.changeRequest.deleteMany({ where: { bookingId: { in: bookingIds } } }); } catch {}
      try { await tx.bookingPassengerUpdate.deleteMany({ where: { bookingId: { in: bookingIds } } }); } catch {}
      try { await tx.bookingOfferSession.deleteMany({ where: { bookingId: { in: bookingIds } } }); } catch {}

      // Delete master bookings
      await tx.masterBooking.deleteMany({ where: { userId } });
    }

    // Delete user-level data
    try { await (tx as any).travelDnaProfile.deleteMany({ where: { userId } }); } catch {}
    try { await (tx as any).travelDnaPreference.deleteMany({ where: { userId } }); } catch {}
    await tx.session.deleteMany({ where: { userId } });
    try { await tx.searchHistory.deleteMany({ where: { userId } }); } catch {}
    try { await tx.savedRoute.deleteMany({ where: { userId } }); } catch {}
    try { await tx.priceAlert.deleteMany({ where: { userId } }); } catch {}
    try { await tx.notification.deleteMany({ where: { userId } }); } catch {}

    // Delete the user
    await tx.user.delete({ where: { id: userId } });
  });

  await auditLog({
    adminUserId: admin.sub,
    action: 'DELETE_CUSTOMER',
    entityType: 'User',
    entityId: userId,
    before: { email: user.email, name: `${user.firstName} ${user.lastName}` },
    ipAddress: req.headers.get('x-forwarded-for') ?? undefined,
  });

  return NextResponse.json({ success: true });
}, 'SUPER_ADMIN');
