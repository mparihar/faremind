/**
 * Admin API — Duffel Assistant Session
 *
 * POST /api/admin/bookings/:id/provider-support/duffel-assistant
 *
 * Creates an ephemeral Duffel component client key so the admin can open
 * the Duffel Assistant for a specific booking. All validation, RBAC, and
 * audit logging happens here.
 *
 * Security:
 * - Protected by withAdmin('SUPPORT') — requires SUPPORT role or higher
 * - Feature flag gated: DUFFEL_ASSISTANT_ENABLED
 * - Only works for Duffel bookings with a providerOrderId
 * - Audit log created on every successful session
 * - DUFFEL_API_TOKEN never exposed to frontend
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import prisma from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';
import {
  isDuffelAssistantEnabled,
  createDuffelAssistantSession,
} from '@/lib/duffel-assistant';

export const POST = withAdmin(async (req: NextRequest, { admin, params }) => {
  const bookingId = params.id;

  // 1. Feature flag check
  const enabled = await isDuffelAssistantEnabled();
  if (!enabled) {
    return NextResponse.json(
      { error: 'Duffel Assistant is currently disabled' },
      { status: 403 },
    );
  }

  // 2. Parse request body
  let issueType = 'other';
  let summary = '';
  try {
    const body = await req.json();
    issueType = body.issueType || 'other';
    summary = body.summary || '';
  } catch {
    // Body is optional — defaults are fine
  }

  // Validate issueType
  if (!['change', 'cancellation', 'other'].includes(issueType)) {
    return NextResponse.json(
      { error: 'Invalid issueType. Must be: change, cancellation, or other' },
      { status: 400 },
    );
  }

  // 3. Fetch booking
  const booking = await prisma.masterBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      masterBookingReference: true,
      primaryProvider: true,
      providerOrderId: true,
      duffelCustomerUserId: true,
      customerName: true,
      masterPnr: true,
      bookingStatus: true,
      providerSupportSessionCount: true,
    },
  });

  if (!booking) {
    // Also try by masterBookingReference
    const byRef = await prisma.masterBooking.findUnique({
      where: { masterBookingReference: bookingId },
      select: {
        id: true,
        masterBookingReference: true,
        primaryProvider: true,
        providerOrderId: true,
        duffelCustomerUserId: true,
        customerName: true,
        masterPnr: true,
        bookingStatus: true,
        providerSupportSessionCount: true,
      },
    });

    if (!byRef) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    // Use the found booking
    return handleSession(req, admin, byRef, issueType, summary);
  }

  return handleSession(req, admin, booking, issueType, summary);
}, 'SUPPORT');

async function handleSession(
  req: NextRequest,
  admin: { sub: string; email: string; role: string },
  booking: {
    id: string;
    masterBookingReference: string;
    primaryProvider: string;
    providerOrderId: string | null;
    duffelCustomerUserId: string | null;
    customerName: string;
    masterPnr: string | null;
    bookingStatus: string;
    providerSupportSessionCount: number;
  },
  issueType: string,
  summary: string,
) {
  // 4. Validate provider is Duffel
  if (booking.primaryProvider.toLowerCase() !== 'duffel') {
    return NextResponse.json(
      { error: 'Provider support assistant is available only for Duffel bookings' },
      { status: 400 },
    );
  }

  // 5. Validate Duffel order ID exists
  if (!booking.providerOrderId) {
    return NextResponse.json(
      { error: 'Duffel Order ID is missing for this booking. Provider support cannot be opened.' },
      { status: 400 },
    );
  }

  // 6. Create Duffel Assistant session
  let session;
  try {
    session = await createDuffelAssistantSession(
      booking.providerOrderId,
      booking.duffelCustomerUserId,
    );
  } catch (err: any) {
    console.error('[provider-support] Duffel session creation failed:', err.message);
    return NextResponse.json(
      { error: 'Unable to open Duffel Assistant right now. Please try again or contact system admin.' },
      { status: 502 },
    );
  }

  // 7. Update booking provider support tracking
  await prisma.masterBooking.update({
    where: { id: booking.id },
    data: {
      lastProviderSupportOpenedAt: new Date(),
      lastProviderSupportOpenedBy: admin.email,
      providerSupportSessionCount: booking.providerSupportSessionCount + 1,
    },
  }).catch((err) => {
    console.error('[provider-support] Failed to update booking tracking:', err);
    // Non-blocking — session was already created
  });

  // 8. Create audit log entry
  await auditLog({
    adminUserId: admin.sub,
    bookingId: booking.id,
    action: 'DUFFEL_ASSISTANT_OPENED',
    entityType: 'PROVIDER_SUPPORT',
    entityId: booking.id,
    metadata: {
      fairmindBookingReference: booking.masterBookingReference,
      duffelOrderId: booking.providerOrderId,
      openedByEmail: admin.email,
      openedByRole: admin.role,
      portalType: 'ADMIN_PORTAL',
      issueType,
      summary,
      sessionNumber: booking.providerSupportSessionCount + 1,
    },
    ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  }).catch((err) => {
    console.error('[provider-support] Failed to create audit log:', err);
    // Non-blocking
  });

  // 9. Return session data (client key only — no API secrets)
  return NextResponse.json({
    clientKey: session.clientKey,
    context: {
      orderId: booking.providerOrderId,
      userId: booking.duffelCustomerUserId || undefined,
      bookingReference: booking.masterBookingReference,
      passengerName: booking.customerName,
      pnr: booking.masterPnr,
      bookingStatus: booking.bookingStatus,
    },
  });
}
