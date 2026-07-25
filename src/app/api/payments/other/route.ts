/**
 * Other Payment — a generic, authenticated ad-hoc payment.
 *
 *   GET  /api/payments/other?ref=FM-PR-0001  → resolve a structured PaymentRequest for the payer
 *   POST /api/payments/other                 → create a PaymentIntent, return clientSecret
 *
 * Auth: any authenticated user or agent (session token / cookie).
 * Security:
 *   • Payer identity is derived from the session, never the client body.
 *   • When a PaymentRequest reference is supplied, the amount/currency/note come
 *     from the REQUEST (server-trusted), not the client.
 *   • Ad-hoc amounts are validated against `other_payment_max_amount`, and the
 *     note is sanitized + length-checked (`other_payment_note_*`).
 *   • Money is never fulfilled here — only after the Stripe webhook confirms.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/payments/session';
import { getRechargePolicy } from '@/lib/payments/wallet-policy';
import { createPayment } from '@/lib/payments/orchestrator';
import { sanitizeNote } from '@/lib/payments/sanitize';
import { assertPositiveAmount } from '@/lib/payments/money';

const n = (d: any) => (d == null ? 0 : Number(d));

/** Look up an OPEN payment request that this payer is allowed to settle. */
async function resolveRequest(reference: string, user: { id: string; email: string }) {
  const pr = await prisma.paymentRequest.findUnique({ where: { reference } });
  if (!pr) return { error: 'Payment request not found.', status: 404 as const };
  if (pr.status !== 'OPEN' && pr.status !== 'SENT') return { error: `This payment request is ${pr.status.toLowerCase()}.`, status: 409 as const };
  if (pr.expiresAt && new Date(pr.expiresAt) < new Date()) return { error: 'This payment request has expired.', status: 409 as const };
  // If targeted, only the intended payer may pay it.
  const targeted = pr.payerUserId || pr.payerEmail;
  if (targeted) {
    const matches = (pr.payerUserId && pr.payerUserId === user.id) || (pr.payerEmail && pr.payerEmail.toLowerCase() === user.email.toLowerCase());
    if (!matches) return { error: 'This payment request is assigned to a different account.', status: 403 as const };
  }
  return { pr };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const ref = req.nextUrl.searchParams.get('ref');
  const policy = await getRechargePolicy();

  if (ref) {
    const r = await resolveRequest(ref, user);
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({
      request: { reference: r.pr.reference, amount: n(r.pr.amount), currency: r.pr.currency, note: r.pr.note, supportCaseId: r.pr.supportCaseId, bookingId: r.pr.bookingId },
      policy: { currency: policy.currency, noteMin: policy.otherPaymentNoteMin, noteMax: policy.otherPaymentNoteMax, maxAmount: policy.otherPaymentMaxAmount },
      payer: { name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email, email: user.email },
    });
  }

  return NextResponse.json({
    policy: { currency: policy.currency, noteMin: policy.otherPaymentNoteMin, noteMax: policy.otherPaymentNoteMax, maxAmount: policy.otherPaymentMaxAmount },
    payer: { name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email, email: user.email },
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const policy = await getRechargePolicy();
    const isAgent = user.role === 'FAREMIND_AGENT';
    const payerName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email;

    let amount: number;
    let currency: string;
    let note: string;
    let paymentRequestId: string | null = null;
    let supportCaseId: string | null = null;
    let bookingId: string | null = null;

    const ref = (body as any).paymentRequestReference || (body as any).ref;
    if (ref) {
      // ── Structured request: trust the REQUEST for money/note, not the client ──
      const r = await resolveRequest(String(ref), user);
      if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
      amount = n(r.pr.amount);
      currency = r.pr.currency;
      note = r.pr.note;
      paymentRequestId = r.pr.id;
      supportCaseId = r.pr.supportCaseId;
      bookingId = r.pr.bookingId;
    } else {
      // ── Ad-hoc: validate client-supplied amount + note ──
      try {
        amount = assertPositiveAmount((body as any).amount, 'payment amount');
      } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      if (amount > policy.otherPaymentMaxAmount) {
        return NextResponse.json({ error: `Amount exceeds the maximum of ${policy.currency} ${policy.otherPaymentMaxAmount}. Please contact support for a payment request.` }, { status: 400 });
      }
      try {
        note = sanitizeNote((body as any).note, { min: policy.otherPaymentNoteMin, max: policy.otherPaymentNoteMax, label: 'payment note' });
      } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      currency = ((body as any).currency || policy.currency).toString().toUpperCase().slice(0, 3);
      supportCaseId = (body as any).supportCaseId ? String((body as any).supportCaseId) : null;
    }

    const result = await createPayment({
      purpose: 'OTHER_PAYMENT',
      amount,
      currency,
      serviceType: 'OTHER',
      description: `Other payment — ${note.slice(0, 80)}`,
      userId: user.id,
      agentId: isAgent ? user.id : null,
      customerEmail: user.email,
      customerName: payerName,
      customerPhone: user.phone,
      requestedBy: isAgent ? 'AGENT' : 'USER',
      paymentRequestId,
      supportCaseId,
      bookingId,
      notes: note,
    });

    return NextResponse.json({ paymentId: result.paymentId, clientSecret: result.clientSecret, amount, currency });
  } catch (err: any) {
    console.error('[POST /api/payments/other]', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
