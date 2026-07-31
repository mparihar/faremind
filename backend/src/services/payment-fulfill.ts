/**
 * ═══════════════════════════════════════════════
 * Payment Fulfillment (backend — post-confirmation, idempotent)
 * ═══════════════════════════════════════════════
 *
 * Runs the purpose-specific side effects for a ServicePayment AFTER Stripe has
 * confirmed the charge. Called by the Stripe webhook (authoritative,
 * routes/stripe-webhook.ts) and by the frontend /confirm fallback via
 * POST /api/payments/fulfill. Lives on the backend alongside the other Stripe
 * business logic (refunds, cancellations) for architectural consistency.
 *
 * Idempotency: a single conditional claim (updateMany where fulfilledAt IS NULL)
 * guarantees the side effects (wallet credit, support ticket, emails) run
 * exactly once even if the webhook is delivered twice or races the fallback.
 */
import Stripe from 'stripe';
import { prisma } from '../lib/db';
import { fireNotification } from '../lib/notify';
import { rechargeWallet } from './agent-wallet';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

export type FulfillResult = { fulfilled: boolean; alreadyDone: boolean; purpose?: string; error?: string };

function formatMoney(amount: number, currency = 'USD'): string {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(amount); }
  catch { return `${(currency || 'USD').toUpperCase()} ${amount.toFixed(2)}`; }
}

export async function fulfillPayment(paymentId: string, opts: { stripeEventId?: string } = {}): Promise<FulfillResult> {
  const payment = await prisma.servicePayment.findUnique({
    where: { id: paymentId },
    include: { booking: { select: { id: true, masterBookingReference: true, originAirport: true, destinationAirport: true, departureDate: true } } },
  });
  if (!payment) return { fulfilled: false, alreadyDone: false, error: 'Payment not found' };

  // ── Atomic claim: only the first caller flips fulfilledAt from NULL ──
  const claim = await prisma.servicePayment.updateMany({
    where: { id: paymentId, fulfilledAt: null },
    data: { status: 'SUCCEEDED', paidAt: payment.paidAt ?? new Date(), fulfilledAt: new Date(), stripeEventId: opts.stripeEventId ?? payment.stripeEventId },
  });
  if (claim.count === 0) return { fulfilled: false, alreadyDone: true, purpose: payment.paymentPurpose };

  try {
    switch (payment.paymentPurpose) {
      case 'AGENT_WALLET_RECHARGE': await fulfillWalletRecharge(payment); break;
      case 'REISSUE_COLLECTION': await fulfillReissueCollection(payment); break;
      case 'OTHER_PAYMENT': await fulfillOtherPayment(payment); break;
      case 'BOOKING_PAYMENT':
      default: await fulfillBookingPayment(payment); break;
    }
    return { fulfilled: true, alreadyDone: false, purpose: payment.paymentPurpose };
  } catch (e: any) {
    console.error(`[fulfill] purpose=${payment.paymentPurpose} payment=${paymentId} error:`, e?.message || e);
    await prisma.servicePayment.update({ where: { id: paymentId }, data: { failureReason: `Fulfillment error: ${e?.message || e}`.slice(0, 500) } }).catch(() => {});
    return { fulfilled: true, alreadyDone: false, purpose: payment.paymentPurpose, error: e?.message || String(e) };
  }
}

export async function markPaymentFailed(paymentId: string, reason: string, stripeEventId?: string): Promise<void> {
  const p = await prisma.servicePayment.findUnique({ where: { id: paymentId }, select: { status: true } });
  if (!p || p.status === 'SUCCEEDED') return; // never override a captured payment
  await prisma.servicePayment.update({
    where: { id: paymentId },
    data: { status: 'FAILED', failedAt: new Date(), failureReason: reason.slice(0, 500), stripeEventId },
  }).catch(() => {});
}

/* ─────────────── Wallet recharge (direct wallet-service call) ─────────────── */

/**
 * The customer has paid a reissue difference — now send the change to the airline.
 *
 * This is the whole point of the payment-first flow: the provider is only contacted once
 * the money has actually cleared, rather than charging a card off-session and hoping.
 * The execution context (PTR id, chosen fare option, MFRef) was stashed on the
 * ServicePayment when the quote was raised.
 *
 * Runs inside fulfillPayment's single-claim guard, so a replayed webhook cannot reissue
 * twice. A provider failure here must NOT throw past the caller's handler — the customer
 * has paid, so this has to end in either a completed reissue or a refund plus a ticket
 * someone will action, never a silent stop.
 */
async function fulfillReissueCollection(payment: any): Promise<void> {
  const { executePaidReissue } = await import('./reissue-orchestrator');
  await executePaidReissue(payment);
}

async function fulfillWalletRecharge(payment: any): Promise<void> {
  const agentId = payment.agentId || payment.userId;
  if (!agentId) throw new Error('Wallet recharge missing agentId');
  // Credit the wallet via the single source of truth (re-enables + notifies).
  await rechargeWallet(
    agentId,
    Number(payment.amount),
    payment.autoRecharge ? 'SYSTEM (auto-recharge)' : (payment.customerEmail || 'AGENT'),
    payment.autoRecharge ? 'Automatic wallet recharge (Stripe)' : 'Agent wallet recharge (Stripe)',
  );

  // Capture the saved card (reference only) for future off-session auto-recharge,
  // and clear the auto-recharge lock.
  if (payment.walletId) {
    const patch: any = { autoRechargeInProgress: false };
    if (payment.autoRecharge) patch.lastAutoRechargeAt = new Date();
    try {
      const wallet = await prisma.agentWallet.findUnique({ where: { id: payment.walletId }, select: { saveCardConsentAt: true, defaultPaymentMethodId: true, stripeCustomerId: true } });
      if (wallet?.saveCardConsentAt && !wallet.defaultPaymentMethodId && payment.stripePaymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
        const pm = typeof pi.payment_method === 'string' ? pi.payment_method : (pi.payment_method as any)?.id;
        const cust = typeof pi.customer === 'string' ? pi.customer : (pi.customer as any)?.id;
        if (pm) patch.defaultPaymentMethodId = pm;
        if (cust && !wallet.stripeCustomerId) patch.stripeCustomerId = cust;
      }
    } catch (e: any) {
      console.warn('[fulfill] could not capture saved card:', e?.message);
    }
    await prisma.agentWallet.update({ where: { id: payment.walletId }, data: patch }).catch(() => {});
  }
}

/* ─────────────── Other payment ─────────────── */

async function fulfillOtherPayment(payment: any): Promise<void> {
  const amtStr = formatMoney(Number(payment.amount), payment.currency);

  if (payment.paymentRequestId) {
    await prisma.paymentRequest.updateMany({
      where: { id: payment.paymentRequestId, status: { in: ['OPEN', 'DRAFT', 'SENT'] } },
      data: { status: 'PAID', paidTransactionId: payment.id, paidAt: new Date() },
    }).catch(() => {});
  }

  const totalCount = await prisma.supportTicket.count();
  const ticketNumber = `FM-PAY-${String(totalCount + 1).padStart(4, '0')}`;
  const desc = [
    `Other payment received and recorded.`, ``,
    `Amount: ${amtStr}`,
    `Note: ${payment.notes || payment.description}`,
    payment.paymentRequestId ? `Payment Request: ${payment.paymentRequestId}` : null,
    payment.supportCaseId ? `Support Case: ${payment.supportCaseId}` : null, ``,
    `Payer: ${payment.customerName} (${payment.customerEmail})`,
    payment.customerPhone ? `Phone: ${payment.customerPhone}` : null,
    `Requested By: ${payment.requestedBy}`,
    `Stripe PI: ${payment.stripePaymentIntentId || 'N/A'}`,
  ].filter(Boolean).join('\n');

  const ticket = await prisma.supportTicket.create({
    data: {
      subject: `Other Payment — ${amtStr}`, description: desc, priority: 'MEDIUM', status: 'OPEN', category: 'Other Payment',
      customerName: payment.customerName, customerEmail: payment.customerEmail, customerPhone: payment.customerPhone || undefined,
    },
  });
  await prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, content: desc, isInternal: false } }).catch(() => {});
  if (payment.supportCaseId == null) {
    await prisma.servicePayment.update({ where: { id: payment.id }, data: { supportCaseId: ticket.id } }).catch(() => {});
  }
  await fireCustomerAndAdmins(payment, ticketNumber, 'Other Payment', amtStr);
}

/* ─────────────── Booking-service payment (legacy BAU) ─────────────── */

async function fulfillBookingPayment(payment: any): Promise<void> {
  const svcLabel = formatServiceType(payment.serviceType);
  const amtStr = formatMoney(Number(payment.amount), payment.currency);
  const bookingRef = payment.booking?.masterBookingReference || 'N/A';
  const route = payment.booking ? `${payment.booking.originAirport} → ${payment.booking.destinationAirport}` : '';

  if (payment.bookingId) {
    await prisma.bookingEvent.create({
      data: {
        bookingId: payment.bookingId, eventType: 'SERVICE_PAYMENT', eventTitle: `Service Payment: ${svcLabel}`,
        eventDescription: `Payment of ${amtStr} for ${payment.description}. PNR: ${payment.pnrCode || 'N/A'}, Ticket: ${payment.ticketNumber || 'N/A'}. A support ticket has been auto-created.`,
        actorType: payment.requestedBy === 'AGENT' ? 'agent' : 'customer',
        payloadJson: { servicePaymentId: payment.id, serviceType: payment.serviceType, amount: Number(payment.amount), currency: payment.currency, pnrCode: payment.pnrCode, ticketNumber: payment.ticketNumber },
      },
    }).catch(() => {});
  }

  const totalCount = await prisma.supportTicket.count();
  const ticketNumber = `FM-PAY-${String(totalCount + 1).padStart(4, '0')}`;
  const ticketDesc = buildBookingTicketDescription(payment, bookingRef, route);
  const ticket = await prisma.supportTicket.create({
    data: {
      subject: `Service Payment: ${svcLabel} — ${amtStr}`, description: ticketDesc, priority: 'MEDIUM', status: 'OPEN', category: svcLabel,
      customerName: payment.customerName, customerEmail: payment.customerEmail, customerPhone: payment.customerPhone || undefined,
      bookingRef: bookingRef !== 'N/A' ? bookingRef : null, airlinePnr: payment.pnrCode || null,
    },
  });
  await prisma.supportTicketMessage.create({ data: { ticketId: ticket.id, content: ticketDesc, isInternal: false } }).catch(() => {});
  await fireCustomerAndAdmins(payment, ticketNumber, svcLabel, amtStr, bookingRef);
}

/* ─────────────── Shared notification helpers ─────────────── */

export function formatServiceType(type: string): string {
  const map: Record<string, string> = {
    CFAR: 'Cancel For Any Reason (CFAR)', PRICE_DROP_PROTECTION: 'Price Drop Protection', TRAVEL_INSURANCE: 'Travel Insurance',
    SEAT_CHANGE: 'Seat Change', DATE_CHANGE: 'Flight Date Change', BAGGAGE_CHANGE: 'Baggage Change', UPGRADE: 'Cabin Upgrade', OTHER: 'Other Service',
  };
  return map[type] || type;
}

function buildBookingTicketDescription(payment: any, bookingRef: string, route: string): string {
  return [
    `Service payment received and requires processing.`, ``,
    `── Payment Details ──`, `Service: ${formatServiceType(payment.serviceType)}`, `Amount: ${formatMoney(Number(payment.amount), payment.currency)}`,
    `Description: ${payment.description}`, `Paid At: ${new Date().toUTCString()}`, ``,
    `── Booking Details ──`, `Booking Ref: ${bookingRef}`, route ? `Route: ${route}` : null, `PNR: ${payment.pnrCode || 'N/A'}`, `Ticket #: ${payment.ticketNumber || 'N/A'}`, ``,
    `── Customer Details ──`, `Name: ${payment.customerName}`, `Email: ${payment.customerEmail}`, payment.customerPhone ? `Phone: ${payment.customerPhone}` : null, ``,
    `── Internal ──`, `Requested By: ${payment.requestedBy}`, `Stripe PI: ${payment.stripePaymentIntentId || 'N/A'}`, payment.notes ? `Notes: ${payment.notes}` : null,
  ].filter(Boolean).join('\n');
}

async function fireCustomerAndAdmins(payment: any, ticketNumber: string, label: string, amtStr: string, bookingRef = 'N/A'): Promise<void> {
  fireNotification({
    event_type: 'PAYMENT_SUCCESS', customer_email: payment.customerEmail,
    data: { customer_name: payment.customerName, booking_reference: bookingRef, service_type: label, amount: amtStr, pnr: payment.pnrCode || 'N/A', ticket_number: payment.ticketNumber || 'N/A', support_ticket: ticketNumber, payment_purpose: payment.paymentPurpose },
  }).catch(() => {});
  await notifyAdmins(payment, ticketNumber, label, amtStr, bookingRef).catch((e) => console.error('[fulfill] admin notify:', e?.message || e));
}

async function notifyAdmins(payment: any, ticketNumber: string, label: string, amtStr: string, bookingRef: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return;
  const recipients = await prisma.notificationRecipient.findMany({ where: { isActive: true }, select: { email: true } });
  if (!recipients.length) return;
  const subject = `💳 ${label} — ${amtStr} — Ticket ${ticketNumber}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;padding:24px;border-radius:12px;">
      <h2 style="color:#1ABC9C;margin-bottom:4px;">${label} Received</h2>
      <p style="color:#64748b;margin-bottom:16px;font-size:13px;">Support ticket <strong style="color:#fff;">${ticketNumber}</strong> auto-created · Purpose: ${payment.paymentPurpose}</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#94a3b8;">Amount</td><td style="padding:8px 0;color:#1ABC9C;font-weight:bold;font-size:18px;">${amtStr}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Booking</td><td style="padding:8px 0;color:#fff;">${bookingRef}</td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Customer</td><td style="padding:8px 0;color:#fff;">${payment.customerName}<br/><span style="color:#94a3b8;">${payment.customerEmail}</span></td></tr>
        <tr><td style="padding:8px 0;color:#94a3b8;">Requested By</td><td style="padding:8px 0;color:#fff;">${payment.requestedBy}</td></tr>
      </table>
      ${payment.notes ? `<p style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.05);border-radius:8px;color:#94a3b8;"><strong style="color:#fff;">Notes:</strong> ${escapeHtml(payment.notes)}</p>` : ''}
    </div>`;
  const text = `${label}: ${amtStr}. Booking: ${bookingRef}. Customer: ${payment.customerName} (${payment.customerEmail}). Ticket: ${ticketNumber}.`;
  for (const r of recipients) {
    fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'FAREMIND', email: process.env.BREVO_SENDER_EMAIL || 'support@faremind.ai' }, to: [{ email: r.email }], subject, htmlContent: html, textContent: text }),
    }).catch(() => {});
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
