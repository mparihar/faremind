// Admin: Agent Wallet dashboard list.
// GET /api/admin/wallets — every FAREMIND_AGENT with wallet balance, utilization,
// status, and privilege. RBAC via withAdmin (SUPPORT+ to view).
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';

const POLICY_KEYS = ['wallet_default_balance', 'wallet_low_threshold', 'wallet_disable_threshold', 'wallet_currency'];

export const GET = withAdmin(async (req) => {
  const { searchParams } = new URL(req.url);
  const search = (searchParams.get('search') || '').trim();
  const status = searchParams.get('status') || ''; // HEALTHY | LOW | DISABLED

  const cfgRows = await prisma.systemConfig.findMany({ where: { key: { in: POLICY_KEYS } } });
  const cfg = new Map(cfgRows.map((r) => [r.key, r.value]));
  const policy = {
    defaultBalance: parseFloat(cfg.get('wallet_default_balance') || '3000'),
    lowThreshold: parseFloat(cfg.get('wallet_low_threshold') || '1000'),
    disableThreshold: parseFloat(cfg.get('wallet_disable_threshold') || '500'),
    currency: cfg.get('wallet_currency') || 'USD',
  };

  const agents = await prisma.user.findMany({
    where: {
      role: 'FAREMIND_AGENT',
      ...(search ? { OR: [{ email: { contains: search, mode: 'insensitive' } }, { firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] } : {}),
    },
    select: {
      id: true, email: true, firstName: true, lastName: true, isActive: true,
      agentWallet: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const n = (d: any) => (d == null ? 0 : Number(d));
  const rows = agents.map((a) => {
    const w = a.agentWallet;
    const walletAmount = w ? n(w.walletAmount) : policy.defaultBalance;
    const utilized = w ? n(w.utilizedAmount) : 0;
    const remaining = Math.round((walletAmount - utilized) * 100) / 100;
    const walletStatus = w?.status || (remaining <= policy.disableThreshold ? 'DISABLED' : remaining <= policy.lowThreshold ? 'LOW' : 'HEALTHY');
    return {
      userId: a.id,
      agentName: `${a.firstName} ${a.lastName}`.trim() || a.email,
      agentEmail: a.email,
      walletAmount, utilized, remaining,
      currency: w?.currency || policy.currency,
      totalBookings: w?.totalBookings ?? 0,
      totalBookingValue: w ? n(w.totalBookingValue) : 0,
      walletStatus,
      privilegeEnabled: a.isActive,
      lastRechargeAt: w?.lastRechargeAt ?? null,
      lastNotificationAt: w?.lastNotificationAt ?? null,
      hasWallet: !!w,
    };
  });

  const filtered = status ? rows.filter((r) => r.walletStatus === status) : rows;
  return NextResponse.json({ policy, wallets: filtered, total: filtered.length });
}, 'SUPPORT');
