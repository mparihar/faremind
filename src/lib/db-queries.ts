/**
 * Database Query Helpers for FareMind
 *
 * Centralized data access layer for all database operations.
 * Uses Prisma Client for type-safe queries.
 */

import prisma from './db';
import type {
  BookingStatus,
  CabinClass,
  Provider,
  PriceAlertStatus,
} from '@/generated/prisma/client';

// ═══════════════════════════════════════════════
// USER QUERIES
// ═══════════════════════════════════════════════

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      avatar: true,
      role: true,
      createdAt: true,
    },
  });
}

export async function createUser(data: {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string;
}) {
  return prisma.user.create({ data });
}

// ═══════════════════════════════════════════════
// BOOKING QUERIES
// ═══════════════════════════════════════════════

export async function getBookingsByUserId(
  userId: string,
  status?: BookingStatus
) {
  return prisma.booking.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
    },
    include: {
      passengers: true,
      segments: { orderBy: { segmentOrder: 'asc' } },
      priceHistory: {
        orderBy: { checkedAt: 'desc' },
        take: 30,
      },
      priceAlerts: {
        where: { status: 'NEW' },
        orderBy: { detectedAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { departureTime: 'asc' },
  });
}

export async function getBookingById(id: string) {
  return prisma.booking.findUnique({
    where: { id },
    include: {
      passengers: true,
      segments: { orderBy: { segmentOrder: 'asc' } },
      priceHistory: { orderBy: { checkedAt: 'asc' } },
      priceAlerts: { orderBy: { detectedAt: 'desc' } },
      payments: { orderBy: { createdAt: 'desc' } },
      rebookings: { orderBy: { createdAt: 'desc' } },
    },
  });
}

export async function createBooking(data: {
  userId: string;
  provider: Provider;
  providerBookingId?: string;
  providerOfferId?: string;
  pnr?: string;
  status: BookingStatus;
  airlineCode: string;
  airlineName: string;
  originAirport: string;
  originCity: string;
  destinationAirport: string;
  destinationCity: string;
  departureTime: Date;
  arrivalTime: Date;
  totalDuration: number;
  stops: number;
  cabinClass: CabinClass;
  fareClass?: string;
  totalPrice: number;
  baseFare?: number;
  taxes?: number;
  currency: string;
  refundable: boolean;
  changeable: boolean;
  cancellationFee?: number;
  changeFee?: number;
  carryOnBags: number;
  checkedBags: number;
  priceTracking: boolean;
  flightDataSnapshot?: object;
  passengers: {
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    email: string;
    phone?: string;
    type: 'ADULT' | 'CHILD' | 'INFANT';
    passportNumber?: string;
    nationality?: string;
  }[];
  segments: {
    segmentOrder: number;
    depAirport: string;
    depAirportName?: string;
    depCity?: string;
    depTime: Date;
    depTerminal?: string;
    arrAirport: string;
    arrAirportName?: string;
    arrCity?: string;
    arrTime: Date;
    arrTerminal?: string;
    airlineCode: string;
    airlineName?: string;
    flightNumber: string;
    duration: number;
    aircraft?: string;
    operatingCarrier?: string;
  }[];
}) {
  const { passengers, segments, ...bookingData } = data;

  return prisma.booking.create({
    data: {
      ...bookingData,
      passengers: { create: passengers },
      segments: { create: segments },
    },
    include: {
      passengers: true,
      segments: true,
    },
  });
}

export async function updateBookingStatus(id: string, status: BookingStatus) {
  const updateData: Record<string, unknown> = { status };
  if (status === 'CANCELLED') updateData.cancelledAt = new Date();
  if (status === 'COMPLETED') updateData.completedAt = new Date();

  return prisma.booking.update({
    where: { id },
    data: updateData,
  });
}

// ═══════════════════════════════════════════════
// PRICE TRACKING QUERIES
// ═══════════════════════════════════════════════

export async function addPriceHistoryEntry(
  bookingId: string,
  price: number,
  currency: string,
  provider: Provider
) {
  // Update the booking's current tracked price
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      currentTrackedPrice: price,
      lastPriceCheckAt: new Date(),
    },
  });

  return prisma.priceHistory.create({
    data: {
      bookingId,
      price,
      currency,
      provider,
    },
  });
}

export async function getPriceHistory(bookingId: string, limit = 50) {
  return prisma.priceHistory.findMany({
    where: { bookingId },
    orderBy: { checkedAt: 'asc' },
    take: limit,
  });
}

export async function getActiveTrackingJobs(limit = 100) {
  return prisma.priceTrackingJob.findMany({
    where: {
      status: 'ACTIVE',
      nextRunAt: { lte: new Date() },
    },
    orderBy: { nextRunAt: 'asc' },
    take: limit,
  });
}

export async function updateTrackingJob(
  id: string,
  data: {
    lastRunAt?: Date;
    nextRunAt?: Date;
    runCount?: { increment: number };
    errorCount?: { increment: number };
    lastError?: string | null;
    status?: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  }
) {
  return prisma.priceTrackingJob.update({
    where: { id },
    data,
  });
}

// ═══════════════════════════════════════════════
// PRICE ALERTS
// ═══════════════════════════════════════════════

export async function createPriceAlert(data: {
  bookingId: string;
  userId: string;
  bookedPrice: number;
  currentPrice: number;
  savings: number;
  percentDrop: number;
  currency: string;
}) {
  return prisma.priceAlert.create({ data });
}

export async function getPriceAlerts(
  userId: string,
  status?: PriceAlertStatus
) {
  return prisma.priceAlert.findMany({
    where: {
      userId,
      ...(status ? { status } : {}),
    },
    include: {
      booking: {
        select: {
          id: true,
          airlineCode: true,
          airlineName: true,
          originAirport: true,
          originCity: true,
          destinationAirport: true,
          destinationCity: true,
          departureTime: true,
          pnr: true,
        },
      },
    },
    orderBy: { detectedAt: 'desc' },
  });
}

export async function updatePriceAlertStatus(
  id: string,
  status: PriceAlertStatus
) {
  const updateData: Record<string, unknown> = { status };
  if (status === 'NOTIFIED') updateData.notifiedAt = new Date();
  if (status === 'ACTED') updateData.actionedAt = new Date();

  return prisma.priceAlert.update({
    where: { id },
    data: updateData,
  });
}

// ═══════════════════════════════════════════════
// SEARCH HISTORY
// ═══════════════════════════════════════════════

export async function logSearch(data: {
  userId?: string;
  origin: string;
  destination: string;
  departureDate: Date;
  returnDate?: Date;
  adults: number;
  children?: number;
  infants?: number;
  cabinClass: CabinClass;
  tripType: 'ONE_WAY' | 'ROUND_TRIP' | 'MULTI_CITY';
  resultsCount?: number;
  lowestPrice?: number;
  currency?: string;
  searchDurationMs?: number;
}) {
  return prisma.searchHistory.create({ data });
}

export async function getSearchHistory(userId: string, limit = 20) {
  return prisma.searchHistory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ═══════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════

export async function createNotification(data: {
  userId: string;
  bookingId?: string;
  type: 'BOOKING_CONFIRMATION' | 'BOOKING_CANCELLATION' | 'PRICE_DROP' | 'REBOOKING_OFFER' | 'REBOOKING_SUCCESS' | 'PRICE_ALERT' | 'SYSTEM';
  channel?: 'EMAIL' | 'PUSH' | 'IN_APP';
  title: string;
  body: string;
  metadata?: object;
}) {
  return prisma.notification.create({
    data: {
      ...data,
      channel: data.channel || 'IN_APP',
    },
  });
}

export async function getUserNotifications(userId: string, limit = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function markNotificationRead(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { readAt: new Date(), status: 'READ' },
  });
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: {
      userId,
      readAt: null,
      status: { in: ['DELIVERED', 'SENT'] },
    },
  });
}

// ═══════════════════════════════════════════════
// REFERENCE DATA
// ═══════════════════════════════════════════════

export async function searchAirports(query: string, limit = 10) {
  return prisma.airport.findMany({
    where: {
      isActive: true,
      OR: [
        { iataCode: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
        { country: { contains: query, mode: 'insensitive' } },
      ],
    },
    take: limit,
    orderBy: { city: 'asc' },
  });
}

export async function getAirline(iataCode: string) {
  return prisma.airline.findUnique({
    where: { iataCode },
  });
}

export async function getAllAirlines() {
  return prisma.airline.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
}

// ═══════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════

export async function createPayment(data: {
  bookingId: string;
  stripePaymentId?: string;
  stripeCustomerId?: string;
  type: 'BOOKING' | 'REBOOKING' | 'REFUND' | 'PLATFORM_FEE';
  amount: number;
  currency: string;
  description?: string;
  metadata?: object;
}) {
  return prisma.payment.create({ data });
}

export async function updatePaymentStatus(
  id: string,
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REFUNDED',
  extra?: { failureReason?: string; refundedAmount?: number }
) {
  const updateData: Record<string, unknown> = { status };
  if (status === 'COMPLETED') updateData.processedAt = new Date();
  if (status === 'FAILED') {
    updateData.failedAt = new Date();
    if (extra?.failureReason) updateData.failureReason = extra.failureReason;
  }
  if (status === 'REFUNDED' && extra?.refundedAmount) {
    updateData.refundedAmount = extra.refundedAmount;
    updateData.refundedAt = new Date();
  }

  return prisma.payment.update({
    where: { id },
    data: updateData,
  });
}

// ═══════════════════════════════════════════════
// LEDGER
// ═══════════════════════════════════════════════

export async function addLedgerEntry(data: {
  type: 'BOOKING_PAYMENT' | 'REBOOKING_COST' | 'CANCELLATION_REFUND' | 'PLATFORM_FEE' | 'SAVINGS_CREDIT';
  bookingId?: string;
  rebookingId?: string;
  paymentId?: string;
  amount: number;
  currency: string;
  description?: string;
}) {
  return prisma.ledgerEntry.create({ data });
}

// ═══════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════

export async function getDashboardStats(userId: string) {
  const [
    activeBookings,
    trackedFlights,
    newAlerts,
    totalSavings,
  ] = await Promise.all([
    prisma.booking.count({
      where: { userId, status: { in: ['CONFIRMED', 'TICKETED'] } },
    }),
    prisma.booking.count({
      where: { userId, priceTracking: true, status: 'CONFIRMED' },
    }),
    prisma.priceAlert.count({
      where: { userId, status: 'NEW' },
    }),
    prisma.priceAlert.aggregate({
      where: { userId, status: { in: ['NOTIFIED', 'ACTED'] } },
      _sum: { savings: true },
    }),
  ]);

  return {
    activeBookings,
    trackedFlights,
    newAlerts,
    totalSavings: Number(totalSavings._sum.savings || 0),
  };
}
