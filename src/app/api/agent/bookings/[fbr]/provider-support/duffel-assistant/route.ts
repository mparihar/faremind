/**
 * Agent API — Duffel Assistant Session
 *
 * POST /api/agent/bookings/:fbr/provider-support/duffel-assistant
 *
 * Creates an ephemeral Duffel component client key so the agent can open
 * the Duffel Assistant for a booking they own or are assigned to.
 *
 * Security:
 * - Protected by withAgent() — requires FAREMIND_AGENT role
 * - Agent must own or be assigned to the booking
 * - Feature flag gated: DUFFEL_ASSISTANT_ENABLED
 * - Only works for Duffel bookings with a providerOrderId
 * - Audit log created on every successful session
 * - DUFFEL_API_TOKEN never exposed to frontend
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';
import {
  isDuffelAssistantEnabled,
  createDuffelAssistantSession,
} from '@/lib/duffel-assistant';

export const POST = withAgent(async (req: NextRequest, { agent, params }) => {
  const fbr = params.fbr;

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

  // 3. Fetch booking — agent must own or be assigned to the booking
  const booking = await prisma.masterBooking.findFirst({
    where: {
      masterBookingReference: fbr,
      OR: [
        { agentUserId: agent.id },
        { userId: agent.id },
      ],
    },
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
    return NextResponse.json(
      { error: 'Booking not found or access denied' },
      { status: 404 },
    );
  }

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
    console.error('[provider-support/agent] Duffel session creation failed:', err.message);
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
      lastProviderSupportOpenedBy: agent.email,
      providerSupportSessionCount: booking.providerSupportSessionCount + 1,
    },
  }).catch((err) => {
    console.error('[provider-support/agent] Failed to update booking tracking:', err);
  });

  // 8. Create audit log entry
  await auditLog({
    bookingId: booking.id,
    action: 'DUFFEL_ASSISTANT_OPENED',
    entityType: 'PROVIDER_SUPPORT',
    entityId: booking.id,
    metadata: {
      fairmindBookingReference: booking.masterBookingReference,
      duffelOrderId: booking.providerOrderId,
      openedByUserId: agent.id,
      openedByEmail: agent.email,
      openedByRole: 'FAREMIND_AGENT',
      portalType: 'AGENT_PORTAL',
      issueType,
      summary,
      sessionNumber: booking.providerSupportSessionCount + 1,
    },
    ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  }).catch((err) => {
    console.error('[provider-support/agent] Failed to create audit log:', err);
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
});
