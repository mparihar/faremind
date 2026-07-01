// FILE: src/app/api/agent/passenger-update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';
import { agentNotifyAll } from '@/lib/agent-notify';

// Only these fields can be updated by agents
const EDITABLE_FIELDS = ['email', 'phone', 'nationality', 'passportNumber', 'passportExpiry', 'issuingCountry'];
const IDENTITY_FIELDS = ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender'];

const FIELD_LABELS: Record<string, string> = {
  email: 'Email Address',
  phone: 'Phone Number',
  nationality: 'Nationality',
  passportNumber: 'Passport Number',
  passportExpiry: 'Passport Expiry Date',
  issuingCountry: 'Passport Issuing Country',
};

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  const body = await req.json();
  const { bookingReference, passengerId, updates } = body;

  if (!bookingReference || !passengerId || !updates) {
    return NextResponse.json({ error: 'bookingReference, passengerId, and updates are required' }, { status: 400 });
  }

  // Verify ownership
  const booking = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: bookingReference, agentUserId: agent.id },
    select: {
      id: true,
      masterBookingReference: true,
      masterPnr: true,
      customerName: true,
      customerEmail: true,
      originAirport: true,
      destinationAirport: true,
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found or access denied' }, { status: 404 });
  }

  // Check for identity field violations
  const attemptedIdentityChanges = Object.keys(updates).filter((k) => IDENTITY_FIELDS.includes(k));
  if (attemptedIdentityChanges.length > 0) {
    return NextResponse.json({
      error: `Identity fields cannot be edited after booking: ${attemptedIdentityChanges.join(', ')}. Contact Admin/Super Admin for identity changes.`,
      identityFields: attemptedIdentityChanges,
    }, { status: 403 });
  }

  // Filter to only editable fields
  const safeUpdates: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (EDITABLE_FIELDS.includes(key) && typeof value === 'string') {
      safeUpdates[key] = value;
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return NextResponse.json({ error: 'No valid editable fields provided' }, { status: 400 });
  }

  // Find the passenger
  const passenger = await prisma.bookingPassenger.findFirst({
    where: { id: passengerId, bookingId: booking.id },
  });

  if (!passenger) {
    return NextResponse.json({ error: 'Passenger not found' }, { status: 404 });
  }

  // Capture before values
  const before: Record<string, any> = {};
  for (const key of Object.keys(safeUpdates)) {
    before[key] = (passenger as any)[key] ?? null;
  }

  // Apply the updates — convert DateTime fields
  const prismaData: Record<string, any> = { ...safeUpdates };
  if (prismaData.passportExpiry) {
    const parsed = new Date(prismaData.passportExpiry);
    prismaData.passportExpiry = isNaN(parsed.getTime()) ? null : parsed;
  }

  try {
    await prisma.bookingPassenger.update({
      where: { id: passengerId },
      data: prismaData,
    });
  } catch (err) {
    console.error('[passenger-update] Prisma update failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to update passenger details' }, { status: 500 });
  }

  // Log the update as a booking event (correct Prisma field names)
  try {
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'PASSENGER_UPDATED',
        eventTitle: 'Passenger details updated by agent',
        eventDescription: `Agent ${agent.name} updated: ${Object.keys(safeUpdates).join(', ')}`,
        actorType: 'agent',
        actorId: agent.id,
        actorName: agent.name,
        payloadJson: {
          passengerId,
          fields: Object.keys(safeUpdates),
          before,
          after: safeUpdates,
        },
      },
    });
  } catch (err) {
    console.error('[passenger-update] Event log failed:', err instanceof Error ? err.message : err);
  }

  // Send email notifications to ALL parties
  const ref = booking.masterBookingReference;
  const route = `${booking.originAirport} - ${booking.destinationAirport}`;
  const paxName = `${passenger.firstName} ${passenger.lastName}`.trim();
  const changesHtml = Object.entries(safeUpdates)
    .map(([key, val]) => `<tr><td style="padding:6px 0;color:#64748b;">${FIELD_LABELS[key] || key}</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${before[key] || '—'} → <strong>${val}</strong></td></tr>`)
    .join('');
  const changesText = Object.entries(safeUpdates)
    .map(([key, val]) => `${FIELD_LABELS[key] || key}: ${before[key] || '—'} → ${val}`)
    .join(', ');

  agentNotifyAll({
    event: 'Passenger Update',
    bookingRef: ref,
    pnr: booking.masterPnr ?? ref,
    customerName: booking.customerName ?? 'Traveler',
    customerEmail: booking.customerEmail || undefined,
    route,
    agentName: agent.name,
    agentEmail: agent.email,
    subject: `Passenger details updated – ${ref}`,
    adminSubject: `[FAREMIND] Agent Passenger Update – ${ref}`,
    bodyHtml: `
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">Passenger Details Updated</h2>
      <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
        Hi <strong style="color:#0f172a">${booking.customerName ?? 'Traveler'}</strong>, the following passenger details have been updated for booking <strong>${ref}</strong>.
      </p>
      <div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:12px;padding:20px;margin-bottom:20px;">
        <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#0f172a;">Passenger: ${paxName}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          ${changesHtml}
        </table>
      </div>
      <p style="margin:0 0 16px;color:#64748b;font-size:14px;">If you did not request these changes, please contact FAREMIND support immediately.</p>
      <p style="margin:0;color:#0f172a;font-size:14px;font-weight:600;">FAREMIND</p>
      <p style="margin:4px 0;color:#1abc9c;font-size:12px;font-weight:600;">Your Personal Travel Consultant</p>
    `,
    adminBodyHtml: `
      <h2 style="margin:0 0 8px;color:#0f172a;font-size:20px;font-weight:800;">✏️ Agent Passenger Update</h2>
      <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.6;">
        Agent <strong style="color:#0f172a">${agent.name}</strong> (${agent.email}) updated passenger details.
      </p>
      <div style="background:#f0fdf4;border:1px solid #22c55e;border-radius:12px;padding:20px;margin-bottom:20px;">
        <p style="margin:0 0 4px;font-size:13px;color:#64748b;">Booking: <strong style="color:#0f172a">${ref}</strong> | ${route}</p>
        <p style="margin:0 0 12px;font-size:13px;color:#64748b;">Passenger: <strong style="color:#0f172a">${paxName}</strong></p>
        <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
          ${changesHtml}
        </table>
      </div>
    `,
    bodyText: `Passenger ${paxName} updated for booking ${ref}. Changes: ${changesText}`,
  }).catch(err => console.error('[passenger-update] Notify failed:', err));

  return NextResponse.json({
    success: true,
    updatedFields: Object.keys(safeUpdates),
    note: 'Identity fields (name, DOB, gender) cannot be edited directly after booking.',
  });
});
