import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * Admin Reports API
 * Returns aggregated sales/revenue data for the reports dashboard.
 * NEW API — does not modify any existing routes.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '30d';

  // Calculate date filter
  const now = new Date();
  let dateFilter: any = {};
  if (period === '7d') dateFilter = { gte: new Date(now.getTime() - 7 * 86400000) };
  else if (period === '30d') dateFilter = { gte: new Date(now.getTime() - 30 * 86400000) };
  else if (period === '90d') dateFilter = { gte: new Date(now.getTime() - 90 * 86400000) };

  const where: any = dateFilter.gte ? { createdAt: dateFilter } : {};

  // Run queries in parallel
  const [
    totalAgg,
    byProvider,
    byStatus,
    bookings,
  ] = await Promise.all([
    // Total revenue and count
    prisma.masterBooking.aggregate({
      where,
      _sum: { totalAmount: true, fareMindRevenueTotal: true },
      _count: true,
    }),
    // By provider
    prisma.masterBooking.groupBy({
      by: ['primaryProvider'],
      where,
      _count: true,
      _sum: { totalAmount: true },
    }),
    // By status
    prisma.masterBooking.groupBy({
      by: ['bookingStatus'],
      where,
      _count: true,
    }),
    // Recent bookings for top routes + daily trend
    prisma.masterBooking.findMany({
      where,
      select: {
        originAirport: true,
        destinationAirport: true,
        totalAmount: true,
        createdAt: true,
        userId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  // Unique customers
  const uniqueCustomers = new Set(bookings.filter(b => b.userId).map(b => b.userId)).size;

  // Top routes
  const routeMap: Record<string, { count: number; revenue: number }> = {};
  for (const b of bookings) {
    const key = `${b.originAirport}→${b.destinationAirport}`;
    if (!routeMap[key]) routeMap[key] = { count: 0, revenue: 0 };
    routeMap[key].count++;
    routeMap[key].revenue += Number(b.totalAmount);
  }
  const topRoutes = Object.entries(routeMap)
    .map(([key, v]) => ({ origin: key.split('→')[0], destination: key.split('→')[1], ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Daily trend (last 7 days)
  const dayMap: Record<string, { bookings: number; revenue: number }> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const key = d.toISOString().split('T')[0];
    dayMap[key] = { bookings: 0, revenue: 0 };
  }
  for (const b of bookings) {
    const key = b.createdAt.toISOString().split('T')[0];
    if (dayMap[key]) {
      dayMap[key].bookings++;
      dayMap[key].revenue += Number(b.totalAmount);
    }
  }
  const dailyTrend = Object.entries(dayMap).map(([date, v]) => ({ date, ...v }));

  return NextResponse.json({
    totalBookings: totalAgg._count,
    totalRevenue: Number(totalAgg._sum.totalAmount || 0),
    totalMargin: Number(totalAgg._sum.fareMindRevenueTotal || 0),
    uniqueCustomers,
    byProvider: byProvider.map(p => ({
      provider: p.primaryProvider,
      count: p._count,
      revenue: Number(p._sum.totalAmount || 0),
    })),
    byStatus: byStatus.map(s => ({
      status: s.bookingStatus,
      count: s._count,
    })),
    topRoutes,
    dailyTrend,
  });
}, 'FINANCE');
