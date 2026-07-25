// Admin: single agent wallet — detail (GET) + actions (POST).
// GET  /api/admin/wallets/:userId          → summary + recent history
// POST /api/admin/wallets/:userId          → { action, amount?, reason? }
//   action: recharge | adjust | enable | disable | reset
// RBAC: view SUPPORT+, mutations FINANCE+, reset SUPER_ADMIN.
import { NextResponse } from 'next/server';
import { withAdmin, hasRole } from '@/lib/admin-rbac';
import { auditLog } from '@/lib/admin-auth';
import { prisma } from '@/lib/db';

export const GET = withAdmin(async (_req, { params }) => {
  const userId = params.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, isActive: true, role: true } });
  if (!user || user.role !== 'FAREMIND_AGENT') return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const wallet = await prisma.agentWallet.findUnique({ where: { userId } });
  const history = await prisma.agentWalletHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const n = (d: any) => (d == null ? 0 : Number(d));
  const walletAmount = wallet ? n(wallet.walletAmount) : 0;
  const utilized = wallet ? n(wallet.utilizedAmount) : 0;

  return NextResponse.json({
    agent: { userId: user.id, agentName: `${user.firstName} ${user.lastName}`.trim() || user.email, agentEmail: user.email, privilegeEnabled: user.isActive },
    wallet: wallet ? {
      walletAmount, utilized, remaining: Math.round((walletAmount - utilized) * 100) / 100,
      currency: wallet.currency, status: wallet.status, totalBookings: wallet.totalBookings,
      totalBookingValue: n(wallet.totalBookingValue), lastRechargeAt: wallet.lastRechargeAt, lastNotificationAt: wallet.lastNotificationAt,
    } : null,
    history: history.map((h) => ({ id: h.id, eventType: h.eventType, amount: n(h.amount), remainingBefore: n(h.remainingBefore), remainingAfter: n(h.remainingAfter), reason: h.reason, actor: h.actor, bookingId: h.bookingId, createdAt: h.createdAt })),
  });
}, 'SUPPORT');

export const POST = withAdmin(async (req, { admin, params }) => {
  const userId = params.userId;
  const body = await req.json().catch(() => ({}));
  const { action, amount, reason } = body as { action?: string; amount?: number; reason?: string };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== 'FAREMIND_AGENT') return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  if (action === 'reset' && !hasRole(admin.role, 'SUPER_ADMIN')) {
    return NextResponse.json({ error: 'Only a Super Admin can reset the utilized amount.' }, { status: 403 });
  }

  if (!['recharge', 'adjust', 'enable', 'disable', 'reset'].includes(action || '')) {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  const actor = admin.email;
  const BACKEND = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  try {
    const res = await fetch(`${BACKEND}/api/agent-wallet/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action, amount, reason, actor }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return NextResponse.json({ error: data.error || 'Wallet action failed.' }, { status: res.status || 400 });
    }
    await auditLog({ adminUserId: admin.sub, action: `WALLET_${(action as string).toUpperCase()}`, entityType: 'AgentWallet', entityId: userId, after: { amount, reason, wallet: data.wallet } }).catch(() => {});
    return NextResponse.json({ success: true, action, wallet: data.wallet });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Wallet action failed.' }, { status: 502 });
  }
}, 'FINANCE');
