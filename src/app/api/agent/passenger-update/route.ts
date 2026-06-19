// FILE: src/app/api/agent/passenger-update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { withAgent } from '@/lib/agent-auth';
import { prisma } from '@/lib/db';

// Only these fields can be updated by agents
const EDITABLE_FIELDS = ['email', 'phone', 'nationality', 'passportNumber', 'passportExpiry', 'issuingCountry'];
const IDENTITY_FIELDS = ['firstName', 'middleName', 'lastName', 'dateOfBirth', 'gender'];

export const POST = withAgent(async (req: NextRequest, { agent }) => {
  const body = await req.json();
  const { bookingReference, passengerId, updates } = body;

  if (!bookingReference || !passengerId || !updates) {
    return NextResponse.json({ error: 'bookingReference, passengerId, and updates are required' }, { status: 400 });
  }

  // Verify ownership
  const booking = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: bookingReference, agentUserId: agent.id },
    select: { id: true },
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

  // Create update request record
  const before: Record<string, any> = {};
  for (const key of Object.keys(safeUpdates)) {
    before[key] = (passenger as any)[key] ?? null;
  }

  // Apply the updates
  await prisma.bookingPassenger.update({
    where: { id: passengerId },
    data: safeUpdates,
  });

  // Log the update as a booking event
  try {
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        type: 'PASSENGER_UPDATED',
        title: 'Passenger details updated by agent',
        description: `Agent ${agent.name} updated: ${Object.keys(safeUpdates).join(', ')}`,
        metadata: {
          agent: agent.email,
          passengerId,
          fields: Object.keys(safeUpdates),
          before,
          after: safeUpdates,
          requestedByRole: 'AGENT',
        },
      },
    });
  } catch {
    // Non-critical logging failure
  }

  return NextResponse.json({
    success: true,
    updatedFields: Object.keys(safeUpdates),
    note: 'Identity fields (name, DOB, gender) cannot be edited directly after booking.',
  });
});
