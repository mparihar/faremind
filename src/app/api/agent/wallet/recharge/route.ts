/**
 * Agent wallet self-recharge via Stripe.
 *
 *   GET  /api/agent/wallet/recharge  → recharge info (policy, wallet, saved card, auto-recharge settings)
 *   POST /api/agent/wallet/recharge  → create an on-session PaymentIntent, return clientSecret
 *
 * Auth: withAgentWalletAccess — a WALLET-DISABLED agent may still recharge to
 * restore their wallet (the only surface they can reach while disabled).
 *
 * Money is credited to the wallet ONLY after the Stripe webhook confirms the
 * charge (see lib/payments/fulfill.ts). This route never credits the wallet.
 * Save-card and enable-auto-recharge are SEPARATE, explicit consents.
 */
import { NextResponse } from 'next/server';
import { withAgentWalletAccess } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { getRechargePolicy } from '@/lib/payments/wallet-policy';
import { createPayment } from '@/lib/payments/orchestrator';
import { assertPositiveAmount } from '@/lib/payments/money';

const n = (d: any) => (d == null ? 0 : Number(d));

export const GET = withAgentWalletAccess(async (_req, { agent }) => {
  const policy = await getRechargePolicy();
  const wallet = await prisma.agentWallet.findUnique({ where: { userId: agent.id } });
  const walletAmount = n(wallet?.walletAmount);
  const utilized = n(wallet?.utilizedAmount);
  const remaining = Math.round((walletAmount - utilized) * 100) / 100;

  return NextResponse.json({
    agent: { id: agent.id, name: agent.name, email: agent.email, active: agent.isActive !== false },
    policy: {
      currency: policy.currency,
      minimumRechargeAmount: policy.minimumRechargeAmount,
      lowThreshold: policy.lowThreshold,
      disableThreshold: policy.disableThreshold,
      reactivationThreshold: policy.reactivationThreshold,
      autoRechargeGloballyEnabled: policy.autoRechargeGloballyEnabled,
      automaticRechargeAmount: policy.automaticRechargeAmount,
      automaticRechargeTargetBalance: policy.automaticRechargeTargetBalance,
      termsVersion: policy.termsVersion,
    },
    wallet: {
      walletAmount, utilized, remaining, currency: wallet?.currency || policy.currency,
      status: wallet?.status || 'HEALTHY',
      savedCard: wallet?.defaultPaymentMethodId ? { present: true } : { present: false },
      autoRecharge: {
        enabled: !!wallet?.autoRechargeEnabled,
        amount: wallet?.autoRechargeAmount != null ? n(wallet.autoRechargeAmount) : null,
        target: wallet?.autoRechargeTarget != null ? n(wallet.autoRechargeTarget) : null,
        threshold: wallet?.autoRechargeThreshold != null ? n(wallet.autoRechargeThreshold) : null,
        consentAt: wallet?.autoRechargeConsentAt || null,
        termsVersion: wallet?.autoRechargeTermsVersion || null,
      },
      saveCardConsentAt: wallet?.saveCardConsentAt || null,
    },
  });
});

export const POST = withAgentWalletAccess(async (req, { agent }) => {
  const body = await req.json().catch(() => ({}));
  const rawAmount = (body as any).amount;
  const saveCard = !!(body as any).saveCard;
  const enableAutoRecharge = !!(body as any).enableAutoRecharge;
  const termsAccepted = !!(body as any).termsAccepted;

  const policy = await getRechargePolicy();

  // ── Validate amount server-side against the configured minimum ──
  let amount: number;
  try {
    amount = assertPositiveAmount(rawAmount, 'recharge amount');
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (amount < policy.minimumRechargeAmount) {
    return NextResponse.json({ error: `Minimum recharge is ${policy.currency} ${policy.minimumRechargeAmount}.` }, { status: 400 });
  }

  // Enabling auto-recharge requires saving the card AND accepting the terms.
  if (enableAutoRecharge && (!saveCard || !termsAccepted)) {
    return NextResponse.json({ error: 'Enabling auto-recharge requires saving your card and accepting the terms.' }, { status: 400 });
  }
  if (enableAutoRecharge && !policy.autoRechargeGloballyEnabled) {
    return NextResponse.json({ error: 'Automatic recharge is currently unavailable.' }, { status: 400 });
  }

  // ── Ensure wallet + Stripe customer ──
  let wallet = await prisma.agentWallet.findUnique({ where: { userId: agent.id } });
  if (!wallet) {
    wallet = await prisma.agentWallet.create({
      data: { userId: agent.id, walletAmount: 0, utilizedAmount: 0, currency: policy.currency, status: 'HEALTHY' },
    });
  }

  const stripe = getStripe();
  let stripeCustomerId = wallet.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: agent.email,
      name: agent.name,
      metadata: { faremind_user_id: agent.id, role: 'FAREMIND_AGENT' },
    });
    stripeCustomerId = customer.id;
    await prisma.agentWallet.update({ where: { id: wallet.id }, data: { stripeCustomerId } });
  }

  // Record consents (timestamps + terms version) BEFORE charging.
  const consentData: any = {};
  if (saveCard) consentData.saveCardConsentAt = new Date();
  if (enableAutoRecharge) {
    consentData.autoRechargeEnabled = true;
    consentData.autoRechargeConsentAt = new Date();
    consentData.autoRechargeTermsVersion = policy.termsVersion;
    if ((body as any).autoRechargeAmount != null) consentData.autoRechargeAmount = Number((body as any).autoRechargeAmount) || null;
    if ((body as any).autoRechargeTarget != null) consentData.autoRechargeTarget = Number((body as any).autoRechargeTarget) || null;
  }
  if (Object.keys(consentData).length) {
    await prisma.agentWallet.update({ where: { id: wallet.id }, data: consentData });
  }

  try {
    const result = await createPayment({
      purpose: 'AGENT_WALLET_RECHARGE',
      amount,
      currency: wallet.currency || policy.currency,
      serviceType: 'OTHER',
      description: `Agent wallet recharge — ${agent.email}`,
      userId: agent.id,
      agentId: agent.id,
      walletId: wallet.id,
      customerEmail: agent.email,
      customerName: agent.name,
      requestedBy: 'AGENT',
      notes: enableAutoRecharge ? 'Recharge with auto-recharge enabled' : (saveCard ? 'Recharge with card saved' : undefined),
      stripeCustomerId,
      savePaymentMethod: saveCard,
    });
    return NextResponse.json({ paymentId: result.paymentId, clientSecret: result.clientSecret, stripeCustomerId });
  } catch (e: any) {
    console.error('[agent/wallet/recharge] create failed:', e?.message);
    return NextResponse.json({ error: e?.message || 'Unable to start recharge.' }, { status: 500 });
  }
});
