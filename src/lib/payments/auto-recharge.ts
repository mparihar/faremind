/**
 * ═══════════════════════════════════════════════
 * FareMind — Agent Wallet Auto-Recharge (backend-triggered)
 * ═══════════════════════════════════════════════
 *
 * Called AFTER a wallet balance change (e.g. a booking utilization) to top the
 * wallet back up automatically when it dips to the trigger threshold — but only
 * when the agent has explicitly consented and a saved card is on file.
 *
 * Invariants:
 *   • Never triggered by the browser — server-only.
 *   • Requires explicit consent (autoRechargeConsentAt) + terms version.
 *   • Uses a per-wallet lock (autoRechargeInProgress) so concurrent bookings
 *     can't fire two recharges.
 *   • Charges OFF-SESSION against the saved Stripe customer + payment method.
 *   • The wallet is credited ONLY by the webhook after Stripe confirms.
 *   • Amounts/thresholds come from the wallet override or SystemConfig — never
 *     hard-coded.
 */
import { prisma } from '@/lib/db';
import { getRechargePolicy } from './wallet-policy';
import { createPayment } from './orchestrator';
import { assertPositiveAmount } from './money';

const n = (d: any) => (d == null ? 0 : Number(d));
const round2 = (x: number) => Math.round(x * 100) / 100;

export async function maybeAutoRecharge(agentId: string): Promise<{ triggered: boolean; reason?: string; amount?: number }> {
  try {
    const policy = await getRechargePolicy();
    if (!policy.autoRechargeGloballyEnabled) return { triggered: false, reason: 'globally_disabled' };

    const wallet = await prisma.agentWallet.findUnique({ where: { userId: agentId } });
    if (!wallet) return { triggered: false, reason: 'no_wallet' };
    if (!wallet.autoRechargeEnabled || !wallet.autoRechargeConsentAt) return { triggered: false, reason: 'not_consented' };
    if (!wallet.stripeCustomerId || !wallet.defaultPaymentMethodId) return { triggered: false, reason: 'no_saved_card' };
    if (wallet.autoRechargeInProgress) return { triggered: false, reason: 'in_progress' };

    const remaining = round2(n(wallet.walletAmount) - n(wallet.utilizedAmount));
    const threshold = wallet.autoRechargeThreshold != null ? n(wallet.autoRechargeThreshold) : policy.lowThreshold;
    if (remaining > threshold) return { triggered: false, reason: 'above_threshold' };

    // Top-up amount: bring balance to the target, at least the configured amount / minimum.
    const target = wallet.autoRechargeTarget != null ? n(wallet.autoRechargeTarget) : policy.automaticRechargeTargetBalance;
    const fixed = wallet.autoRechargeAmount != null ? n(wallet.autoRechargeAmount) : policy.automaticRechargeAmount;
    let amount = round2(Math.max(fixed, target - remaining, policy.minimumRechargeAmount));
    try { amount = assertPositiveAmount(amount, 'auto-recharge amount'); } catch { return { triggered: false, reason: 'invalid_amount' }; }

    const agentUser = await prisma.user.findUnique({ where: { id: agentId }, select: { email: true, firstName: true, lastName: true } });

    // ── Acquire the lock atomically (only one booking wins) ──
    const lock = await prisma.agentWallet.updateMany({
      where: { id: wallet.id, autoRechargeInProgress: false },
      data: { autoRechargeInProgress: true },
    });
    if (lock.count === 0) return { triggered: false, reason: 'in_progress' };

    try {
      const idempotencyKey = `ar_${wallet.id}_${Math.floor(Date.now() / 60000)}`; // per-minute soft dedupe; lock is the hard guard
      await createPayment({
        purpose: 'AGENT_WALLET_RECHARGE',
        amount,
        currency: wallet.currency,
        serviceType: 'OTHER',
        description: `Automatic wallet recharge — ${agentUser?.email || agentId}`,
        userId: agentId,
        agentId,
        walletId: wallet.id,
        customerEmail: agentUser?.email || '',
        customerName: `${agentUser?.firstName ?? ''} ${agentUser?.lastName ?? ''}`.trim() || 'Agent',
        requestedBy: 'SYSTEM',
        autoRecharge: true,
        notes: 'Automatic wallet recharge (off-session)',
        stripeCustomerId: wallet.stripeCustomerId,
        paymentMethodId: wallet.defaultPaymentMethodId,
        offSession: true,
        idempotencyKey,
      });
      // Success path: the webhook will credit the wallet and clear the lock.
      return { triggered: true, amount };
    } catch (e: any) {
      // Off-session charge failed (declined / authentication_required / etc.) —
      // release the lock and let the agent recharge manually. Never credit.
      await prisma.agentWallet.update({ where: { id: wallet.id }, data: { autoRechargeInProgress: false } }).catch(() => {});
      console.error('[auto-recharge] off-session charge failed for', agentId, ':', e?.message);
      // Notify the agent that auto-recharge failed (best-effort, no card data).
      import('@/lib/notify').then((m) => m.fireNotification?.({
        event_type: 'WALLET_LOW',
        customer_email: agentUser?.email || '',
        data: { agent_name: `${agentUser?.firstName ?? ''}`.trim() || 'Agent', remaining, currency: wallet.currency, auto_recharge_failed: true },
      })).catch(() => {});
      return { triggered: false, reason: 'charge_failed' };
    }
  } catch (e: any) {
    console.error('[auto-recharge] evaluation error:', e?.message);
    return { triggered: false, reason: 'error' };
  }
}
