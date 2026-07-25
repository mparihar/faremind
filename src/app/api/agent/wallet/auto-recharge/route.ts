/**
 * POST /api/agent/wallet/auto-recharge
 * Enable/disable or update the agent's auto-recharge settings (separate consent
 * from saving a card). Enabling requires a saved card on file + accepting terms.
 * This NEVER charges — it only records consent/config. Actual recharges happen
 * off-session after a balance dip (see lib/payments/auto-recharge.ts).
 *
 * Body: { enabled: boolean, termsAccepted?: boolean, amount?: number, target?: number }
 */
import { NextResponse } from 'next/server';
import { withAgentWalletAccess } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { getRechargePolicy } from '@/lib/payments/wallet-policy';

export const POST = withAgentWalletAccess(async (req, { agent }) => {
  const body = await req.json().catch(() => ({}));
  const enabled = !!(body as any).enabled;
  const termsAccepted = !!(body as any).termsAccepted;
  const policy = await getRechargePolicy();

  const wallet = await prisma.agentWallet.findUnique({ where: { userId: agent.id } });
  if (!wallet) return NextResponse.json({ error: 'Wallet not found. Please recharge first.' }, { status: 404 });

  if (enabled) {
    if (!policy.autoRechargeGloballyEnabled) return NextResponse.json({ error: 'Automatic recharge is currently unavailable.' }, { status: 400 });
    if (!wallet.defaultPaymentMethodId) return NextResponse.json({ error: 'Save a card first (recharge with "save card" enabled) to turn on auto-recharge.' }, { status: 400 });
    if (!termsAccepted) return NextResponse.json({ error: 'You must accept the auto-recharge terms.' }, { status: 400 });

    const amount = (body as any).amount != null ? Number((body as any).amount) : null;
    const target = (body as any).target != null ? Number((body as any).target) : null;
    await prisma.agentWallet.update({
      where: { id: wallet.id },
      data: {
        autoRechargeEnabled: true,
        autoRechargeConsentAt: new Date(),
        autoRechargeTermsVersion: policy.termsVersion,
        autoRechargeAmount: amount && amount > 0 ? amount : null,
        autoRechargeTarget: target && target > 0 ? target : null,
      },
    });
    return NextResponse.json({ success: true, enabled: true });
  }

  // Disable — keep the saved card, just stop auto-charging.
  await prisma.agentWallet.update({
    where: { id: wallet.id },
    data: { autoRechargeEnabled: false, autoRechargeConsentAt: null },
  });
  return NextResponse.json({ success: true, enabled: false });
});
