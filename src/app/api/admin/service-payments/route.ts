import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/service-payments
 * Admin endpoint to list all service payments with filters.
 * Returns PNR, Ticket#, customer info, Stripe PI.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const serviceType = url.searchParams.get('serviceType');
    const q = url.searchParams.get('q')?.trim();
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    const where: any = {};
    if (status && status !== 'ALL') where.status = status;
    if (serviceType && serviceType !== 'ALL') where.serviceType = serviceType;
    if (q) {
      where.OR = [
        { customerEmail: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { pnrCode: { contains: q, mode: 'insensitive' } },
        { ticketNumber: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    const payments = await prisma.servicePayment.findMany({
      where,
      include: {
        booking: {
          select: {
            masterBookingReference: true,
            originAirport: true,
            destinationAirport: true,
            departureDate: true,
            customerEmail: true,
            customerName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });

    const summary = {
      total: payments.length,
      succeeded: payments.filter(p => p.status === 'SUCCEEDED').length,
      pending: payments.filter(p => p.status === 'PENDING').length,
      failed: payments.filter(p => p.status === 'FAILED').length,
      totalAmount: payments.filter(p => p.status === 'SUCCEEDED').reduce((s, p) => s + Number(p.amount), 0),
    };

    return NextResponse.json({ payments, summary });
  } catch (err: any) {
    console.error('[GET /api/admin/service-payments]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}, 'SUPPORT');
