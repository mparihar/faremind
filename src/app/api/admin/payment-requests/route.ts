/**
 * Admin/Support: structured "Other Payment" requests.
 *   GET  /api/admin/payment-requests        → list (filters: status, search)
 *   POST /api/admin/payment-requests         → create a request for a payer
 * RBAC: SUPPORT+ (create + view).
 */
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { auditLog } from '@/lib/admin-auth';
import { prisma } from '@/lib/db';
import { assertPositiveAmount } from '@/lib/payments/money';
import { sanitizeNote } from '@/lib/payments/sanitize';
import { getRechargePolicy } from '@/lib/payments/wallet-policy';

const n = (d: any) => (d == null ? 0 : Number(d));

export const GET = withAdmin(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search')?.trim();
  const where: any = {};
  if (status) where.status = status;
  if (search) where.OR = [
    { reference: { contains: search, mode: 'insensitive' } },
    { payerEmail: { contains: search, mode: 'insensitive' } },
    { payerName: { contains: search, mode: 'insensitive' } },
  ];
  const rows = await prisma.paymentRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id, reference: r.reference, amount: n(r.amount), currency: r.currency, note: r.note,
      payerEmail: r.payerEmail, payerName: r.payerName, status: r.status, supportCaseId: r.supportCaseId,
      bookingId: r.bookingId, createdByEmail: r.createdByEmail, expiresAt: r.expiresAt,
      paidTransactionId: r.paidTransactionId, paidAt: r.paidAt, createdAt: r.createdAt,
    })),
  });
}, 'SUPPORT');

export const POST = withAdmin(async (req, { admin }) => {
  const body = await req.json().catch(() => ({}));
  const policy = await getRechargePolicy();

  let amount: number;
  try { amount = assertPositiveAmount((body as any).amount, 'amount'); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }

  let note: string;
  try { note = sanitizeNote((body as any).note, { min: policy.otherPaymentNoteMin, max: policy.otherPaymentNoteMax, label: 'reason' }); }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }

  const currency = ((body as any).currency || policy.currency).toString().toUpperCase().slice(0, 3);
  const payerEmail = (body as any).payerEmail ? String((body as any).payerEmail).trim().toLowerCase() : null;
  const payerName = (body as any).payerName ? String((body as any).payerName).trim() : null;

  // Resolve a known payer user (optional) so the request can be targeted.
  let payerUserId: string | null = null;
  if (payerEmail) {
    const u = await prisma.user.findFirst({ where: { email: { equals: payerEmail, mode: 'insensitive' } }, select: { id: true } });
    payerUserId = u?.id ?? null;
  }

  const count = await prisma.paymentRequest.count();
  const reference = `FM-PR-${String(count + 1).padStart(4, '0')}`;
  const expiresAt = (body as any).expiresInDays ? new Date(Date.now() + Number((body as any).expiresInDays) * 86400000) : null;

  const pr = await prisma.paymentRequest.create({
    data: {
      reference, purpose: 'OTHER_PAYMENT', amount, currency, note,
      payerUserId, payerEmail, payerName,
      supportCaseId: (body as any).supportCaseId ? String((body as any).supportCaseId) : null,
      bookingId: (body as any).bookingId ? String((body as any).bookingId) : null,
      status: 'OPEN', createdByType: 'ADMIN', createdById: admin.sub, createdByEmail: admin.email, expiresAt,
    },
  });

  await auditLog({ adminUserId: admin.sub, action: 'PAYMENT_REQUEST_CREATE', entityType: 'PaymentRequest', entityId: pr.id, after: { reference, amount, currency, payerEmail } }).catch(() => {});
  return NextResponse.json({ success: true, request: { id: pr.id, reference: pr.reference, amount: n(pr.amount), currency: pr.currency, status: pr.status } });
}, 'SUPPORT');
