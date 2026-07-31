/**
 * POST /api/admin/blocked-bookings/:id/assign
 * Admin/Support: reassign a BLOCKED_WALLET_LIMIT booking back to its original
 * agent (after the agent recharged). Delegates to the backend wallet service,
 * which verifies balance → attributes → deducts → recalculates → re-enables +
 * audits. RBAC: SUPPORT+.
 */
import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { auditLog } from '@/lib/admin-auth';

const BACKEND = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export const POST = withAdmin(async (_req, { admin, params }) => {
  const bookingId = params.id;
  if (!bookingId) return NextResponse.json({ error: 'Missing booking id' }, { status: 400 });
  try {
    const res = await fetch(`${BACKEND}/api/agent-wallet/reassign-booking`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId, actor: admin.email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return NextResponse.json({ error: data.error || 'Reassignment failed.' }, { status: res.status || 400 });
    }
    await auditLog({ adminUserId: admin.sub, action: 'BLOCKED_BOOKING_REASSIGN', entityType: 'MasterBooking', entityId: bookingId, after: { bookingRef: data.bookingRef, reactivated: data.reactivated, wallet: data.wallet } }).catch(() => {});
    return NextResponse.json({ success: true, bookingRef: data.bookingRef, reactivated: data.reactivated, wallet: data.wallet });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Reassignment failed.' }, { status: 502 });
  }
}, 'SUPPORT');
