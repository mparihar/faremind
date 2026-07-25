/**
 * Agent Wallet — prepaid credit control for FAREMIND_AGENT users.
 *
 *   remaining = walletAmount - utilizedAmount
 *
 * An agent may book only while `remaining >= bookingAmount`. Crossing the low
 * threshold emails the agent once; crossing the disable threshold suspends the
 * agent (User.isActive=false — the single access gate enforced at login,
 * withAgent, and the booking confirm route) and emails them. Recharging restores
 * the balance, re-enables the agent, and resets the notification flags. Every
 * balance change is recorded in AgentWalletHistory.
 *
 * Policy scalars are admin-configurable via SystemConfig (no deploy):
 *   wallet_default_balance / wallet_low_threshold / wallet_disable_threshold /
 *   wallet_currency.
 */

import { prisma } from '../lib/db';
import { fireNotification } from '../lib/notify';

export interface WalletPolicy {
  defaultBalance: number;
  lowThreshold: number;
  disableThreshold: number;
  currency: string;
}

const POLICY_DEFAULTS: WalletPolicy = {
  defaultBalance: 3000,
  lowThreshold: 1000,
  disableThreshold: 500,
  currency: 'USD',
};

/** Read the admin-configurable wallet policy from SystemConfig (with fallbacks). */
export async function getWalletPolicy(): Promise<WalletPolicy> {
  try {
    const rows = await prisma.systemConfig.findMany({ where: { key: { in: ['wallet_default_balance', 'wallet_low_threshold', 'wallet_disable_threshold', 'wallet_currency'] } } });
    const m = new Map(rows.map((r) => [r.key, r.value]));
    const num = (k: string, d: number) => { const v = parseFloat(m.get(k) ?? ''); return Number.isFinite(v) ? v : d; };
    return {
      defaultBalance: num('wallet_default_balance', POLICY_DEFAULTS.defaultBalance),
      lowThreshold: num('wallet_low_threshold', POLICY_DEFAULTS.lowThreshold),
      disableThreshold: num('wallet_disable_threshold', POLICY_DEFAULTS.disableThreshold),
      currency: m.get('wallet_currency') || POLICY_DEFAULTS.currency,
    };
  } catch {
    return POLICY_DEFAULTS;
  }
}

const n = (d: any): number => (d == null ? 0 : typeof d === 'number' ? d : parseFloat(String(d)));
const round2 = (x: number) => Math.round(x * 100) / 100;

export function remainingOf(wallet: { walletAmount: any; utilizedAmount: any }): number {
  return round2(n(wallet.walletAmount) - n(wallet.utilizedAmount));
}

export function computeStatus(remaining: number, policy: WalletPolicy): 'HEALTHY' | 'LOW' | 'DISABLED' {
  if (remaining <= policy.disableThreshold) return 'DISABLED';
  if (remaining <= policy.lowThreshold) return 'LOW';
  return 'HEALTHY';
}

/** Get (or lazily create with the policy default) an agent's wallet. */
export async function getOrCreateWallet(userId: string) {
  const existing = await prisma.agentWallet.findUnique({ where: { userId } });
  if (existing) return existing;
  const policy = await getWalletPolicy();
  return prisma.agentWallet.create({
    data: { userId, walletAmount: policy.defaultBalance, utilizedAmount: 0, currency: policy.currency, status: 'HEALTHY' },
  });
}

async function addHistory(walletId: string, userId: string, eventType: string, amount: number, remainingBefore: number, remainingAfter: number, actor: string, reason?: string, bookingId?: string) {
  await prisma.agentWalletHistory.create({
    data: { walletId, userId, eventType, amount: round2(amount), remainingBefore: round2(remainingBefore), remainingAfter: round2(remainingAfter), actor, reason, bookingId },
  }).catch((e) => console.error('[agent-wallet] history write failed:', e instanceof Error ? e.message : e));
}

async function agentEmail(userId: string): Promise<{ email: string | null; name: string }> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true, lastName: true } });
  return { email: u?.email ?? null, name: `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || 'Agent' };
}

export interface WalletSummary {
  userId: string; walletAmount: number; utilizedAmount: number; remaining: number; currency: string;
  totalBookings: number; totalBookingValue: number; status: string; privilegeEnabled: boolean;
  lastRechargeAt: Date | null; lastNotificationAt: Date | null;
}

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const wallet = await getOrCreateWallet(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  return {
    userId, walletAmount: n(wallet.walletAmount), utilizedAmount: n(wallet.utilizedAmount),
    remaining: remainingOf(wallet), currency: wallet.currency,
    totalBookings: wallet.totalBookings, totalBookingValue: n(wallet.totalBookingValue),
    status: wallet.status, privilegeEnabled: user?.isActive ?? false,
    lastRechargeAt: wallet.lastRechargeAt, lastNotificationAt: wallet.lastNotificationAt,
  };
}

/**
 * Pre-booking gate. Returns whether an agent may book `amount`. MUST be called
 * BEFORE any search/revalidate/provider-book/payment for agent bookings.
 */
export async function checkBookingAllowed(userId: string, amount: number): Promise<{ allowed: boolean; remaining: number; reason?: string; code?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, role: true } });
  if (!user) return { allowed: false, remaining: 0, reason: 'Agent not found.', code: 'AGENT_NOT_FOUND' };
  if (!user.isActive) return { allowed: false, remaining: 0, reason: 'Your agent account is disabled. Please recharge your wallet or contact the administrator.', code: 'AGENT_DISABLED' };
  const wallet = await getOrCreateWallet(userId);
  const remaining = remainingOf(wallet);
  if (remaining < round2(amount)) {
    return { allowed: false, remaining, reason: 'Insufficient Wallet Balance. Please recharge your wallet before making additional bookings.', code: 'INSUFFICIENT_WALLET' };
  }
  return { allowed: true, remaining };
}

/** After a successful agent booking: add to utilized + counters, re-evaluate thresholds. */
export async function recordBookingUtilization(userId: string, amount: number, bookingId?: string): Promise<void> {
  const wallet = await getOrCreateWallet(userId);
  const before = remainingOf(wallet);
  const updated = await prisma.agentWallet.update({
    where: { id: wallet.id },
    data: {
      utilizedAmount: round2(n(wallet.utilizedAmount) + amount),
      totalBookings: wallet.totalBookings + 1,
      totalBookingValue: round2(n(wallet.totalBookingValue) + amount),
    },
  });
  await addHistory(wallet.id, userId, 'BOOKING', -Math.abs(amount), before, remainingOf(updated), 'SYSTEM', `Booking ${bookingId ?? ''}`.trim(), bookingId);
  await evaluateThresholds(updated.id, 'SYSTEM');
}

/** Return credit to the wallet on refund/cancellation (utilized decreases). */
export async function releaseUtilization(userId: string, amount: number, kind: 'REFUND' | 'CANCELLATION', actor = 'SYSTEM', bookingId?: string): Promise<void> {
  const wallet = await prisma.agentWallet.findUnique({ where: { userId } });
  if (!wallet) return;
  const before = remainingOf(wallet);
  const newUtilized = Math.max(0, round2(n(wallet.utilizedAmount) - amount));
  const updated = await prisma.agentWallet.update({ where: { id: wallet.id }, data: { utilizedAmount: newUtilized } });
  await addHistory(wallet.id, userId, kind, Math.abs(amount), before, remainingOf(updated), actor, `${kind} ${bookingId ?? ''}`.trim(), bookingId);
  await evaluateThresholds(updated.id, actor);
}

/**
 * Re-evaluate status after a balance change: send the low-balance email once,
 * and auto-disable (+ email) when the remaining balance hits the disable
 * threshold. Idempotent via the lowNotified/disableNotified flags.
 */
async function evaluateThresholds(walletId: string, actor: string): Promise<void> {
  const policy = await getWalletPolicy();
  const wallet = await prisma.agentWallet.findUnique({ where: { id: walletId } });
  if (!wallet) return;
  const remaining = remainingOf(wallet);
  const status = computeStatus(remaining, policy);
  const { email, name } = await agentEmail(wallet.userId);

  // Auto-disable
  if (status === 'DISABLED') {
    await prisma.agentWallet.update({ where: { id: wallet.id }, data: { status: 'DISABLED' } });
    const user = await prisma.user.findUnique({ where: { id: wallet.userId }, select: { isActive: true } });
    if (user?.isActive) {
      await prisma.user.update({ where: { id: wallet.userId }, data: { isActive: false } });
      await addHistory(wallet.id, wallet.userId, 'AUTO_DISABLE', 0, remaining, remaining, actor, `Auto-disabled: remaining ${remaining} <= disable threshold ${policy.disableThreshold}`);
    }
    if (!wallet.disableNotified && email) {
      fireNotification({ event_type: 'WALLET_DISABLED', customer_email: email, data: { agent_name: name, remaining, currency: wallet.currency } });
      await prisma.agentWallet.update({ where: { id: wallet.id }, data: { disableNotified: true, lowNotified: true, lastNotificationAt: new Date() } });
    }
    return;
  }

  // Low balance (below low threshold, above disable threshold)
  if (status === 'LOW') {
    await prisma.agentWallet.update({ where: { id: wallet.id }, data: { status: 'LOW' } });
    if (!wallet.lowNotified && email) {
      fireNotification({
        event_type: 'WALLET_LOW', customer_email: email,
        data: { agent_name: name, remaining, wallet_amount: n(wallet.walletAmount), utilized: n(wallet.utilizedAmount), currency: wallet.currency },
      });
      await prisma.agentWallet.update({ where: { id: wallet.id }, data: { lowNotified: true, lastNotificationAt: new Date() } });
    }
    return;
  }

  // Healthy
  await prisma.agentWallet.update({ where: { id: wallet.id }, data: { status: 'HEALTHY' } });
}

/** Recharge (credit) the wallet. Re-enables the agent and resets notification flags. */
export async function rechargeWallet(userId: string, amount: number, actor: string, reason?: string): Promise<WalletSummary> {
  if (!(amount > 0)) throw new Error('Recharge amount must be positive.');
  const wallet = await getOrCreateWallet(userId);
  const before = remainingOf(wallet);
  const updated = await prisma.agentWallet.update({
    where: { id: wallet.id },
    data: { walletAmount: round2(n(wallet.walletAmount) + amount), lowNotified: false, disableNotified: false, lastRechargeAt: new Date() },
  });
  await addHistory(wallet.id, userId, 'RECHARGE', Math.abs(amount), before, remainingOf(updated), actor, reason || 'Wallet recharge');

  // Re-enable if the agent was auto/manually disabled.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  const { email, name } = await agentEmail(userId);
  let reactivated = false;
  if (user && !user.isActive) {
    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
    await addHistory(wallet.id, userId, 'AUTO_ENABLE', 0, remainingOf(updated), remainingOf(updated), actor, 'Re-enabled on recharge');
    reactivated = true;
  }
  await evaluateThresholds(updated.id, actor);
  const fresh = await prisma.agentWallet.findUnique({ where: { id: wallet.id } });

  if (email) {
    fireNotification({ event_type: 'WALLET_RECHARGED', customer_email: email, data: { agent_name: name, amount: round2(amount), remaining: remainingOf(fresh!), currency: updated.currency } });
    if (reactivated) fireNotification({ event_type: 'WALLET_REACTIVATED', customer_email: email, data: { agent_name: name, remaining: remainingOf(fresh!), currency: updated.currency } });
  }
  return getWalletSummary(userId);
}

/** Admin: set the wallet limit to an absolute value (increase/decrease). */
export async function setWalletAmount(userId: string, newAmount: number, actor: string, reason?: string): Promise<WalletSummary> {
  if (newAmount < 0) throw new Error('Wallet amount cannot be negative.');
  const wallet = await getOrCreateWallet(userId);
  const before = remainingOf(wallet);
  const delta = round2(newAmount - n(wallet.walletAmount));
  const updated = await prisma.agentWallet.update({ where: { id: wallet.id }, data: { walletAmount: round2(newAmount) } });
  await addHistory(wallet.id, userId, 'MANUAL_ADJUST', delta, before, remainingOf(updated), actor, reason || `Wallet amount set to ${newAmount}`);
  await evaluateThresholds(updated.id, actor);
  return getWalletSummary(userId);
}

/** Admin: reset the utilized amount to zero (e.g. new billing cycle). */
export async function resetUtilized(userId: string, actor: string, reason?: string): Promise<WalletSummary> {
  const wallet = await getOrCreateWallet(userId);
  const before = remainingOf(wallet);
  const updated = await prisma.agentWallet.update({ where: { id: wallet.id }, data: { utilizedAmount: 0 } });
  await addHistory(wallet.id, userId, 'RESET_UTILIZED', n(wallet.utilizedAmount), before, remainingOf(updated), actor, reason || 'Utilized amount reset by admin');
  await evaluateThresholds(updated.id, actor);
  return getWalletSummary(userId);
}

/** Admin: manually enable/disable the agent (flips User.isActive). */
export async function setAgentPrivilege(userId: string, enabled: boolean, actor: string, reason?: string): Promise<WalletSummary> {
  const wallet = await getOrCreateWallet(userId);
  const remaining = remainingOf(wallet);
  await prisma.user.update({ where: { id: userId }, data: { isActive: enabled } });
  await prisma.agentWallet.update({ where: { id: wallet.id }, data: enabled ? { disableNotified: false } : { status: 'DISABLED' } });
  await addHistory(wallet.id, userId, enabled ? 'AUTO_ENABLE' : 'AUTO_DISABLE', 0, remaining, remaining, actor, reason || (enabled ? 'Enabled by admin' : 'Disabled by admin'));
  const { email, name } = await agentEmail(userId);
  if (email) {
    if (enabled) fireNotification({ event_type: 'WALLET_REACTIVATED', customer_email: email, data: { agent_name: name, remaining, currency: wallet.currency } });
    else fireNotification({ event_type: 'WALLET_DISABLED', customer_email: email, data: { agent_name: name, remaining, currency: wallet.currency } });
  }
  if (enabled) await evaluateThresholds(wallet.id, actor);
  return getWalletSummary(userId);
}
