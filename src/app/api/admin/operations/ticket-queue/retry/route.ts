import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/operations/ticket-queue/retry
 * Reset a reconciliation record to PENDING for immediate re-poll.
 */
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const { reconciliationId } = await req.json();
    if (!reconciliationId) {
      return NextResponse.json({ error: 'reconciliationId required' }, { status: 400 });
    }

    const record = await prisma.ticketingReconciliation.findUnique({
      where: { id: reconciliationId },
    });

    if (!record) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    await prisma.ticketingReconciliation.update({
      where: { id: reconciliationId },
      data: {
        status: 'PENDING',
        nextPollAt: new Date(), // Immediate
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Admin Operations] Retry error:', err.message);
    return NextResponse.json({ error: 'Retry failed' }, { status: 500 });
  }
}, 'SUPPORT');
