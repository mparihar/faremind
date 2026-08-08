/**
 * Monthly agent commission settlement — listed, and decided, by an admin.
 *
 * GET  what each agent is owed for a period, and what was already decided.
 * POST pay (optionally at a corrected amount) or withhold, with a reason.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { auditLog } from '@/lib/admin-auth';
import {
  agentsDueForPeriod, payAgentCommission, rejectAgentCommission,
} from '@/lib/finance/agent-commission-payout';

function readPeriod(searchParams: URLSearchParams) {
  const now = new Date();
  const year = Number(searchParams.get('year')) || now.getFullYear();
  const month = Number(searchParams.get('month')) || now.getMonth() + 1;
  return { year, month: Math.min(12, Math.max(1, month)) };
}

export const GET = withAdmin(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const period = readPeriod(searchParams);
  const agents = await agentsDueForPeriod(period);

  const totalDue = agents.reduce((s, a) => s + (a.payout ? 0 : a.dueAmount), 0);
  const totalPaid = agents.reduce((s, a) => s + (a.payout?.status === 'PAID' ? a.payout.paidAmount : 0), 0);

  return NextResponse.json({
    period,
    agents,
    summary: {
      agents: agents.length,
      awaitingDecision: agents.filter(a => !a.payout).length,
      totalDue: Math.round(totalDue * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
    },
  });
}, 'FINANCE');

export const POST = withAdmin(async (req: NextRequest, { admin }) => {
  const body = await req.json().catch(() => ({}));
  const { agentUserId, action, amount, reason } = body ?? {};

  if (!agentUserId || (action !== 'PAY' && action !== 'REJECT')) {
    return NextResponse.json({ error: 'agentUserId and action (PAY | REJECT) are required.' }, { status: 400 });
  }

  const period = {
    year: Number(body.year) || new Date().getFullYear(),
    month: Math.min(12, Math.max(1, Number(body.month) || new Date().getMonth() + 1)),
  };
  const decidedBy = admin?.email ?? null;

  const result = action === 'PAY'
    ? await payAgentCommission({
        agentUserId, period,
        // Undefined means "pay exactly what the ledger says"; an explicit number
        // is a correction and the service will require a reason for it.
        amountOverride: amount === '' || amount == null ? null : Number(amount),
        reason, decidedBy,
      })
    : await rejectAgentCommission({ agentUserId, period, reason: String(reason ?? ''), decidedBy });

  if (result.outcome === 'INVALID') return NextResponse.json({ error: result.error }, { status: 400 });
  if (result.outcome === 'NOTHING_DUE') {
    return NextResponse.json({ error: 'There is nothing outstanding for this agent in this period.' }, { status: 400 });
  }
  if (result.outcome === 'ALREADY_DECIDED') {
    return NextResponse.json(
      { error: `This period was already settled (${result.status}).`, ...result },
      { status: 409 },
    );
  }

  await auditLog({
    adminUserId: admin?.sub,
    action: action === 'PAY' ? 'COMMISSION_PAID' : 'COMMISSION_WITHHELD',
    entityType: 'AgentCommissionPayout',
    entityId: result.payoutId,
    after: { agentUserId, period, ...result },
    metadata: { reason: reason ?? null },
  }).catch(() => {});

  return NextResponse.json(result);
}, 'FINANCE');
