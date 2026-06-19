import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAdmin } from '@/lib/admin-rbac';

// GET — List all email logs (enriched with booking data provider)
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const template = url.searchParams.get('template');
    const search = url.searchParams.get('search');

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (template) where.template = template;
    if (search) {
      where.OR = [
        { recipient: { contains: search, mode: 'insensitive' } },
        { recipientName: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
        { bookingRef: { contains: search, mode: 'insensitive' } },
      ];
    }

    const emails = await prisma.emailLog.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: 200,
    });

    // Collect unique booking refs to look up their flight data provider
    const bookingRefs = [...new Set(emails.map(e => e.bookingRef).filter(Boolean))] as string[];
    const providerMap = new Map<string, string>();

    if (bookingRefs.length > 0) {
      // Look up in MasterBooking (new system — refs like FM5M9UOV)
      const masterBookings = await prisma.masterBooking.findMany({
        where: { masterBookingReference: { in: bookingRefs } },
        select: { masterBookingReference: true, primaryProvider: true },
      });
      for (const b of masterBookings) {
        providerMap.set(b.masterBookingReference, b.primaryProvider);
      }

      // For any refs not found in MasterBooking, look up in legacy Booking table
      const unresolvedRefs = bookingRefs.filter(r => !providerMap.has(r));
      if (unresolvedRefs.length > 0) {
        const legacyBookings = await prisma.booking.findMany({
          where: { id: { in: unresolvedRefs } },
          select: { id: true, provider: true },
        });
        for (const b of legacyBookings) {
          providerMap.set(b.id, b.provider);
        }
      }
    }

    // Replace the email-sender provider with the booking data provider
    const enriched = emails.map(e => ({
      ...e,
      provider: e.bookingRef ? (providerMap.get(e.bookingRef) ?? 'N/A') : 'N/A',
    }));

    return NextResponse.json({ emails: enriched });
  } catch (err: any) {
    console.error('[email-history] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch email history' }, { status: 500 });
  }
}, 'SUPPORT');

// DELETE — Bulk delete email logs within a date range
export const DELETE = withAdmin(async (req: NextRequest) => {
  try {
    const { from, to } = await req.json();
    if (!from || !to) {
      return NextResponse.json({ error: 'Missing "from" and "to" date range' }, { status: 400 });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    // Set toDate to end of day
    toDate.setHours(23, 59, 59, 999);

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
    }

    const result = await prisma.emailLog.deleteMany({
      where: {
        sentAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    });

    return NextResponse.json({ success: true, deletedCount: result.count });
  } catch (err: any) {
    console.error('[email-history] DELETE error:', err);
    return NextResponse.json({ error: 'Failed to delete email logs' }, { status: 500 });
  }
}, 'SUPER_ADMIN');
