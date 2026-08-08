/**
 * Paying agents through Stripe Connect.
 *
 * The agent enters their own bank details on Stripe's hosted onboarding — the
 * account number, the identity document and the tax details go straight to
 * Stripe and never touch FareMind. We store the connected account id and what
 * Stripe tells us about its state, nothing more. Holding bank credentials
 * ourselves would put the platform in KYC and money-transmitter scope for no
 * benefit whatsoever.
 *
 * ── Domestic only ────────────────────────────────────────────────────────────
 *
 * A transfer is attempted only when the agent's account country matches the
 * platform's. Cross-border corridors carry restrictions that differ per country
 * and per account type, so allowing them would make "Pay" succeed for some
 * agents and fail for others with no way to tell in advance — after an admin
 * has already told the agent they were paid. Where the countries differ the
 * payout is made externally and recorded with its bank reference.
 */
import Stripe from 'stripe';
import { prisma } from '../db';

/**
 * Constructed on first use, not at import.
 *
 * The Stripe SDK throws when built without a key, so a module-level client takes
 * down anything that imports this file — including code paths that never touch
 * Stripe, and tests that only exercise the eligibility rules.
 */
type StripeClient = InstanceType<typeof Stripe>;
let _stripe: StripeClient | null = null;
function getStripe(): StripeClient {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2025-09-30.clover' as any,
    });
  }
  return _stripe;
}

/**
 * The country the platform's Stripe balance sits in. Transfers are only made to
 * accounts in the same country.
 */
export const PLATFORM_COUNTRY = (process.env.STRIPE_PLATFORM_COUNTRY || 'US').toUpperCase();

export interface PayoutAccountState {
  connected: boolean;
  stripeAccountId: string | null;
  country: string | null;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  /** True when a platform transfer can actually be made right now. */
  canReceiveTransfer: boolean;
  /** Why it cannot, in words an admin or agent can act on. */
  blockedReason: string | null;
  requirementsDue: string[];
}

/** What is stopping a transfer, or null when nothing is. */
function blockedReasonFor(a: {
  payoutsEnabled: boolean; detailsSubmitted: boolean; country: string; disabledReason?: string | null;
}): string | null {
  if (a.country.toUpperCase() !== PLATFORM_COUNTRY) {
    // Stated as a fact about the corridor, not as the agent's fault.
    return `Platform transfers are domestic only. This agent's payout account is in ${a.country.toUpperCase()} and the platform balance is in ${PLATFORM_COUNTRY}. Pay by external transfer instead.`;
  }
  if (!a.detailsSubmitted) return 'The agent has not finished payout setup with Stripe.';
  if (!a.payoutsEnabled) {
    return a.disabledReason
      ? `Stripe has not enabled payouts on this account: ${a.disabledReason}`
      : 'Stripe has not enabled payouts on this account yet — verification may still be in progress.';
  }
  return null;
}

export async function getPayoutAccountState(userId: string): Promise<PayoutAccountState> {
  const acct = await prisma.agentPayoutAccount.findUnique({ where: { userId } }).catch(() => null);

  if (!acct) {
    return {
      connected: false, stripeAccountId: null, country: null,
      payoutsEnabled: false, detailsSubmitted: false,
      canReceiveTransfer: false,
      blockedReason: 'The agent has not set up payouts.',
      requirementsDue: [],
    };
  }

  const blockedReason = blockedReasonFor(acct);
  return {
    connected: true,
    stripeAccountId: acct.stripeAccountId,
    country: acct.country,
    payoutsEnabled: acct.payoutsEnabled,
    detailsSubmitted: acct.detailsSubmitted,
    canReceiveTransfer: blockedReason == null,
    blockedReason,
    requirementsDue: Array.isArray(acct.requirementsDue) ? (acct.requirementsDue as string[]) : [],
  };
}

/**
 * Start or resume onboarding, returning the Stripe-hosted URL to send them to.
 *
 * The account is created once and reused: a second account for the same agent
 * would split their payout history and leave Stripe holding two half-verified
 * identities for one person.
 */
export async function createOnboardingLink(params: {
  userId: string;
  email: string;
  returnUrl: string;
  refreshUrl: string;
  country?: string;
}): Promise<{ url: string; stripeAccountId: string }> {
  const { userId, email, returnUrl, refreshUrl } = params;
  const country = (params.country || PLATFORM_COUNTRY).toUpperCase();

  let acct = await prisma.agentPayoutAccount.findUnique({ where: { userId } }).catch(() => null);

  if (!acct) {
    const created = await getStripe().accounts.create({
      type: 'express',
      email,
      country,
      // Only transfers. We are not asking Stripe to let agents take card
      // payments — they receive money, they do not collect it.
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      metadata: { faremind_user_id: userId },
    });

    acct = await prisma.agentPayoutAccount.create({
      data: {
        userId,
        stripeAccountId: created.id,
        country,
        payoutsEnabled: created.payouts_enabled ?? false,
        detailsSubmitted: created.details_submitted ?? false,
      },
    });
  }

  const link = await getStripe().accountLinks.create({
    account: acct.stripeAccountId,
    // Where Stripe sends them if the link expires before they finish — it is
    // single-use and short-lived, so an abandoned setup needs a fresh one.
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });

  return { url: link.url, stripeAccountId: acct.stripeAccountId };
}

/**
 * Refresh what we hold from Stripe's own view of the account.
 *
 * Called after onboarding returns and from the account.updated webhook.
 * Verification can complete or lapse hours later, so a cached "enabled" is not
 * something to pay against without checking.
 */
export async function syncPayoutAccount(stripeAccountId: string): Promise<void> {
  try {
    const a = await getStripe().accounts.retrieve(stripeAccountId);
    const due = [
      ...(a.requirements?.currently_due ?? []),
      ...(a.requirements?.past_due ?? []),
    ];

    await prisma.agentPayoutAccount.updateMany({
      where: { stripeAccountId },
      data: {
        payoutsEnabled: a.payouts_enabled ?? false,
        detailsSubmitted: a.details_submitted ?? false,
        country: (a.country ?? PLATFORM_COUNTRY).toUpperCase(),
        requirementsDue: due,
        disabledReason: a.requirements?.disabled_reason ?? null,
        onboardedAt: a.details_submitted ? new Date() : null,
        lastSyncedAt: new Date(),
      },
    });
  } catch (e) {
    console.warn(`[Connect] could not sync ${stripeAccountId}: ${(e as Error).message}`);
  }
}

/**
 * A flat shape rather than a discriminated union: the backend's tsconfig does
 * not narrow unions on a literal discriminant, so `if (r.ok)` would not give
 * the caller access to the other fields there. Flat works under both.
 */
export interface TransferResult {
  ok: boolean;
  transferId: string | null;
  amount: number | null;
  error: string | null;
}

/**
 * Move money from the platform balance to the agent's connected account.
 *
 * Re-checks eligibility against Stripe rather than trusting our stored flags:
 * an account verified last week can be restricted today, and finding that out
 * from a failed transfer means the admin has already recorded a payout that did
 * not happen.
 *
 * Idempotent on the payout id, so a double-clicked button cannot pay twice.
 */
export async function transferToAgent(params: {
  userId: string;
  amount: number;
  currency?: string;
  payoutId: string;
  description?: string;
}): Promise<TransferResult> {
  const { userId, amount, payoutId } = params;
  const currency = (params.currency || 'usd').toLowerCase();

  if (!(amount > 0)) return { ok: false, transferId: null, amount: null, error: 'Transfer amount must be greater than zero.' };

  const acct = await prisma.agentPayoutAccount.findUnique({ where: { userId } }).catch(() => null);
  if (!acct) return { ok: false, transferId: null, amount: null, error: 'The agent has not set up payouts.' };

  // Ask Stripe now, not what we cached.
  await syncPayoutAccount(acct.stripeAccountId);
  const state = await getPayoutAccountState(userId);
  if (!state.canReceiveTransfer) {
    return { ok: false, transferId: null, amount: null, error: state.blockedReason ?? 'This account cannot receive transfers.' };
  }

  try {
    const transfer = await getStripe().transfers.create(
      {
        amount: Math.round(amount * 100),
        currency,
        destination: acct.stripeAccountId,
        description: params.description || 'FareMind agent commission',
        metadata: { faremind_user_id: userId, payout_id: payoutId },
      },
      { idempotencyKey: `agent-commission-payout-${payoutId}` },
    );
    return { ok: true, transferId: transfer.id, amount, error: null };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    // Insufficient platform balance is the common one and reads as a generic
    // failure otherwise — the admin needs to know it is our balance, not the
    // agent's account, that is the problem.
    const message = err?.code === 'balance_insufficient'
      ? 'The platform Stripe balance does not cover this transfer.'
      : err?.message || 'Stripe could not complete the transfer.';
    console.error(`[Connect] transfer failed for payout ${payoutId}: ${message}`);
    return { ok: false, transferId: null, amount: null, error: message };
  }
}

export interface PlatformBalance {
  /** Transferable right now, in major units. */
  available: number;
  /** Settling — not yet transferable, but arriving. */
  pending: number;
  currency: string;
  /** False when Stripe could not be read; the figures are then not trustworthy. */
  known: boolean;
}

/**
 * What the platform can actually transfer today.
 *
 * A Connect transfer comes from the Stripe BALANCE, not from a bank account. If
 * the payout schedule sweeps that balance to the bank daily — Stripe's default —
 * there may be nothing left to transfer from, and the admin would otherwise
 * discover that by clicking Pay and failing.
 *
 * `pending` is shown alongside because "$0 available, $6,400 pending" is a wait,
 * whereas "$0 available, $0 pending" is a problem.
 */
export async function getPlatformBalance(): Promise<PlatformBalance> {
  const currency = (process.env.STRIPE_PLATFORM_CURRENCY || 'usd').toLowerCase();
  try {
    const b = await getStripe().balance.retrieve();
    const sum = (rows: Array<{ amount: number; currency: string }> | undefined) =>
      (rows ?? [])
        .filter((r) => r.currency?.toLowerCase() === currency)
        .reduce((s, r) => s + r.amount, 0) / 100;

    return {
      available: Math.round(sum(b.available) * 100) / 100,
      pending: Math.round(sum(b.pending) * 100) / 100,
      currency: currency.toUpperCase(),
      known: true,
    };
  } catch (e) {
    // Reported as unknown rather than as zero. Showing $0 for a balance we
    // could not read would push an admin to pay externally when the money was
    // there all along.
    console.warn(`[Connect] could not read platform balance: ${(e as Error).message}`);
    return { available: 0, pending: 0, currency: currency.toUpperCase(), known: false };
  }
}
