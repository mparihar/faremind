import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * Admin Finance — Ledger API
 * Returns LedgerEntry records with optional type filter.
 * NEW API — does not modify any existing routes.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');

  const where: any = {};
  if (type && type !== 'ALL') {
    where.type = type;
  }

  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return NextResponse.json({
    entries: entries.map(e => ({
      id: e.id,
      type: e.type,
      bookingId: e.bookingId,
      amount: Number(e.amount),
      currency: e.currency,
      description: e.description,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}, 'FINANCE');
