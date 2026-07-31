// Agent: own wallet history. GET /api/agent/wallet/history (withAgentServicing → own id).
import { NextResponse } from 'next/server';
import { withAgentServicing } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const GET = withAgentServicing(async (_req, { agent }) => {
  const history = await prisma.agentWalletHistory.findMany({
    where: { userId: agent.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const n = (d: any) => (d == null ? 0 : Number(d));
  return NextResponse.json({
    history: history.map((h) => ({
      id: h.id, eventType: h.eventType, amount: n(h.amount),
      remainingBefore: n(h.remainingBefore), remainingAfter: n(h.remainingAfter),
      reason: h.reason, bookingId: h.bookingId, createdAt: h.createdAt,
    })),
  });
});
