/**
 * ═══════════════════════════════════════════════
 * FareMind — Payment Orchestrator (shared create path)
 * ═══════════════════════════════════════════════
 *
 * One code path that creates a Stripe PaymentIntent + a ServicePayment row for
 * EVERY payment purpose (BOOKING_PAYMENT | AGENT_WALLET_RECHARGE | OTHER_PAYMENT).
 * Purpose-specific fulfillment happens later, in the webhook (see ./fulfill.ts),
 * and ONLY after Stripe confirms — never on a browser redirect.
 *
 * Security invariants (enforced by CALLERS, not this module):
 *   • amount, purpose, payer identity and all refs are server-derived / validated
 *     before calling here. Never pass through raw client-supplied money or ids.
 *   • no raw card data ever touches us — Stripe references only.
 */

import { prisma } from '@/lib/db';
import { getStripe } from '@/lib/stripe';
import { toMinorUnits } from './money';

export type PaymentPurpose = 'BOOKING_PAYMENT' | 'AGENT_WALLET_RECHARGE' | 'OTHER_PAYMENT';

export interface CreatePaymentInput {
  purpose: PaymentPurpose;
  amount: number;                 // dollars, already server-validated (> 0)
  currency?: string;
  serviceType?: string;           // ServicePaymentType enum value (default OTHER)
  description: string;
  // Payer identity — server-derived from the authenticated session, never the client body.
  userId?: string | null;
  customerEmail: string;
  customerName: string;
  customerPhone?: string | null;
  requestedBy?: 'USER' | 'AGENT' | 'ADMIN' | 'SYSTEM';
  // Purpose-specific references
  bookingId?: string | null;
  agentId?: string | null;
  walletId?: string | null;
  supportCaseId?: string | null;
  paymentRequestId?: string | null;
  pnrCode?: string | null;
  ticketNumber?: string | null;
  notes?: string | null;
  autoRecharge?: boolean;
  // Stripe options
  stripeCustomerId?: string | null;
  paymentMethodId?: string | null;   // saved card (off-session or preselected)
  offSession?: boolean;              // auto-recharge → confirm now, no browser
  savePaymentMethod?: boolean;       // setup_future_usage=off_session
  idempotencyKey?: string;
  extraMetadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  paymentId: string;
  stripePaymentIntentId: string;
  clientSecret: string | null;
  status: string;                 // Stripe PI status
  requiresAction: boolean;        // true if off-session confirm needs 3DS
}

/**
 * Create a PaymentIntent + PENDING ServicePayment for any purpose.
 * For on-session flows the caller collects the card client-side with the
 * returned clientSecret; for off-session (auto-recharge) we confirm here.
 */
export async function createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
  const stripe = getStripe();
  const currency = (input.currency || 'USD').toLowerCase();
  const amountMinor = toMinorUnits(input.amount);
  if (amountMinor <= 0) throw new Error('A positive amount is required.');

  const metadata: Record<string, string> = {
    booked_via: 'faremind',
    payment_purpose: input.purpose,
    service_type: input.serviceType || 'OTHER',
    requested_by: input.requestedBy || 'USER',
    customer_email: input.customerEmail,
    ...(input.userId ? { user_id: input.userId } : {}),
    ...(input.agentId ? { agent_id: input.agentId } : {}),
    ...(input.walletId ? { wallet_id: input.walletId } : {}),
    ...(input.bookingId ? { booking_id: input.bookingId } : {}),
    ...(input.supportCaseId ? { support_case_id: input.supportCaseId } : {}),
    ...(input.paymentRequestId ? { payment_request_id: input.paymentRequestId } : {}),
    ...(input.autoRecharge ? { auto_recharge: 'true' } : {}),
    ...(input.extraMetadata || {}),
  };

  const piParams: Record<string, any> = {
    amount: amountMinor,
    currency,
    description: input.description.slice(0, 200),
    metadata,
  };

  const offSession = !!input.offSession;
  if (offSession) {
    // Auto-recharge / server-initiated: confirm immediately against a saved card.
    if (!input.stripeCustomerId || !input.paymentMethodId) {
      throw new Error('Off-session payment requires a saved Stripe customer and payment method.');
    }
    piParams.customer = input.stripeCustomerId;
    piParams.payment_method = input.paymentMethodId;
    piParams.off_session = true;
    piParams.confirm = true;
  } else {
    // On-session: browser collects the card via the returned clientSecret.
    piParams.automatic_payment_methods = { enabled: true, allow_redirects: 'never' };
    if (input.stripeCustomerId) piParams.customer = input.stripeCustomerId;
    if (input.paymentMethodId) piParams.payment_method = input.paymentMethodId;
    if (input.savePaymentMethod) piParams.setup_future_usage = 'off_session';
  }

  // Idempotency key prevents a duplicate PI (and thus duplicate charge) on retry.
  const idempotencyKey = input.idempotencyKey;
  const paymentIntent = await stripe.paymentIntents.create(
    piParams,
    idempotencyKey ? { idempotencyKey } : undefined,
  );

  const payment = await prisma.servicePayment.create({
    data: {
      paymentPurpose: input.purpose,
      bookingId: input.bookingId || null,
      userId: input.userId || null,
      agentId: input.agentId || null,
      walletId: input.walletId || null,
      supportCaseId: input.supportCaseId || null,
      paymentRequestId: input.paymentRequestId || null,
      serviceType: (input.serviceType as any) || 'OTHER',
      description: input.description,
      amount: input.amount,
      currency: (input.currency || 'USD').toUpperCase(),
      status: 'PENDING',
      stripePaymentIntentId: paymentIntent.id,
      idempotencyKey: idempotencyKey || null,
      autoRecharge: !!input.autoRecharge,
      pnrCode: input.pnrCode || null,
      ticketNumber: input.ticketNumber || null,
      customerEmail: input.customerEmail,
      customerName: input.customerName,
      customerPhone: input.customerPhone || null,
      requestedBy: input.requestedBy || 'USER',
      notes: input.notes || null,
    },
  });

  return {
    paymentId: payment.id,
    stripePaymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret ?? null,
    status: paymentIntent.status,
    requiresAction: paymentIntent.status === 'requires_action',
  };
}
