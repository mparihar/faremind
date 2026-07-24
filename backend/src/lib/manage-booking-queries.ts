/**
 * Manage-Booking Database Queries
 *
 * Separate query file for post-booking management operations.
 * Does NOT modify or overlap with existing db-queries.ts.
 */

import { prisma } from './db';

// ═══════════════════════════════════════════════
// MASTER BOOKING LOOKUPS
// ═══════════════════════════════════════════════

/** Lookup by booking reference + last name (guest access).
 *  Matches on masterBookingReference, masterPnr, airline PNR (pnrCode),
 *  or providerOrderId so guests can look up via the PNR they received.
 */
export async function lookupMasterBooking(ref: string, lastName: string) {
  // Try direct master-level match first
  let booking = await prisma.masterBooking.findFirst({
    where: {
      OR: [
        { masterBookingReference: ref },
        { masterPnr: ref },
      ],
    },
    include: {
      passengers: true,
      journeys: { orderBy: { journeyOrder: 'asc' } },
      pnrs: true,
    },
  });

  // If not found, search by airline PNR or provider order ID
  if (!booking) {
    const pnrMatch = await prisma.bookingPnr.findFirst({
      where: {
        OR: [
          { pnrCode: ref },
          { providerOrderId: ref },
        ],
      },
      select: { bookingId: true },
    });
    if (pnrMatch) {
      booking = await prisma.masterBooking.findUnique({
        where: { id: pnrMatch.bookingId },
        include: {
          passengers: true,
          journeys: { orderBy: { journeyOrder: 'asc' } },
          pnrs: true,
        },
      });
    }
  }

  if (!booking) return null;

  // Verify last name matches at least one passenger
  const match = booking.passengers.some(
    (p) => p.lastName.toLowerCase() === lastName.toLowerCase()
  );
  if (!match) return null;

  return booking;
}

/** Full booking detail with all relations */
export async function getMasterBookingFull(bookingId: string) {
  return prisma.masterBooking.findUnique({
    where: { id: bookingId },
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      pnrs: { orderBy: { createdAt: 'asc' } },
      journeys: {
        orderBy: { journeyOrder: 'asc' },
        include: {
          segments: { orderBy: { segmentOrder: 'asc' } },
          seats: true,
          meals: true,
          baggage: true,
        },
      },
      segments: { orderBy: { segmentOrder: 'asc' } },
      passengers: { orderBy: { passengerOrder: 'asc' } },
      tickets: { orderBy: { createdAt: 'asc' } },
      seats: true,
      meals: true,
      baggage: true,
      addons: true,
      payments: { orderBy: { createdAt: 'desc' } },
      commercialCharges: { where: { displayToCustomer: true }, orderBy: { appliedAt: 'asc' } },
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
      notes: { orderBy: { createdAt: 'desc' } },
      providerPayloads: { orderBy: { createdAt: 'desc' }, take: 20 },
      scheduleChange: true,
    },
  });
}

/** User's bookings grouped by status */
export async function getUserMasterBookings(
  userId: string,
  filter?: 'upcoming' | 'past' | 'cancelled' | 'all',
  userEmail?: string,
  includeAgentBookings?: boolean
) {
  const now = new Date();

  // Match by userId or customerEmail to show the user's OWN bookings.
  // When includeAgentBookings is true, also include bookings where
  // this user is the agent (agentUserId), so the AI bot in the agent
  // portal can show all bookings the agent has access to.
  const orClauses: any[] = [{ userId }];
  if (userEmail) {
    orClauses.push({ customerEmail: { equals: userEmail, mode: 'insensitive' } });
  }
  if (includeAgentBookings) {
    orClauses.push({ agentUserId: userId });
  }
  const identityClause = { OR: orClauses };

  const where: any = { ...identityClause };

  if (filter === 'upcoming') {
    where.departureDate = { gte: now };
    where.bookingStatus = { in: ['CREATED', 'CONFIRMED', 'TICKETED'] };
  } else if (filter === 'past') {
    where.departureDate = { lt: now };
    where.bookingStatus = { in: ['CONFIRMED', 'TICKETED', 'COMPLETED'] };
  } else if (filter === 'cancelled') {
    where.bookingStatus = 'CANCELLED';
  }
  // 'all' = no extra filters

  return prisma.masterBooking.findMany({
    where,
    include: {
      journeys: {
        orderBy: { journeyOrder: 'asc' },
        include: { segments: { orderBy: { segmentOrder: 'asc' } } },
      },
      passengers: true,
      pnrs: { where: { isPrimary: true }, take: 1 },
    },
    orderBy: { departureDate: 'desc' },
  });
}

// ═══════════════════════════════════════════════
// BOOKING EVENTS (Timeline)
// ═══════════════════════════════════════════════

export async function createBookingEvent(data: {
  bookingId: string;
  eventType: string;
  eventTitle: string;
  eventDescription?: string;
  actorType?: string;
  actorId?: string;
  actorName?: string;
  payloadJson?: object;
}) {
  return prisma.bookingEvent.create({ data });
}

export async function getBookingTimeline(bookingId: string, limit = 50) {
  return prisma.bookingEvent.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ═══════════════════════════════════════════════
// CANCELLATIONS
// ═══════════════════════════════════════════════

export async function createCancellationRecord(data: {
  bookingId: string;
  requestedBy: string;
  originalAmount: number;
  penaltyAmount?: number;
  airlinePenalty?: number;
  refundAmount?: number;
  currency: string;
  refundMethod?: 'ORIGINAL_PAYMENT' | 'AIRLINE_CREDIT';
  providerCancelId?: string;
  providerResponse?: object;
  providerCancelPayload?: object;
  notes?: string;
}) {
  return prisma.cancellationRecord.create({ data: data as any });
}

export async function updateCancellationStatus(
  id: string,
  status: 'CANCEL_REQUESTED' | 'IN_PROGRESS' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED' | 'FAILED',
  extra?: Record<string, any>
) {
  const updateData: Record<string, any> = { status, ...extra };
  if (status === 'CANCELLED') updateData.cancelledAt = new Date();
  if (status === 'REFUNDED') updateData.refundedAt = new Date();
  if (status === 'FAILED') updateData.failedAt = new Date();
  return prisma.cancellationRecord.update({ where: { id }, data: updateData });
}

export async function getCancellationByBookingId(bookingId: string) {
  return prisma.cancellationRecord.findUnique({ where: { bookingId } });
}

// ═══════════════════════════════════════════════
// CHANGE REQUESTS
// ═══════════════════════════════════════════════

export async function createChangeRequest(data: {
  bookingId: string;
  type: 'DATE_CHANGE' | 'PASSENGER_UPDATE' | 'SEAT_CHANGE' | 'BAGGAGE_CHANGE' | 'UPGRADE' | 'NAME_CORRECTION';
  status?: 'NEW' | 'QUOTED' | 'CUSTOMER_PAYMENT_PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED';
  requestedBy: string;
  originalData?: object;
  requestedData?: object;
  oldItineraryJson?: object;
  newItineraryJson?: object;
  fareDifference?: number;
  penalties?: number;
  totalCost?: number;
  currency?: string;
  providerQuoteId?: string;
  providerResponse?: object;
  expiresAt?: Date;
  confirmedAt?: Date;
  notes?: string;
}) {
  return prisma.changeRequest.create({ data: data as any });
}

export async function getChangeRequestsByBookingId(bookingId: string) {
  return prisma.changeRequest.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateChangeRequestStatus(
  id: string,
  status: 'NEW' | 'QUOTED' | 'CUSTOMER_PAYMENT_PENDING' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED',
  extra?: Record<string, any>
) {
  const updateData: Record<string, any> = { status, ...extra };
  if (status === 'CONFIRMED') updateData.confirmedAt = new Date();
  if (status === 'REJECTED') updateData.rejectedAt = new Date();
  return prisma.changeRequest.update({ where: { id }, data: updateData });
}

// ═══════════════════════════════════════════════
// PASSENGER UPDATES
// ═══════════════════════════════════════════════

export async function createPassengerUpdate(data: {
  bookingId: string;
  passengerId: string;
  fieldName: string;
  oldValue?: string;
  newValue?: string;
  requestedBy: string;
  providerResponse?: object;
}) {
  return prisma.bookingPassengerUpdate.create({ data: data as any });
}

// ═══════════════════════════════════════════════
// PROVIDER PAYLOADS (Audit)
// ═══════════════════════════════════════════════

export async function storeProviderPayload(data: {
  bookingId: string;
  provider: string;
  payloadType: string;
  providerReference?: string;
  payloadJson: object;
}) {
  return prisma.bookingProviderPayload.create({ data });
}

// ═══════════════════════════════════════════════
// ADMIN QUERIES
// ═══════════════════════════════════════════════

export async function getAdminActionQueue(filter?: {
  type?: 'cancellations' | 'changes' | 'all';
  status?: string;
  limit?: number;
}) {
  const limit = filter?.limit || 50;
  const results: any = {};

  if (!filter?.type || filter.type === 'cancellations' || filter.type === 'all') {
    results.cancellations = await prisma.cancellationRecord.findMany({
      where: filter?.status ? { status: filter.status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  if (!filter?.type || filter.type === 'changes' || filter.type === 'all') {
    results.changeRequests = await prisma.changeRequest.findMany({
      where: filter?.status ? { status: filter.status as any } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  return results;
}

export async function addBookingNote(data: {
  bookingId: string;
  noteText: string;
  isInternal?: boolean;
  createdById?: string;
}) {
  return prisma.bookingNote.create({
    data: { ...data, isInternal: data.isInternal ?? true },
  });
}

export async function getBookingNotes(bookingId: string) {
  return prisma.bookingNote.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { fullName: true } } },
  });
}
