/**
 * Monthly agent commission settlement — listed, and decided, by an admin.
 *
 * GET  what each agent is owed for a period, and what was already decided.
 * POST pay (optionally at a corrected amount) or withhold, with a reason.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { fireNotification } from '@/lib/notify';
import { auditLog } from '@/lib/admin-auth';
import { getPayoutAccountState, getPlatformBalance, PLATFORM_COUNTRY } from '@/lib/finance/stripe-connect';
import {
  agentsDueForPeriod, payAgentCommission, rejectAgentCommission,
} from '@/lib/finance/agent-commission-payout';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number.isFinite(n) ? n : 0);

/** The calculated figure, whichever branch produced the decision. */
function systemAmountFor(r: { outcome: string; paidAmount?: number }): number {
  return typeof r.paidAmount === 'number' ? r.paidAmount : 0;
}

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

  // Whether each agent can actually receive a platform transfer. Offering the
  // option and failing afterwards is worse than not offering it: by then the
  // admin believes they have paid.
  const withPayoutState = await Promise.all(agents.map(async (a) => ({
    ...a,
    payoutAccount: await getPayoutAccountState(a.agentUserId),
  })));

  // Transfers come from the Stripe balance, not from a bank account. Shown
  // alongside what is owed so the admin can choose platform or external
  // transfer knowingly, rather than by clicking Pay and failing.
  const balance = await getPlatformBalance();

  const totalDue = agents.reduce((s, a) => s + (a.payout ? 0 : a.dueAmount), 0);
  const totalPaid = agents.reduce((s, a) => s + (a.payout?.status === 'PAID' ? a.payout.paidAmount : 0), 0);

  return NextResponse.json({
    period,
    agents: withPayoutState,
    platformCountry: PLATFORM_COUNTRY,
    balance,
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
  const { agentUserId, action, amount, reason, method, paymentReference, paidOn } = body ?? {};

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
        method: method === 'STRIPE_CONNECT' ? 'STRIPE_CONNECT' : 'EXTERNAL_TRANSFER',
        paymentReference,
        paidOn: paidOn ? new Date(paidOn) : null,
      })
    : await rejectAgentCommission({ agentUserId, period, reason: String(reason ?? ''), decidedBy });

  if (result.outcome === 'INVALID') return NextResponse.json({ error: result.error }, { status: 400 });
  if (result.outcome === 'NOTHING_DUE') {
    return NextResponse.json({ error: 'There is nothing outstanding for this agent in this period.' }, { status: 400 });
  }
  if (result.outcome === 'TRANSFER_FAILED') {
    // Nothing was recorded, so the month is still payable — say so, or the
    // admin assumes it half-happened and is afraid to retry.
    return NextResponse.json(
      { error: `${result.error} Nothing was recorded — this period is still payable.` },
      { status: 502 },
    );
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

  // Tell the agent, and tell finance. Money moving — or deliberately not
  // moving — without anyone being told is how an agent first learns about a
  // withheld payout by noticing it missing from their bank.
  const agent = await prisma.user.findUnique({
    where: { id: agentUserId },
    select: { email: true, firstName: true, lastName: true },
  }).catch(() => null);

  if (agent) {
    const agentName = `${agent.firstName ?? ''} ${agent.lastName ?? ''}`.trim() || 'Agent';
    await fireNotification({
      event_type: action === 'PAY' ? 'COMMISSION_PAID' : 'COMMISSION_WITHHELD',
      // The agent is the direct recipient of a commission email, so they ride
      // the customer channel; finance and support get the admin copy.
      customer_email: agent.email,
      data: {
        agent_email: agent.email,
        agent_name: agentName,
        customer_name: agentName,   // the agent IS the recipient here
        period: `${MONTH_NAMES[period.month - 1]} ${period.year}`,
        paid_amount: result.outcome === 'PAID' ? fmtUsd(result.paidAmount) : fmtUsd(0),
        system_amount: fmtUsd(systemAmountFor(result)),
        entry_count: result.outcome === 'PAID' ? result.entriesSettled : null,
        reason: reason ?? null,
        decided_by: decidedBy,
      },
    }).catch((e) => console.warn(`[CommissionPayout] notification failed: ${e.message}`));
  }

  return NextResponse.json(result);
}, 'FINANCE');
