import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/cleanup-stale-pending
 * One-time cleanup: marks all stale changeRequest and cancellationRecord
 * entries as resolved. Safe to run multiple times — only updates records
 * still in pending statuses.
 */
export const POST = withAdmin(async (_req: NextRequest) => {
  const [changesUpdated, cancelsUpdated] = await Promise.all([
    // Mark stale changeRequest records as EXPIRED (they were never actioned)
    prisma.changeRequest.updateMany({
      where: { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } },
      data: { status: 'EXPIRED' },
    }),
    // Mark stale cancellationRecord records as COMPLETED (cancellations already went through provider)
    prisma.cancellationRecord.updateMany({
      where: { status: { in: ['CANCEL_REQUESTED', 'IN_PROGRESS'] } },
      data: { status: 'COMPLETED' },
    }),
  ]);

  return NextResponse.json({
    success: true,
    cleaned: {
      changeRequests: changesUpdated.count,
      cancellationRecords: cancelsUpdated.count,
    },
    message: `Resolved ${changesUpdated.count} stale change requests and ${cancelsUpdated.count} stale cancellation records.`,
  });
}, 'OPS_ADMIN');
