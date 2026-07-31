// Agent: own wallet summary. GET /api/agent/wallet (withAgentServicing → own id only).
import { NextResponse } from 'next/server';
import { withAgentServicing } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

export const GET = withAgentServicing(async (_req, { agent }) => {
  const cfgRows = await prisma.systemConfig.findMany({ where: { key: { in: ['wallet_default_balance', 'wallet_low_threshold', 'wallet_disable_threshold', 'wallet_currency'] } } });
  const cfg = new Map(cfgRows.map((r) => [r.key, r.value]));
  const defaultBalance = parseFloat(cfg.get('wallet_default_balance') || '3000');
  const lowThreshold = parseFloat(cfg.get('wallet_low_threshold') || '1000');
  const disableThreshold = parseFloat(cfg.get('wallet_disable_threshold') || '500');
  const currency = cfg.get('wallet_currency') || 'USD';

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: agent.id } });
  const n = (d: any) => (d == null ? 0 : Number(d));
  const walletAmount = wallet ? n(wallet.walletAmount) : defaultBalance;
  const utilized = wallet ? n(wallet.utilizedAmount) : 0;
  const remaining = Math.round((walletAmount - utilized) * 100) / 100;
  const status = wallet?.status || (remaining <= disableThreshold ? 'DISABLED' : remaining <= lowThreshold ? 'LOW' : 'HEALTHY');

  return NextResponse.json({
    walletAmount, utilized, remaining, currency,
    totalBookings: wallet?.totalBookings ?? 0,
    totalBookingValue: wallet ? n(wallet.totalBookingValue) : 0,
    status,
    lowThreshold, disableThreshold,
    lastRechargeAt: wallet?.lastRechargeAt ?? null,
  });
});
