/**
 * The agent's own payout setup.
 *
 * GET  where their Connect account stands, and what is still missing.
 * POST a fresh Stripe-hosted onboarding link to continue or start.
 *
 * The agent enters their bank details on Stripe's pages, never ours. This
 * endpoint hands out the link and reads back the state — it never receives an
 * account number, and there is deliberately nowhere here to submit one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAgentServicing } from '@/lib/agent-auth';
import {
  getPayoutAccountState, createOnboardingLink, syncPayoutAccount, PLATFORM_COUNTRY,
} from '@/lib/finance/stripe-connect';

export const GET = withAgentServicing(async (req: NextRequest, { agent }) => {
  const state = await getPayoutAccountState(agent.id);

  // Onboarding finishes on Stripe and returns here; the webhook may not have
  // landed yet, so refresh on the way in rather than showing a stale "pending".
  if (state.stripeAccountId && !state.payoutsEnabled) {
    await syncPayoutAccount(state.stripeAccountId);
    return NextResponse.json({
      ...(await getPayoutAccountState(agent.id)),
      platformCountry: PLATFORM_COUNTRY,
    });
  }

  return NextResponse.json({ ...state, platformCountry: PLATFORM_COUNTRY });
});

export const POST = withAgentServicing(async (req: NextRequest, { agent }) => {
  const origin = new URL(req.url).origin;
  const appUrl = process.env.APP_URL || origin;

  try {
    const { url } = await createOnboardingLink({
      userId: agent.id,
      email: agent.email,
      // Back to the commission page either way; the GET above refreshes state.
      returnUrl: `${appUrl}/agent/commission?payout_setup=done`,
      refreshUrl: `${appUrl}/agent/commission?payout_setup=retry`,
    });
    return NextResponse.json({ url });
  } catch (e) {
    const message = (e as Error).message;
    console.error(`[Connect] onboarding link failed for agent ${agent.id}: ${message}`);
    // Connect being switched off on the platform account is the likeliest
    // cause, and it is a platform problem, not something the agent can fix.
    return NextResponse.json(
      { error: 'Payout setup is not available right now. Please contact FareMind support.' },
      { status: 502 },
    );
  }
});
