/**
 * Manage-Booking Routes â€” Post-Booking Management API
 * NEW route plugin â€” does NOT modify any existing routes.
 */

import { FastifyPluginAsync } from 'fastify';
import { getProvider } from '../services/provider-adapter';
import { initiateCancellation, getAdminServiceFee as getCancelServiceFee, queueCancellationForIssuance } from '../services/cancellation-orchestrator';
import { getReissueQuote, initiateReissue } from '../services/reissue-orchestrator';
import { toUsd } from '../services/fx';
import { chargeOriginalCard, refundCollection } from '../services/customer-collect';
import { buildPtrPassengers } from '../lib/ptr-passengers';
import { backfillEticketsFromTripDetails } from '../lib/eticket-backfill';
import { MystiflyCancellationError } from '../providers/mystifly/mystifly.errors';
import * as mbq from '../lib/manage-booking-queries';
import * as emails from '../lib/manage-booking-emails';
import { prisma } from '../lib/db';
import { createHash, randomBytes } from 'crypto';
import { fireNotification } from '../lib/notify';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { typescript: true });

function hashOtp(otp: string): string { return createHash('sha256').update(otp).digest('hex'); }
function generateOtp(): string { return String(Math.floor(100_000 + Math.random() * 900_000)); }
function fmtCurrency(n: number, c = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n); }

// Master OTP for super admin
const MASTER_OTP = '778899';
const SUPER_ADMIN_EMAILS = ['mparihar@gmail.com'];

const BREVO_URL    = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL ?? 'noreply@faremind.ai';
const SENDER_NAME  = 'FAREMIND';

async function getAdminServiceFee(booking: any): Promise<number> {
  try {
    const rules = await prisma.platformFeeRule.findMany({
      where: {
        feeType: 'SERVICE_FEE',
        active: true,
        deletedAt: null,
      },
      orderBy: { priority: 'desc' },
    });

    const primaryPnr = booking.pnrs.find((p: any) => p.isPrimary) ?? booking.pnrs[0];
    const cabin = primaryPnr?.cabinClass || 'ECONOMY';
    const provider = booking.primaryProvider || 'DUFFEL';
    const tripType = booking.tripType || 'ROUND_TRIP';

    const now = new Date();

    const matchesRule = (r: any) => {
      if (new Date(r.effectiveFrom) > now) return false;
      if (r.effectiveTo && new Date(r.effectiveTo) < now) return false;
      if (r.providerScope !== 'ALL' && r.providerScope.toLowerCase() !== provider.toLowerCase()) return false;

      if (r.cabinScope !== 'ALL') {
        const normalizedCabin = cabin.toLowerCase().replace(/\s+/g, '_');
        const normalizedScope = r.cabinScope.toLowerCase().replace(/\s+/g, '_');
        if (normalizedScope !== normalizedCabin) {
          if (normalizedScope === 'economy' && !normalizedCabin.startsWith('economy')) return false;
          if (normalizedScope === 'premium_economy' && !normalizedCabin.startsWith('premium_economy')) return false;
          if (normalizedScope === 'business' && !normalizedCabin.startsWith('business')) return false;
        }
      }

      if (r.tripTypeScope !== 'ALL' && r.tripTypeScope !== tripType) return false;
      return true;
    };

    const passengersCount = booking.passengers?.length || 1;
    const baseFare = Number(booking.totalAmount);

    const matchedRule = rules.find(matchesRule);
    if (!matchedRule) return 0; // no active rule configured â€” no fee


    if (matchedRule.calculationModel === 'FIXED_PER_BOOKING') {
      return Number(matchedRule.fixedAmount ?? 20);
    } else if (matchedRule.calculationModel === 'FIXED_PER_TRAVELER') {
      return Number(matchedRule.fixedAmount ?? 20) * passengersCount;
    } else if (matchedRule.calculationModel === 'PERCENTAGE_OF_FARE' || matchedRule.calculationModel === 'PERCENTAGE_OF_BOOKING_TOTAL') {
      return Math.round(baseFare * (Number(matchedRule.percentageValue ?? 0) / 100));
    } else if (matchedRule.calculationModel === 'HYBRID') {
      return Math.round(Number(matchedRule.fixedAmount ?? 20) * passengersCount + baseFare * (Number(matchedRule.percentageValue ?? 0) / 100));
    }

    return 0; // unknown model â€” no fee
  } catch (err) {
    console.error('[getAdminServiceFee] Error calculating admin service fee:', err);
    return 0; // DB error â€” no fee rather than guess
  }
}

// â”€â”€ Idempotency lock for cancellation operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Prevents duplicate void/refund calls from double-clicks or retries.
// Key: bookingId, Value: timestamp when lock was acquired.
const cancellationLocks = new Map<string, number>();
const CANCEL_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

function acquireCancelLock(bookingId: string): boolean {
  const now = Date.now();
  const existing = cancellationLocks.get(bookingId);
  if (existing && (now - existing) < CANCEL_LOCK_TTL_MS) {
    return false; // Lock still held
  }
  cancellationLocks.set(bookingId, now);
  return true;
}

function releaseCancelLock(bookingId: string): void {
  cancellationLocks.delete(bookingId);
}

/**
 * Create a support ticket for the admin support queue when a cancellation
 * cannot be processed automatically (e.g. provider API failure, no order linked).
 */
async function createCancellationSupportTicket(booking: any, reason: string): Promise<void> {
  try {
    const route = `${booking.originAirport} â†’ ${booking.destinationAirport}`;
    const amount = fmtCurrency(Number(booking.totalAmount), booking.currency);
    const passengerCount = booking.passengers?.length ?? 0;
    const passengerList = (booking.passengers || []).map((p: any) =>
      `  â€¢ ${p.firstName} ${p.lastName} (${p.passengerType || 'Adult'})${p.ticketNumber ? ` â€” Ticket: ${p.ticketNumber}` : ''}`
    ).join('\n');
    const pnrList = (booking.pnrs || []).map((p: any) =>
      `  â€¢ ${p.pnrCode} (${p.providerName || booking.primaryProvider || 'N/A'}) â€” Status: ${p.status || 'Unknown'}`
    ).join('\n');

    await prisma.supportTicket.create({
      data: {
        subject: `Cancellation Assistance Required: ${booking.masterBookingReference} â€” ${booking.customerName ?? 'Customer'}`,
        description: [
          `A cancellation could not be processed automatically for booking ${booking.masterBookingReference}.`,
          '',
          'â”€â”€ Booking Details â”€â”€',
          `Reference: ${booking.masterBookingReference}`,
          `Airline PNR: ${booking.masterPnr ?? 'N/A'}`,
          `Route: ${route}`,
          `Departure: ${booking.departureDate ? new Date(booking.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}`,
          `Amount: ${amount}`,
          `Provider: ${booking.primaryProvider ?? 'Unknown'}`,
          `Booking Status: ${booking.bookingStatus ?? 'N/A'}`,
          `Ticketing Status: ${booking.ticketingStatus ?? 'N/A'}`,
          '',
          'â”€â”€ Customer â”€â”€',
          `Name: ${booking.customerName ?? 'N/A'}`,
          `Email: ${booking.customerEmail ?? 'N/A'}`,
          '',
          `â”€â”€ Passengers (${passengerCount}) â”€â”€`,
          passengerList || '  No passenger data available',
          '',
          'â”€â”€ PNR Records â”€â”€',
          pnrList || '  No PNR data available',
          '',
          'â”€â”€ Failure Reason â”€â”€',
          reason,
          '',
          'Action Required: Please review this booking and manually process the cancellation with the airline provider.',
        ].join('\n'),
        priority: 'HIGH',
        status: 'OPEN',
        category: 'Cancellation Request',
        channel: 'SYSTEM',
        customerName: booking.customerName ?? '',
        customerEmail: booking.customerEmail ?? '',
        bookingRef: booking.masterBookingReference,
        airlinePnr: booking.masterPnr ?? undefined,
      },
    });

    // Also log a booking event so it's visible in the timeline
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'CANCELLATION_ESCALATED',
        eventTitle: 'Cancellation escalated to admin support',
        eventDescription: `Auto-cancellation unavailable: ${reason}. Support ticket created for manual processing.`,
        actorType: 'system',
      },
    }).catch(() => {}); // non-critical
  } catch (err) {
    console.error('[createCancellationSupportTicket] Failed to create support ticket:', err);
  }
}

/**
 * Auto-creates a support ticket when a flight change could not be processed automatically.
 * Includes PNR, route, customer, requested date, and the provider error.
 */
async function createFlightChangeSupportTicket(
  booking: any,
  reason: string,
  newDepartureDate?: string,
): Promise<void> {
  try {
    const route = `${booking.originAirport} â†’ ${booking.destinationAirport}`;
    const amount = fmtCurrency(Number(booking.totalAmount), booking.currency);
    const providerPnr = booking.pnrs?.find((p: any) => p.providerOrderId);
    const airlinePnr = providerPnr?.airlinePnr || booking.masterPnr || 'N/A';
    const providerOrderId = providerPnr?.providerOrderId || (booking as any).providerOrderId || 'N/A';

    await prisma.supportTicket.create({
      data: {
        subject: `Flight Change Assistance: ${booking.masterBookingReference} â€” ${booking.customerName ?? 'Customer'}`,
        description: [
          `A flight change could not be processed automatically for booking ${booking.masterBookingReference}.`,
          '',
          `Customer: ${booking.customerName ?? 'N/A'} (${booking.customerEmail ?? 'N/A'})`,
          `Route: ${route}`,
          `Current Departure: ${booking.departureDate ? new Date(booking.departureDate).toISOString().split('T')[0] : 'N/A'}`,
          `Requested New Departure: ${newDepartureDate || 'N/A'}`,
          `Booking Amount: ${amount}`,
          `Provider: ${booking.primaryProvider ?? 'Unknown'}`,
          `PNR (Airline): ${airlinePnr}`,
          `Provider Order ID: ${providerOrderId}`,
          `Master Booking Ref: ${booking.masterBookingReference}`,
          '',
          `Reason: ${reason}`,
          '',
          'Action Required: Please review this booking and manually process the flight change with the airline/provider.',
        ].join('\n'),
        priority: 'HIGH',
        status: 'OPEN',
        category: 'Flight Change Request',
        channel: 'SYSTEM',
        customerName: booking.customerName ?? '',
        customerEmail: booking.customerEmail ?? '',
        bookingRef: booking.masterBookingReference,
        airlinePnr: booking.masterPnr ?? undefined,
      },
    });

    // Also log a booking event so it's visible in the timeline
    await prisma.bookingEvent.create({
      data: {
        bookingId: booking.id,
        eventType: 'CHANGE_ESCALATED',
        eventTitle: 'Flight change escalated to admin support',
        eventDescription: `Auto-change unavailable: ${reason}. Support ticket created for manual processing.`,
        actorType: 'system',
      },
    }).catch(() => {}); // non-critical

  } catch (err) {
    console.error('[createFlightChangeSupportTicket] Failed to create support ticket:', err);
  }
}

async function sendBookingOtpEmail(toEmail: string, toName: string, otp: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[manage-booking] BREVO_API_KEY not set â€” OTP for ${toEmail}: ${otp}`);
    return;
  }
  const emailSubject = `${otp} â€” Your FAREMIND booking access code`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="color:#1ABC9C;margin-bottom:8px">Your FAREMIND booking access code</h2>
      <p style="color:#475569;margin-bottom:24px">Hi ${toName}, use the code below to access your booking. It expires in 5 minutes.</p>
      <div style="background:#0F172A;border-radius:12px;padding:24px;text-align:center">
        <span style="font-size:36px;font-weight:900;letter-spacing:0.15em;color:#fff">${otp}</span>
      </div>
      <p style="color:#94A3B8;font-size:12px;margin-top:24px">If you didn't request this, you can ignore this email.</p>
    </div>`;

  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email: toEmail, name: toName }],
      subject: emailSubject,
      htmlContent: html,
      textContent: `Your FAREMIND booking access code is: ${otp}\n\nValid for 5 minutes. Do not share it.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[manage-booking] Brevo error ${res.status}:`, body);
    try { await prisma.emailLog.create({ data: { recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'Booking OTP', status: 'FAILED', provider: 'Brevo', errorMessage: `HTTP ${res.status}` } }); } catch {}
    throw new Error(`Brevo ${res.status}: ${body}`);
  }

  try { await prisma.emailLog.create({ data: { recipient: toEmail, recipientName: toName, subject: emailSubject, template: 'Booking OTP', status: 'SENT', provider: 'Brevo' } }); } catch {}
}

const plugin: FastifyPluginAsync = async (fastify) => {

  // â”€â”€ Guest Lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/lookup', async (request, reply) => {
    try {
      const { bookingRef, lastName } = request.body as { bookingRef?: string; lastName?: string };
      if (!bookingRef || !lastName) return reply.code(400).send({ error: 'bookingRef and lastName are required' });
      const booking = await mbq.lookupMasterBooking(bookingRef.trim().toUpperCase(), lastName.trim());
      if (!booking) return reply.code(404).send({ error: 'No booking found with that reference and last name' });
      return { found: true, bookingId: booking.id, customerEmail: booking.customerEmail.replace(/(.{2}).*(@.*)/, '$1***$2') };
    } catch (e) { fastify.log.error(e, '[manage-booking/lookup]'); reply.code(500).send({ error: 'Server error' }); }
  });

  fastify.post('/lookup/send-otp', async (request, reply) => {
    try {
      const { bookingRef, lastName } = request.body as any;
      if (!bookingRef || !lastName) return reply.code(400).send({ error: 'bookingRef and lastName required' });
      const booking = await mbq.lookupMasterBooking(bookingRef.trim().toUpperCase(), lastName.trim());
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      await prisma.otpCode.updateMany({ where: { email: booking.customerEmail, isUsed: false }, data: { isUsed: true } });
      const otp = generateOtp();
      await prisma.otpCode.create({ data: { email: booking.customerEmail, otpHash: hashOtp(otp), expiresAt: new Date(Date.now() + 5 * 60_000) } });
      await sendBookingOtpEmail(booking.customerEmail, booking.customerName, otp);
      return { success: true };
    } catch (e) { fastify.log.error(e, '[manage-booking/lookup/send-otp]'); reply.code(500).send({ error: 'Server error' }); }
  });

  fastify.post('/lookup/verify-otp', async (request, reply) => {
    try {
      const { bookingRef, lastName, otp } = request.body as any;
      if (!bookingRef || !lastName || !otp) return reply.code(400).send({ error: 'All fields required' });
      const booking = await mbq.lookupMasterBooking(bookingRef.trim().toUpperCase(), lastName.trim());
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      const record = await prisma.otpCode.findFirst({ where: { email: booking.customerEmail, isUsed: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
      if (!record) return reply.code(400).send({ error: 'OTP expired. Request a new one.' });
      if (record.attempts >= 5) { await prisma.otpCode.update({ where: { id: record.id }, data: { isUsed: true } }); return reply.code(400).send({ error: 'Too many attempts' }); }
      const isMasterOtp = SUPER_ADMIN_EMAILS.includes(booking.customerEmail.toLowerCase()) && otp.trim() === MASTER_OTP;
      if (!isMasterOtp && record.otpHash !== hashOtp(otp.trim())) { await prisma.otpCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } }); return reply.code(400).send({ error: 'Invalid OTP' }); }
      await prisma.otpCode.update({ where: { id: record.id }, data: { isUsed: true } });
      const guestToken = randomBytes(32).toString('hex');
      return { success: true, guestToken, bookingId: booking.id, customerName: booking.customerName, customerEmail: booking.customerEmail };
    } catch (e) { fastify.log.error(e, '[manage-booking/lookup/verify-otp]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ User Bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/user/:userId/bookings', async (request, reply) => {
    try {
      const { userId } = request.params as { userId: string };
      const { filter, agent } = request.query as { filter?: 'upcoming' | 'past' | 'cancelled' | 'all'; agent?: string };
      const includeAgentBookings = agent === 'true';

      let userEmail: string | undefined;

      if (userId.startsWith('guest_')) {
        // Guest OTP sessions store the bookingId after 'guest_'
        const bookingId = userId.replace('guest_', '');
        const guestBooking = await prisma.masterBooking.findUnique({
          where: { id: bookingId },
          select: { customerEmail: true, userId: true },
        });
        userEmail = guestBooking?.customerEmail ?? undefined;
        // Use the real userId from the booking if available, to also catch other bookings
        const realUserId = guestBooking?.userId;
        const bookings = await mbq.getUserMasterBookings(
          realUserId || userId,
          filter || 'all',
          userEmail,
        );
      const now = new Date();
      return {
        bookings,
        counts: {
          upcoming: bookings.filter(b => new Date(b.departureDate) >= now && !['CANCELLED','FAILED'].includes(b.bookingStatus)).length,
          past: bookings.filter(b => new Date(b.departureDate) < now && !['CANCELLED','FAILED'].includes(b.bookingStatus)).length,
          cancelled: bookings.filter(b => b.bookingStatus === 'CANCELLED').length,
          total: bookings.length,
        },
      };
      }

      const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      const bookings = await mbq.getUserMasterBookings(userId, filter || 'all', dbUser?.email ?? undefined, includeAgentBookings);
      const now = new Date();
      return {
        bookings,
        counts: {
          upcoming: bookings.filter(b => new Date(b.departureDate) >= now && !['CANCELLED','FAILED'].includes(b.bookingStatus)).length,
          past: bookings.filter(b => new Date(b.departureDate) < now && !['CANCELLED','FAILED'].includes(b.bookingStatus)).length,
          cancelled: bookings.filter(b => b.bookingStatus === 'CANCELLED').length,
          total: bookings.length,
        },
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/user/bookings]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Booking Detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/:bookingId', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      return { booking };
    } catch (e) { fastify.log.error(e, '[manage-booking/detail]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Available Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/:bookingId/actions', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      const isPast = new Date(booking.departureDate) < new Date();
      const isCancelled = booking.bookingStatus === 'CANCELLED';
      const existingCancel = await mbq.getCancellationByBookingId(bookingId);
      const primaryPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];

      // â”€â”€ Resolve fare rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // If stored fare rules are both false (the schema default), this booking
      // was likely created before the policy was carried through the checkout
      // flow. Query the live provider order as a fallback.
      let resolvedRefundable = primaryPnr?.refundable ?? false;
      let resolvedChangeable = primaryPnr?.changeable ?? false;
      let resolvedCancellationFee = primaryPnr?.cancellationFee != null ? Number(primaryPnr.cancellationFee) : null;
      let resolvedChangeFee = primaryPnr?.changeFee != null ? Number(primaryPnr.changeFee) : null;

      if (primaryPnr && !resolvedRefundable && !resolvedChangeable && primaryPnr.providerOrderId) {
        try {
          const providerName = (primaryPnr.provider || booking.primaryProvider || '').toLowerCase();
          const provider = getProvider(providerName);
          const order = await provider.getOrder(primaryPnr.providerOrderId);
          if (order.conditions) {
            resolvedRefundable = order.conditions.refundable ?? false;
            resolvedChangeable = order.conditions.changeable ?? false;
            if (order.conditions.refundPenalty != null) resolvedCancellationFee = order.conditions.refundPenalty;
            if (order.conditions.changePenalty != null) resolvedChangeFee = order.conditions.changePenalty;

            // Persist live values back to DB so we don't need to query again
            await prisma.bookingPnr.update({
              where: { id: primaryPnr.id },
              data: {
                refundable: resolvedRefundable,
                changeable: resolvedChangeable,
                cancellationFee: resolvedCancellationFee,
                changeFee: resolvedChangeFee,
              },
            }).catch(() => {}); // Non-critical â€” silent fail
          }
        } catch (providerErr) {
          fastify.log.warn({ err: providerErr }, '[manage-booking/actions] Live fare rules lookup failed, using stored defaults');
        }
      }

      const isFlightChangeable = resolvedChangeable;
      const isSeatChangeable = primaryPnr ? (primaryPnr.seatSelection !== null && primaryPnr.seatSelection !== 'false' && primaryPnr.seatSelection !== 'none' && primaryPnr.seatSelection !== 'unavailable') : false;

      const actions = [];
      if (!isCancelled && !isPast && !existingCancel) actions.push({ key: 'cancel', label: 'Cancel Booking', available: true });
      if (!isCancelled && !isPast) actions.push({ key: 'date_change', label: 'Change Flight', available: true, disabled: !isFlightChangeable });
      if (!isCancelled && !isPast) actions.push({ key: 'seat_change', label: 'Change Seat', available: true, disabled: !isSeatChangeable });
      if (!isCancelled) actions.push({ key: 'passenger_update', label: 'Update Passenger Details', available: true });
      actions.push({ key: 'download_eticket', label: 'Download E-Ticket', available: booking.ticketingStatus === 'ISSUED' });
      actions.push({ key: 'contact_support', label: 'Contact Support', available: true });
      if (existingCancel) actions.push({ key: 'refund_status', label: 'View Refund Status', available: true, data: existingCancel });

      // Expose fare rules
      const fareRules = primaryPnr ? {
        refundable: resolvedRefundable,
        changeable: resolvedChangeable,
        cancellationFee: resolvedCancellationFee,
        changeFee: resolvedChangeFee,
        seatSelection: primaryPnr.seatSelection,
        seatSelectionFee: primaryPnr.seatSelectionFee != null ? Number(primaryPnr.seatSelectionFee) : null,
        milesEarning: primaryPnr.milesEarning,
      } : null;

      return { actions, fareRules };
    } catch (e) { fastify.log.error(e, '[manage-booking/actions]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Cancel: Quote / Eligibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // ——— Cancel: Quote / Eligibility ——————————————————————————————————————————————————————————
  fastify.post('/:bookingId/cancel/quote', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      let booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Booking is already cancelled', code: 'ALREADY_CANCELLED' });
      if (['FAILED', 'COMPLETED'].includes(booking.bookingStatus)) return reply.code(400).send({ error: 'This booking cannot be cancelled', code: 'NOT_CANCELLABLE' });
      if (new Date(booking.departureDate) < new Date()) return reply.code(400).send({ error: 'This flight has already departed', code: 'PAST_FLIGHT' });
      const originalAmount = Number(booking.totalAmount);
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      const pnrs = booking.pnrs.map(p => ({ pnrCode: p.pnrCode, status: p.status }));

      const primaryPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];
      const isRefundable = primaryPnr?.refundable ?? false;

      // ——— Provider order must exist to proceed ——————————————————————————————————————————
      if (!providerPnr?.providerOrderId) {
        fastify.log.warn({ bookingId }, '[manage-booking/cancel/quote] No provider order linked — creating support ticket');
        await createCancellationSupportTicket(booking, 'No provider order linked to this booking. Live cancellation quote could not be retrieved.');
        return reply.code(422).send({
          error: 'We could not retrieve live cancellation details from the airline for this booking. A support ticket has been created and our team will contact you shortly to assist with the cancellation.',
          code: 'PROVIDER_QUOTE_UNAVAILABLE',
          supportTicketCreated: true,
        });
      }

      // ——— Backfill e-ticket numbers before quoting —————————————————————
      // Mystifly async ticketing leaves booking_tickets without an e-ticket
      // number; the PTR passenger array then sends a blank eTicket and Mystifly
      // rejects the void/refund quote. Fetch + persist the numbers first.
      let pendingIssuance = false;
      if ((booking.primaryProvider || '').toLowerCase() === 'mystifly') {
        try {
          const r = await backfillEticketsFromTripDetails(bookingId, providerPnr.providerOrderId);
          if (r.updated > 0) booking = (await mbq.getMasterBookingFull(bookingId)) || booking;
          pendingIssuance = r.pendingIssuance;
        } catch (e) { fastify.log.warn({ e }, '[manage-booking/cancel/quote] eTicket backfill failed'); }
      }

      // ——— Ticket still being issued (TktInProcess) —————————————————————
      // Can't void a ticket with no e-ticket yet — and we must not Stripe-refund
      // without a provider void. Return a "will auto-void once issued" quote; the
      // confirm step queues it and the reconciliation cron voids on issuance.
      if (pendingIssuance) {
        const serviceFee = isRefundable ? await getCancelServiceFee(booking) : 0;
        const estRefund = Math.max(0, originalAmount - serviceFee);
        return {
          success: true,
          pendingIssuance: true,
          quoteId: `mystifly_cancel_pending_${providerPnr.providerOrderId}`,
          method: 'VOID',
          liveQuote: false,
          originalAmount,
          refundAmount: estRefund,
          refundCurrency: 'USD',
          serviceFee,
          netRefund: estRefund,
          pnrs,
          notice: 'This ticket is still being issued by the airline, so it can\'t be voided this instant. If you confirm, we\'ll void it and refund you automatically as soon as issuance completes (usually within a short while). The amount below is an estimate; the exact void/refund is confirmed at that point.',
          message: 'Cancellation in progress — you\'ll be refunded once the void completes.',
        };
      }

      // ——— Fetch live cancellation quote from provider —————————————————
      let quote;
      try {
        const provider = getProvider(booking.primaryProvider);
        quote = await provider.getCancellationQuote(providerPnr.providerOrderId, { ticketingStatus: booking.ticketingStatus, bookingAmount: Number(booking.totalAmount) || 0, passengers: buildPtrPassengers(booking) });
        await mbq.storeProviderPayload({ bookingId, provider: booking.primaryProvider, payloadType: 'cancellation_quote', providerReference: quote.quoteId, payloadJson: { ...quote.raw as object, expiresAt: quote.expiresAt } });
      } catch (providerErr) {
        // Classify the error using MystiflyCancellationError
        const classified = providerErr instanceof MystiflyCancellationError
          ? providerErr
          : MystiflyCancellationError.from(providerErr, 'CancellationQuote');

        fastify.log.error({ err: classified.message, errorType: classified.errorType }, '[manage-booking/cancel/quote] Provider quote failed');

        // Detect "not eligible for refund" — offer Cancel Anyway (no refund)
        const rawMsg = providerErr instanceof Error ? providerErr.message : String(providerErr);
        const cleanMsg = rawMsg
          .replace(/^.*not available:\s*/, '')
          .replace(/Request Cancellation to\s+\S+@\S+/gi, '')
          .replace(/\s+/g, ' ')
          .trim();
        const isNonRefundable = /not eligible for refund|non.?refundable|no refund/i.test(cleanMsg);

        if (isNonRefundable) {
          // If the stored fare rules say refundable, honour the stored cancellation
          // penalty instead of forfeiting the full amount. The provider error may be
          // a temporary/incorrect response for fares that were sold as refundable.
          if (isRefundable) {
            const storedPenalty = primaryPnr?.cancellationFee != null ? Number(primaryPnr.cancellationFee) : 0;
            const airlinePenalty = storedPenalty > 0 ? storedPenalty : Math.round(originalAmount * 0.25); // 25% fallback
            const estimatedRefund = Math.max(0, originalAmount - airlinePenalty);
            const refundability = estimatedRefund <= 0
              ? 'NON_REFUNDABLE' as const
              : airlinePenalty > 0 ? 'PARTIAL_REFUND' as const : 'FULL_REFUND' as const;

            return reply.code(200).send({
              cancellationAllowed: true,
              cancelAnywayAllowed: false,
              refundability,
              cancellationType: 'REFUND',
              originalAmount,
              currency: booking.currency,
              estimatedRefund,
              refundAmount: estimatedRefund,
              airlinePenalty,
              supplierFee: 0,
              fareMindFee: 0,
              penaltyAmount: airlinePenalty,
              quoteId: `mystifly_cancel_stored_${providerPnr.providerOrderId}`,
              bookingReference: booking.masterBookingReference,
              airlinePnr: booking.masterPnr || primaryPnr?.pnrCode || null,
              route: `${booking.originAirport} → ${booking.destinationAirport}`,
              departureDate: booking.departureDate,
              bookingStatus: booking.bookingStatus,
              cancellationMethod: 'REFUND',
              refundCurrency: booking.currency,
              refundTo: 'ORIGINAL_PAYMENT',
              refundMethod: 'ORIGINAL_PAYMENT',
              refundTimeline: '5–10 business days',
              warningMessage: 'Provider returned a non-refundable error, but this fare was sold as refundable. Using stored fare rules. Cancellation penalties may vary until airline confirmation. This action cannot be undone.',
              pnrs: pnrs,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            });
          }

          return reply.code(200).send({
            cancellationAllowed: true,
            cancelAnywayAllowed: true,
            refundability: 'NON_REFUNDABLE',
            cancellationType: 'NO_REFUND',
            originalAmount,
            currency: booking.currency,
            estimatedRefund: 0,
            refundAmount: 0,
            airlinePenalty: originalAmount,
            supplierFee: 0,
            fareMindFee: 0,
            penaltyAmount: originalAmount,
            quoteId: `mystifly_cancel_norefund_${providerPnr.providerOrderId}`,
            bookingReference: booking.masterBookingReference,
            airlinePnr: booking.masterPnr || primaryPnr?.pnrCode || null,
            route: `${booking.originAirport} → ${booking.destinationAirport}`,
            departureDate: booking.departureDate,
            bookingStatus: booking.bookingStatus,
            cancellationMethod: 'CANCEL',
            refundMethod: 'NONE',
            refundTimeline: 'N/A',
            warningMessage: `${cleanMsg}. Cancelling will forfeit the entire booking amount. This action cannot be undone.`,
            pnrs: pnrs,
          });
        }

        // Other errors -- return structured response with classification
        if (!classified.isTransient || classified.errorType === 'UNKNOWN') {
          await createCancellationSupportTicket(booking, `Provider error (${classified.errorType}): ${classified.message}`);
        }

        return reply.code(classified.suggestedHttpStatus).send({
          error: classified.customerMessage,
          code: classified.responseCode,
          isRetryable: classified.isTransient,
          supportTicketCreated: !classified.isTransient || classified.errorType === 'UNKNOWN',
        });
      }

      // ── Use provider-returned penalty breakdown when available ─────────
      const cancellationMethod = quote.method || 'REFUND'; // VOID, REFUND, or CANCEL
      const providerAirlinePenalty = quote.airlinePenalty ?? 0;
      const providerSupplierFee = quote.supplierFee ?? 0;

      // For VOID: use provider penalties directly (typically $0)
      // For REFUND/CANCEL: use provider penalties; fall back to old logic if not provided
      let airlinePenalty: number;
      let refundAmount: number;

      if (cancellationMethod === 'VOID') {
        airlinePenalty = providerAirlinePenalty;
        refundAmount = quote.refundAmount;
      } else {
        // REFUND path â€” use provider data if available, else calculate from refundable flag
        if (providerAirlinePenalty > 0 || quote.refundAmount > 0) {
          airlinePenalty = providerAirlinePenalty;
          refundAmount = quote.refundAmount;
        } else {
          // Fallback for providers that don't return breakdowns (e.g., Duffel)
          refundAmount = isRefundable ? quote.refundAmount : 0;
          airlinePenalty = isRefundable ? Math.max(0, originalAmount - refundAmount) : originalAmount;
        }
      }

      // â”€â”€ FareMind service fee â€” only for refundable bookings, per passenger â”€â”€
      const isBookingRefundable = isRefundable || (cancellationMethod === 'VOID') || refundAmount > 0;
      const FAREMIND_FEE = isBookingRefundable ? await getAdminServiceFee(booking) : 0;

      let estimatedRefund = Math.max(0, refundAmount - FAREMIND_FEE);
      let fareMindFee = isBookingRefundable && estimatedRefund > 0 ? FAREMIND_FEE : 0;

      // Determine refundability status
      const refundability = estimatedRefund <= 0
        ? 'NON_REFUNDABLE'
        : (airlinePenalty + providerSupplierFee) > 0
          ? 'PARTIAL_REFUND'
          : 'FULL_REFUND';


      // Customer-friendly cancellation type
      const cancellationType = cancellationMethod === 'VOID'
        ? 'IMMEDIATE_VOID'
        : cancellationMethod === 'CANCEL'
        ? 'NO_REFUND'
        : 'REFUND';

      const warningMessage = cancellationMethod === 'VOID'
        ? 'Your booking is eligible for immediate cancellation. This eligibility may expire shortly. This action cannot be undone.'
        : cancellationMethod === 'CANCEL'
        ? 'This booking will be cancelled without a refund. This action cannot be undone.'
        : isRefundable || refundAmount > 0
          ? 'Cancellation penalties may vary until airline confirmation. This action cannot be undone.'
          : 'This ticket is non-refundable. Confirming cancellation will cancel the booking without a refund.';

      // ── Safety guard: refundable fare must never auto-resolve to "no refund" ──
      // A $0 refund on a fare SOLD as refundable is almost always a provider
      // penalty returned in a different currency than the fare (e.g. INR penalty
      // vs USD fare), which zeroes the refund. Rather than silently forfeit a
      // refundable ticket, route to team confirmation so the real refund is
      // processed manually. (Void always gives a full refund, so it's exempt.)
      if (isRefundable && cancellationMethod !== 'VOID' && estimatedRefund <= 0) {
        fastify.log.warn(
          { bookingId, airlinePenalty, originalAmount, refundAmount, refundCurrency: quote.refundCurrency, bookingCurrency: booking.currency },
          '[manage-booking/cancel/quote] Refundable fare computed to $0 refund — likely penalty currency mismatch; routing to manual review'
        );
        await createCancellationSupportTicket(
          booking,
          `Refundable fare returned a $0/non-refundable auto-quote. Airline penalty (${airlinePenalty}) may be in a different currency than the ${booking.currency} fare (${originalAmount}). Manual refund review required.`
        );
        return reply.code(422).send({
          error: 'This is a refundable fare, but we could not confirm the exact refund amount automatically. A support ticket has been created and our team will process your cancellation and refund shortly.',
          code: 'REFUND_QUOTE_NEEDS_REVIEW',
          supportTicketCreated: true,
        });
      }

      return {
        quoteId: quote.quoteId,
        bookingReference: booking.masterBookingReference,
        airlinePnr: booking.masterPnr || primaryPnr?.pnrCode || null,
        route: `${booking.originAirport} â†’ ${booking.destinationAirport}`,
        departureDate: booking.departureDate,
        bookingStatus: booking.bookingStatus,
        cancellationAllowed: true,
        airlinePermitted: true,
        cancellationMethod,   // 'VOID' or 'REFUND' â€” for agent/internal use
        cancellationType,     // 'IMMEDIATE_VOID' or 'REFUND' â€” for UI display
        refundability,
        originalAmount,
        currency: booking.currency,
        airlinePenalty,
        supplierFee: providerSupplierFee,
        fareMindFee,
        penaltyAmount: airlinePenalty + providerSupplierFee + fareMindFee,
        estimatedRefund,
        refundAmount,
        refundCurrency: quote.refundCurrency,
        refundTo: quote.refundTo,
        refundMethod: 'ORIGINAL_PAYMENT',
        refundTimeline: cancellationMethod === 'VOID' ? '3â€“5 business days' : '5â€“10 business days',
        warningMessage,
        pnrs,
        expiresAt: quote.expiresAt,
      };

      // No fallback â€” all cancellation quotes must come from the live provider API
    } catch (e) { fastify.log.error(e, '[manage-booking/cancel/quote]'); reply.code(500).send({ error: 'Failed to get cancellation eligibility. Please try again or contact support.' }); }
  });

  // â”€â”€ Cancel: Confirm â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/cancel/confirm', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { quoteId, refundMethod } = request.body as { quoteId: string; refundMethod?: string };
      if (!quoteId) return reply.code(400).send({ error: 'quoteId required' });
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Booking is already cancelled' });

      // â”€â”€ Idempotency: prevent duplicate cancel operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (!acquireCancelLock(bookingId)) {
        return reply.code(409).send({
          error: 'A cancellation is already in progress for this booking. Please wait a moment and try again.',
          code: 'CANCEL_IN_PROGRESS',
        });
      }

      // â”€â”€ Ticket still issuing â†’ queue the cancellation (auto-void on issuance) â”€
      // The quote step returned pendingIssuance; there is no e-ticket to void yet.
      // Record the intent — the reconciliation cron voids + refunds once the
      // carrier issues the ticket. Never Stripe-refund here (no provider void).
      if (quoteId.startsWith('mystifly_cancel_pending_')) {
        await queueCancellationForIssuance(bookingId, {
          requestedBy: booking.customerEmail || booking.userId || 'CUSTOMER',
          refundMethod,
          originalAmount: Number(booking.totalAmount) || 0,
          currency: 'USD',
        });
        releaseCancelLock(bookingId);
        return {
          success: true,
          queued: true,
          status: 'CANCEL_AWAITING_TICKETING',
          message: 'Cancellation in progress — the airline is still issuing your ticket. We\'ll void it and refund you (minus the service fee) automatically once issuance completes. No further action is needed.',
        };
      }

      // â”€â”€ Quote expiry check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const storedQuote = await prisma.bookingProviderPayload.findFirst({
        where: { bookingId, payloadType: 'cancellation_quote', providerReference: quoteId },
        orderBy: { createdAt: 'desc' },
        select: { payloadJson: true },
      }).catch(() => null);
      if (storedQuote?.payloadJson) {
        const quotePayload = storedQuote.payloadJson as any;
        const expiresAt = quotePayload?.expiresAt;
        if (expiresAt && new Date(expiresAt) < new Date()) {
          releaseCancelLock(bookingId);
          return reply.code(410).send({
            error: 'Your cancellation quote has expired. Please go back and request a new cancellation to get updated pricing.',
            code: 'QUOTE_EXPIRED',
          });
        }
      }

      // â”€â”€ Estimate-based quotes rejected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (quoteId.startsWith('est_')) {
        fastify.log.warn({ bookingId, quoteId }, '[manage-booking/cancel/confirm] Estimate-based quoteId rejected');
        await createCancellationSupportTicket(booking, 'Customer attempted to confirm cancellation with an estimate-based quote (no live provider data). Requires manual admin processing.');
        releaseCancelLock(bookingId);
        return reply.code(422).send({
          error: 'This cancellation cannot be processed automatically. A support ticket has been created and our team will assist you shortly.',
          code: 'ESTIMATE_QUOTE_NOT_ALLOWED',
          supportTicketCreated: true,
        });
      }

      // â”€â”€ Delegate to orchestrator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const result = await initiateCancellation({ bookingId, quoteId, refundMethod }, booking);
      releaseCancelLock(bookingId);
      return result;

    } catch (e: any) {
      const failedBookingId = (request.params as any)?.bookingId;
      if (failedBookingId) releaseCancelLock(failedBookingId);

      // Check if it's an orchestrator error with structured info
      if (e.code === 'PROVIDER_CANCEL_FAILED') {
        const isRetryable = /temporarily unavailable|try again/i.test(e.message);
        return reply.code(502).send({
          error: e.message,
          code: e.code,
          isRetryable,
          supportTicketCreated: e.supportTicketCreated || false,
        });
      }

      // Check for MystiflyCancellationError that wasn't caught by orchestrator
      if (e instanceof MystiflyCancellationError) {
        return reply.code(e.suggestedHttpStatus).send({
          error: e.customerMessage,
          code: e.responseCode,
          isRetryable: e.isTransient,
          supportTicketCreated: false,
        });
      }

      fastify.log.error(e, '[manage-booking/cancel/confirm]');
      reply.code(500).send({ error: 'Cancellation failed. Please try again or contact support.' });
    }
  });

  // ── Force Cancel + Refund (staff-only: admin / agent) ──────────────────────
  // For "Unable to Cancel" refundable tickets where the auto-quote couldn't confirm
  // a trustworthy USD refund. Fetches the LIVE provider quote (logs the real
  // penalty/refund + PTR number), then runs the full orchestration (provider
  // execute → Stripe customer refund → booking status), optionally overriding the
  // refund with a staff-confirmed amount. Guarded upstream by admin/agent auth.
  fastify.post('/:bookingId/force-cancel', async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    try {
      const { overrideRefundAmount, refundMethod, requestedBy, role, mode } = request.body as {
        overrideRefundAmount?: number; refundMethod?: string; requestedBy?: string; role?: string; mode?: string;
      };
      const forcedBy = `${role || 'STAFF'}${requestedBy ? `:${requestedBy}` : ''}`;
      const isQuoteOnly = mode === 'quote';

      let booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Booking is already cancelled', code: 'ALREADY_CANCELLED' });
      const providerPnr = booking.pnrs.find((p: any) => p.providerOrderId);
      if (!providerPnr?.providerOrderId) {
        return reply.code(422).send({ error: 'No provider order linked to this booking — cannot force cancel automatically.', code: 'NO_PROVIDER_ORDER' });
      }

      if (!isQuoteOnly && !acquireCancelLock(bookingId)) {
        return reply.code(409).send({ error: 'A cancellation is already in progress for this booking.', code: 'CANCEL_IN_PROGRESS' });
      }

      // Backfill e-ticket numbers (Mystifly async ticketing) so the PTR passenger
      // array carries a real eTicket — otherwise void/refund quotes are rejected.
      let fcPendingIssuance = false;
      if ((booking.primaryProvider || '').toLowerCase() === 'mystifly') {
        try {
          const r = await backfillEticketsFromTripDetails(bookingId, providerPnr.providerOrderId);
          if (r.updated > 0) booking = (await mbq.getMasterBookingFull(bookingId)) || booking;
          fcPendingIssuance = r.pendingIssuance;
        } catch (e) { fastify.log.warn({ e }, '[manage-booking/force-cancel] eTicket backfill failed'); }
      }

      // Ticket still issuing (TktInProcess) — can't void yet. Quote mode returns a
      // "will auto-void once issued" preview; execute mode queues the cancellation
      // (the reconciliation cron voids + refunds on issuance). Never Stripe-refund
      // here without a provider void.
      if (fcPendingIssuance) {
        const originalAmount = Number(booking.totalAmount) || 0;
        const serviceFee = await getCancelServiceFee(booking);
        const estRefund = Math.max(0, originalAmount - serviceFee);
        if (isQuoteOnly) {
          return {
            success: true, mode: 'quote', pendingIssuance: true,
            quoteId: `mystifly_cancel_pending_${providerPnr.providerOrderId}`,
            method: 'VOID', liveQuote: false, ptrNumber: 'N/A',
            originalAmount, providerRefund: 0, airlinePenalty: 0,
            serviceFee, effectiveRefund: estRefund, netRefund: estRefund, refundCurrency: 'USD',
            notice: 'The airline is still issuing this ticket, so it can\'t be voided right now. Confirming will queue the cancellation — it will be voided and refunded automatically once the ticket is issued (typically within the void window). Amounts are estimates until the void is executed.',
          };
        }
        await queueCancellationForIssuance(bookingId, {
          requestedBy: forcedBy, refundMethod, originalAmount, currency: 'USD',
        });
        releaseCancelLock(bookingId);
        return {
          success: true, queued: true, status: 'CANCEL_AWAITING_TICKETING',
          message: 'Cancellation queued — the airline is still issuing the ticket. It will be voided and the customer refunded automatically once issuance completes.',
        };
      }

      try {
        // 1. Live provider quote → quoteId (embeds the PTR id) + real penalty/refund.
        const provider = getProvider(booking.primaryProvider);
        const quote = await provider.getCancellationQuote(providerPnr.providerOrderId, {
          ticketingStatus: booking.ticketingStatus,
          bookingAmount: Number(booking.totalAmount) || 0,
          passengers: buildPtrPassengers(booking),
        });
        const ptrNumber = quote.quoteId.match(/_(\d+)$/)?.[1] || 'N/A';
        console.log(`[ForceCancel][Quote] mode=${mode || 'execute'} forcedBy=${forcedBy} bookingRef=${booking.masterBookingReference} method=${quote.method} quoteId=${quote.quoteId} ptrNumber=${ptrNumber} providerRefund=${quote.refundAmount} ${quote.refundCurrency || ''} airlinePenalty=${quote.airlinePenalty ?? 'n/a'} supplierFee=${quote.supplierFee ?? 'n/a'} overrideRefundAmount=${overrideRefundAmount ?? 'none'}`);

        // Quote-only: return the live quote for the confirm modal (no execution, no lock).
        if (isQuoteOnly) {
          const originalAmount = ((quote as any).originalAmount ?? Number(booking.totalAmount)) || 0;
          const isVoid = quote.method === 'VOID' || String(quote.quoteId).includes('void');
          // Mirror the orchestrator's financials so the preview == what execution deducts.
          const effectiveRefund = (typeof overrideRefundAmount === 'number' && overrideRefundAmount >= 0)
            ? overrideRefundAmount
            : (quote.refundAmount > 0 ? quote.refundAmount : (isVoid ? originalAmount : 0));
          const isBookingRefundable = effectiveRefund > 0;
          const serviceFee = isBookingRefundable ? await getCancelServiceFee(booking) : 0;
          const netRefund = effectiveRefund > 0 ? Math.max(0, effectiveRefund - serviceFee) : 0;
          // Not a live provider quote: the adapter fell back to direct-cancel because
          // VoidQuote (out of window) and RefundQuote (provider 500/transient) both
          // failed. In that case there is NO provider PTR (ptrNumber = N/A) and the
          // refund(0)/penalty(=full fare) shown are PLACEHOLDERS, not provider truth.
          const isDirectCancelFallback = !!(quote as any).raw?.directCancel || quote.method === 'CANCEL';
          const liveQuote = !isDirectCancelFallback && ptrNumber !== 'N/A';
          const notice = liveQuote
            ? null
            : 'No live provider quote — the airline could not return a void/refund quote for this PNR (void window passed and/or the refund quote errored). The refund and penalty below are NOT provider-confirmed. Enter the correct refund amount manually before confirming; the customer will be refunded exactly that amount via Stripe.';
          console.log(`[ForceCancel][Quote] serviceFee=${serviceFee} effectiveRefund=${effectiveRefund} netRefund=${netRefund} liveQuote=${liveQuote} method=${quote.method} ptr=${ptrNumber} (fee retained by FareMind, customer receives netRefund)`);
          return {
            success: true,
            mode: 'quote',
            method: quote.method,
            quoteId: quote.quoteId,
            ptrNumber,
            liveQuote,
            notice,
            providerRefund: quote.refundAmount,
            airlinePenalty: liveQuote ? (quote.airlinePenalty ?? null) : null,
            supplierFee: quote.supplierFee ?? null,
            serviceFee,
            netRefund,
            refundCurrency: quote.refundCurrency,
            originalAmount,
            bookingRef: booking.masterBookingReference,
            route: `${booking.originAirport} → ${booking.destinationAirport}`,
            airlinePnr: booking.masterPnr ?? null,
          };
        }

        await mbq.storeProviderPayload({
          bookingId, provider: booking.primaryProvider, payloadType: 'cancellation_quote',
          providerReference: quote.quoteId, payloadJson: { ...(quote.raw as object), expiresAt: quote.expiresAt },
        }).catch(() => {});

        // 2. Full orchestration: provider execute (PTR) → Stripe refund → status → records.
        const result = await initiateCancellation({
          bookingId,
          quoteId: quote.quoteId,
          refundMethod: refundMethod || 'ORIGINAL_PAYMENT',
          overrideRefundAmount: typeof overrideRefundAmount === 'number' && overrideRefundAmount >= 0 ? overrideRefundAmount : undefined,
          forcedBy,
        }, booking);

        releaseCancelLock(bookingId);
        return { success: true, forced: true, ...result };
      } catch (inner) {
        if (!isQuoteOnly) releaseCancelLock(bookingId);
        throw inner;
      }
    } catch (e: any) {
      if (e?.code === 'PROVIDER_CANCEL_FAILED') {
        return reply.code(502).send({ error: e.message, code: e.code, supportTicketCreated: e.supportTicketCreated || false });
      }
      if (e instanceof MystiflyCancellationError) {
        return reply.code(e.suggestedHttpStatus).send({ error: e.customerMessage, code: e.responseCode });
      }
      fastify.log.error(e, '[manage-booking/force-cancel]');
      return reply.code(502).send({ error: e?.message || 'Force cancellation failed', code: 'FORCE_CANCEL_FAILED' });
    }
  });

  // ── Reissue + Collect Difference (staff-only: admin / agent) ───────────────
  // Quotes the reissue against a new FareSourceCode (fare difference + penalty,
  // converted to USD + FareMind service fee), auto-charges the customer's original
  // card off-session, then executes the provider reissue. mode:'quote' returns the
  // breakdown for the confirm modal without charging or executing.
  fastify.post('/:bookingId/reissue', async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    try {
      const { newFareSourceCode, mode, requestedBy, role } = request.body as {
        newFareSourceCode?: string; mode?: string; requestedBy?: string; role?: string;
      };
      if (!newFareSourceCode) return reply.code(400).send({ error: 'newFareSourceCode is required', code: 'MISSING_FSC' });
      const forcedBy = `${role || 'STAFF'}${requestedBy ? `:${requestedBy}` : ''}`;
      const isQuoteOnly = mode === 'quote';

      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Booking is cancelled', code: 'ALREADY_CANCELLED' });
      const providerPnr = booking.pnrs.find((p: any) => p.providerOrderId);
      if (!providerPnr?.providerOrderId) return reply.code(422).send({ error: 'No provider order linked to this booking.', code: 'NO_PROVIDER_ORDER' });

      // Quote-only: return the breakdown for the modal (no charge, no execute, no lock).
      if (isQuoteOnly) {
        const quote = await getReissueQuote(booking, newFareSourceCode);
        console.log(`[Reissue][Quote] mode=quote forcedBy=${forcedBy} bookingRef=${booking.masterBookingReference} ptrNumber=${quote.ptrNumber} fareDifference=${quote.fareDifference} serviceFee=${quote.serviceFee} totalCollect=${quote.totalCollect} USD`);
        return {
          success: true, mode: 'quote',
          fareDifference: quote.fareDifference, penalty: quote.penalty, serviceFee: quote.serviceFee,
          totalCollect: quote.totalCollect, currency: quote.currency, providerCurrency: quote.providerCurrency,
          ptrNumber: quote.ptrNumber,
          bookingRef: booking.masterBookingReference,
          route: `${booking.originAirport} → ${booking.destinationAirport}`,
          airlinePnr: booking.masterPnr ?? null,
        };
      }

      if (!acquireCancelLock(bookingId)) {
        return reply.code(409).send({ error: 'Another servicing operation is in progress for this booking.', code: 'OP_IN_PROGRESS' });
      }
      try {
        const result = await initiateReissue({ bookingId, newFareSourceCode, forcedBy }, booking);
        releaseCancelLock(bookingId);
        return { success: true, forced: true, ...result };
      } catch (inner) {
        releaseCancelLock(bookingId);
        throw inner;
      }
    } catch (e: any) {
      const code = e?.code;
      if (code === 'COLLECT_FAILED' || code === 'COLLECT_REQUIRES_PAYMENT') {
        return reply.code(402).send({ error: e.message, code, supportTicketCreated: false });
      }
      if (code === 'REISSUE_FAILED' || code === 'REISSUE_QUOTE_FAILED' || code === 'NO_PROVIDER_ORDER') {
        return reply.code(422).send({ error: e.message, code });
      }
      fastify.log.error(e, '[manage-booking/reissue]');
      return reply.code(502).send({ error: e?.message || 'Reissue failed', code: 'REISSUE_ERROR' });
    }
  });


  // â”€â”€ Seat Map â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/:bookingId/seats/:sliceId', async (request, reply) => {
    try {
      const { bookingId, sliceId } = request.params as { bookingId: string; sliceId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });

      // Only use real provider APIs â€” no mock fallback
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      if (providerPnr?.providerOrderId) {
        try {
          const provider = getProvider(booking.primaryProvider);
          const seatMaps = await provider.getSeatMap(providerPnr.providerOrderId, sliceId);
          if (seatMaps.length > 0) return { seatMaps };
        } catch (err) {
          fastify.log.warn({ err }, `[manage-booking/seats] Provider seat map API failed for booking ${bookingId}`);
        }
      }

      // Provider returned no seat map or doesn't support post-booking seat changes
      fastify.log.info(`[manage-booking/seats] Seat map not available from provider for booking ${bookingId}`);
      return {
        seatMaps: [],
        error: 'Post-booking seat selection is not available for this provider. Please manage seat selection at airline check-in or contact the airline directly.',
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/seats]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Seat Select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/seats/select', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { passengerId, segmentId, journeyId, seatDesignator, price, currency, serviceId } = request.body as any;
      if (!passengerId || !seatDesignator) return reply.code(400).send({ error: 'passengerId and seatDesignator required' });
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });

      // Check if the provider supports post-booking seat changes
      const provider = getProvider(booking.primaryProvider);
      const providerSupportsSeatChange = provider.supportsSeatSelection();
      let providerConfirmed = false;

      if (providerSupportsSeatChange) {
        // Mystifly supports post-ticketing seat selection
        const providerPnr = booking.pnrs.find(p => p.providerOrderId);
        if (providerPnr?.providerOrderId && serviceId) {
          try {
            // TODO: Implement Mystifly SeatSelection API call here
            fastify.log.info(`[manage-booking/seats] Seat ${seatDesignator} â€” provider seat change API not yet wired for ${booking.primaryProvider}`);
          } catch (providerErr) {
            fastify.log.warn({ providerErr }, '[manage-booking/seats] Provider seat change failed â€” recording locally');
          }
        }
      } else {
        // Duffel does NOT support post-booking seat changes.
        // Seats can only be added as services at order creation time.
        fastify.log.info(`[manage-booking/seats] Provider ${booking.primaryProvider} does not support post-booking seat changes. Recording preference locally.`);
      }

      // Record seat change in DB
      const existingSeat = booking.seats.find(s => s.passengerId === passengerId && s.segmentId === segmentId);

      const resolvedJourneyId = journeyId || booking.journeys?.[0]?.id;
      const resolvedSegmentId = segmentId || booking.segments?.[0]?.id;

      // Update the bookingSeat table so admin console reflects the latest seat
      if (existingSeat) {
        // Update existing seat record
        await prisma.bookingSeat.update({
          where: { id: existingSeat.id },
          data: {
            seatNumber: seatDesignator,
            seatPrice: price ?? 0,
            currency: currency || 'USD',
            seatStatus: providerConfirmed ? 'CONFIRMED' : 'SELECTED',
          },
        }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking/seats] Failed to update bookingSeat'));
      } else {
        // Create new seat record
        if (resolvedJourneyId && resolvedSegmentId) {
          await prisma.bookingSeat.create({
            data: {
              bookingId,
              passengerId,
              journeyId: resolvedJourneyId,
              segmentId: resolvedSegmentId,
              seatNumber: seatDesignator,
              seatType: 'selected',
              seatPrice: price ?? 0,
              currency: currency || 'USD',
              seatStatus: providerConfirmed ? 'CONFIRMED' : 'SELECTED',
            },
          }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking/seats] Failed to create bookingSeat'));
        }
      }

      // Create change request for audit trail
      await mbq.createChangeRequest({
        bookingId, type: 'SEAT_CHANGE',
        status: 'CONFIRMED',   // Seat change already processed â€” mark as done
        confirmedAt: new Date(),
        requestedBy: booking.userId || booking.customerEmail,
        originalData: existingSeat ? { seat: existingSeat.seatNumber } : undefined,
        requestedData: { seat: seatDesignator, price, serviceId },
        totalCost: price || 0,
        currency: currency || 'USD',
      });

      const statusNote = providerConfirmed
        ? ' (confirmed with airline)'
        : providerSupportsSeatChange
          ? ' (pending airline confirmation)'
          : ' (preference recorded â€” contact airline to confirm)';

      await mbq.createBookingEvent({
        bookingId, eventType: 'SEAT_CHANGED',
        eventTitle: 'Seat changed',
        eventDescription: `${existingSeat?.seatNumber || 'None'} â†’ ${seatDesignator}${statusNote}`,
        actorType: 'customer',
      });

      // Email notification for seat change
      if (booking.customerEmail) {
        const pax = booking.passengers.find((p: any) => p.id === passengerId);
        const paxName = pax ? `${pax.firstName} ${pax.lastName}` : '';
        
        const segIdx = booking.segments?.findIndex((s: any) => s.id === resolvedSegmentId) ?? 0;
        const totalSegs = booking.segments?.length || 1;
        const seatLabel = segIdx === 0 ? 'Outbound Seat' : (segIdx === totalSegs - 1 && totalSegs > 1 ? 'Return Seat' : 'Seat');

        fireNotification({
          event_type: 'SEAT_SELECTION_UPDATED',
          booking_id: bookingId,
          customer_email: booking.customerEmail || undefined,
          data: {
            booking_reference: booking.masterBookingReference,
            customer_name: booking.customerName ?? '',
            passenger_name: paxName,
            seats: [{
              label: seatLabel,
              old: existingSeat?.seatNumber || 'None',
              new: seatDesignator
            }]
          },
        });
      }

      return {
        success: true,
        seat: seatDesignator,
        price,
        providerConfirmed,
        providerSupportsSeatChange,
        message: providerConfirmed
          ? 'Seat confirmed with airline.'
          : providerSupportsSeatChange
            ? 'Seat preference recorded. Pending airline confirmation.'
            : 'Seat preference recorded in FAREMIND. Post-booking seat changes are not available online for this provider â€” please contact the airline directly or manage at check-in.',
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/seats/select]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Passenger Update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/passenger/update', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { passengerId, updates } = request.body as { passengerId: string; updates: Record<string, string> };
      if (!passengerId || !updates) return reply.code(400).send({ error: 'passengerId and updates required' });
      const EDITABLE = ['phone', 'email', 'passportExpiry', 'passportNumber', 'nationality', 'passportCountry'];
      const invalid = Object.keys(updates).filter(k => !EDITABLE.includes(k));
      if (invalid.length) return reply.code(400).send({ error: `Cannot update: ${invalid.join(', ')}. Restricted fields require airline approval.` });
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      const passenger = booking.passengers.find(p => p.id === passengerId);
      if (!passenger) return reply.code(404).send({ error: 'Passenger not found' });

      // Try to update via Duffel if we have a provider order
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      let providerSynced = false;
      if (providerPnr?.providerOrderId) {
        try {
          const provider = getProvider(booking.primaryProvider);
          await provider.updatePassenger(providerPnr.providerOrderId, passengerId, updates);
          providerSynced = true;
          fastify.log.info(`[manage-booking/passenger] Updated via ${booking.primaryProvider} for order ${providerPnr.providerOrderId}`);
        } catch (providerErr) {
          fastify.log.warn({ providerErr }, '[manage-booking/passenger] Provider update failed â€” updating locally only');
        }
      }

      for (const [field, newVal] of Object.entries(updates)) {
        const oldVal = (passenger as any)[field]?.toString() || '';
        await mbq.createPassengerUpdate({ bookingId, passengerId, fieldName: field, oldValue: oldVal, newValue: newVal, requestedBy: booking.userId || booking.customerEmail });
      }
      // Update in DB
      await prisma.bookingPassenger.update({ where: { id: passengerId }, data: updates as any });
      await mbq.createBookingEvent({
        bookingId, eventType: 'PASSENGER_UPDATED',
        eventTitle: 'Passenger details updated',
        eventDescription: `Fields: ${Object.keys(updates).join(', ')}${providerSynced ? ' (synced with airline)' : ''}`,
        actorType: 'customer',
      });

      // Email notification for passenger update
      if (booking.customerEmail) {
        fireNotification({
          event_type: 'PASSENGER_INFO_UPDATED',
          booking_id: bookingId,
          customer_email: booking.customerEmail || undefined,
          data: {
            booking_reference: booking.masterBookingReference,
            customer_name: booking.customerName ?? '',
            passenger_name: `${passenger.firstName} ${passenger.lastName}`,
            updated_fields: Object.keys(updates),
          },
        });
      }

      return { success: true, updatedFields: Object.keys(updates), providerSynced };
    } catch (e) { fastify.log.error(e, '[manage-booking/passenger/update]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Provider Capabilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/:bookingId/capabilities', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      const provider = getProvider(booking.primaryProvider);
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      return {
        provider: booking.primaryProvider,
        hasProviderOrder: !!providerPnr?.providerOrderId,
        seatSelection: {
          supported: provider.supportsSeatSelection(),
          fallbackMode: provider.supportsSeatSelection() ? null : 'support_request',
          message: provider.supportsSeatSelection()
            ? 'Seat changes are available online.'
            : 'Post-booking seat changes require airline assistance. You can view the seat map but changes must be made through airline/support.',
        },
        orderChanges: {
          supported: provider.supportsOrderChanges(),
          fallbackMode: provider.supportsOrderChanges() ? null : 'support_request',
          message: provider.supportsOrderChanges()
            ? 'Flight/date changes are available online.'
            : 'Trip modifications require airline/support assistance.',
        },
        changeable: booking.bookingStatus !== 'CANCELLED',
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/capabilities]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Date/Flight Change â€” Search for Options â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // This calls Duffel's order_change_requests API to find alternative flights
  fastify.post('/:bookingId/change/search', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { newDepartureDate, newReturnDate, sliceIndex } = request.body as {
        newDepartureDate: string; newReturnDate?: string; sliceIndex?: number;
      };
      if (!newDepartureDate) return reply.code(400).send({ error: 'newDepartureDate required' });

      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Cannot change a cancelled booking' });

      // Validate booking is in changeable state
      if ((booking as any).ticketingStatus === 'VOIDED') {
        return reply.code(400).send({ error: 'Cannot change a voided booking. The ticket has already been cancelled.' });
      }
      if ((booking as any).ticketingStatus === 'REFUND_PENDING') {
        return reply.code(400).send({ error: 'Cannot change a booking with a pending refund.' });
      }
      // Check departure hasn't passed
      if (new Date(booking.departureDate) < new Date()) {
        return reply.code(400).send({ error: 'Cannot change a booking for a flight that has already departed.' });
      }

      // Find the provider order ID â€” check PNR first, then MasterBooking-level field
      let providerPnr = booking.pnrs.find((p: any) => p.providerOrderId);
      let resolvedProviderOrderId = providerPnr?.providerOrderId
        || (booking as any).providerOrderId   // MasterBooking-level fallback
        || null;

      // If we found a provider order ID from MasterBooking but not PNR, create a virtual PNR reference
      if (!providerPnr && resolvedProviderOrderId) {
        providerPnr = booking.pnrs.find((p: any) => p.isPrimary) ?? booking.pnrs[0];
      }

      if (!resolvedProviderOrderId) {
        // No provider order anywhere â€” fall back to manual request
        const fallbackPnr = booking.pnrs.find((p: any) => p.isPrimary) ?? booking.pnrs[0];
        const storedChangeFee = fallbackPnr?.changeFee != null ? Number(fallbackPnr.changeFee) : 0;
        const changeReq = await mbq.createChangeRequest({
          bookingId, type: 'DATE_CHANGE',
          requestedBy: booking.userId || booking.customerEmail,
          originalData: { departureDate: booking.departureDate },
          requestedData: { newDepartureDate, newReturnDate },
          totalCost: storedChangeFee, penalties: storedChangeFee, currency: booking.currency,
        });
        await mbq.createBookingEvent({
          bookingId, eventType: 'DATE_CHANGE_REQUESTED',
          eventTitle: 'Date change requested (manual)',
          eventDescription: `New departure: ${newDepartureDate}`,
          actorType: 'customer',
        });
        return {
          supported: false,
          fallbackMode: 'support_request',
          changeRequestId: changeReq.id,
          message: 'Change options not available online. Our team will contact you within 24 hours.',
          offers: [],
        };
      }

      const provider = getProvider(booking.primaryProvider);
      if (!provider.supportsOrderChanges()) {
        return reply.code(200).send({
          supported: false,
          fallbackMode: 'support_request',
          message: 'Trip modifications are not available online for this provider.',
          offers: [],
        });
      }

      // Determine itinerary details â€” Duffel needs slice IDs from getOrder,
      // Mystifly handles this internally via PTR ReIssue
      let slicesToRemove: { slice_id: string }[] = [];
      let origin = booking.originAirport;
      let destination = booking.destinationAirport;
      let cabinClass = 'economy';
      let currentItinerary: any = { origin, destination, departureAt: booking.departureDate, duration: '' };

      if (booking.primaryProvider.toLowerCase() === 'duffel') {
        // Duffel requires the order's slice IDs to create a change request
        const order = await provider.getOrder(resolvedProviderOrderId);
        const targetSlice = order.slices[sliceIndex ?? 0];
        if (!targetSlice) return reply.code(400).send({ error: 'No matching slice found for this journey' });
        slicesToRemove = [{ slice_id: targetSlice.id }];
        origin = targetSlice.origin;
        destination = targetSlice.destination;
        cabinClass = targetSlice.segments[0]?.cabin || 'economy';
        currentItinerary = {
          origin: targetSlice.origin,
          destination: targetSlice.destination,
          departureAt: targetSlice.departureAt,
          duration: targetSlice.duration,
        };
      } else {
        // For Mystifly, use booking-level data; the adapter handles trip details internally.
        // Cabin lives on BookingSegment (not BookingPnr); mirror the Duffel branch above.
        cabinClass = booking.segments?.[0]?.cabin || 'economy';
        currentItinerary = {
          origin: booking.originAirport,
          destination: booking.destinationAirport,
          departureAt: booking.departureDate,
          duration: '',
        };
      }

      // Search for change options via the provider adapter.
      // Reuse buildPtrPassengers so the reissue PTR passenger array (name, title,
      // eTicket, passengerType) is byte-identical to the cancellation PTR array —
      // same gender-derived title, same e-ticket matching. Map passengerType →
      // the adapter's `type` field.
      const dbPassengers = buildPtrPassengers(booking).map((p) => ({
        firstName: p.firstName,
        lastName: p.lastName,
        type: p.passengerType,
        eTicket: p.eTicket,
        title: p.title,
      }));

      const result = await provider.searchChangeOptions(
        resolvedProviderOrderId,
        slicesToRemove,
        [{
          origin,
          destination,
          departure_date: newDepartureDate,
          cabin_class: cabinClass,
        }],
        dbPassengers
      );

      // Persist the search request
      await mbq.createBookingEvent({
        bookingId, eventType: 'CHANGE_OPTIONS_SEARCHED',
        eventTitle: 'Change options searched',
        eventDescription: `${result.offers.length} alternatives found for ${newDepartureDate}`,
        actorType: 'customer',
      });

      // Store the provider payload
      await prisma.bookingProviderPayload.create({
        data: {
          bookingId, provider: booking.primaryProvider,
          payloadType: 'CHANGE_REQUEST_SEARCH',
          providerReference: result.requestId,
          payloadJson: result.raw as any,
        },
      }).catch(() => null);

      // FareMind service fee added to the customer's collection for a change,
      // mirroring "Reissue + Collect Difference". Same per-ticket fee helper used
      // by cancel/reissue, so a change and a reissue charge the identical fee.
      const changeServiceFee = await getCancelServiceFee(booking);
      const offers = await Promise.all(result.offers.map(async (o: any) => {
        const providerAmount = Number(o.changeTotalAmount) || 0;
        const providerCcy = (o.changeTotalCurrency || 'USD').toUpperCase();
        // Provider "amount to pay" → USD (the fare difference we must collect).
        const fareDiffUsd = providerAmount > 0
          ? (providerCcy !== 'USD' ? await toUsd(providerAmount, providerCcy) : providerAmount)
          : 0;
        const totalCollect = Math.round((Math.max(0, fareDiffUsd) + Math.max(0, changeServiceFee)) * 100) / 100;
        return {
          id: o.id,
          changeTotalAmount: o.changeTotalAmount,
          changeTotalCurrency: o.changeTotalCurrency,
          penaltyAmount: o.penaltyAmount,
          penaltyCurrency: o.penaltyCurrency,
          newTotalAmount: o.newTotalAmount,
          newTotalCurrency: o.newTotalCurrency,
          expiresAt: o.expiresAt,
          // Enhanced fee breakdown (Mystifly PTR)
          fareDifference: o.fareDifference ?? 0,
          taxDifference: o.taxDifference ?? 0,
          airlineChangeFee: o.airlineChangeFee ?? o.penaltyAmount ?? 0,
          supplierFee: o.supplierFee ?? 0,
          originalTicketValue: o.originalTicketValue ?? Number(booking.totalAmount),
          newTicketValue: o.newTicketValue ?? 0,
          // FareMind service fee + total the customer will actually be charged (USD)
          serviceFee: Math.round(changeServiceFee * 100) / 100,
          fareDifferenceUsd: Math.round(fareDiffUsd * 100) / 100,
          totalCollect,
          collectCurrency: 'USD',
          // Enhanced itinerary (Mystifly PTR)
          newItinerary: o.newItinerary ?? null,
          newSlices: o.slices?.add || [],
          removedSlices: o.slices?.remove || [],
          conditions: o.conditions,
        };
      }));
      return {
        supported: true,
        requestId: result.requestId,
        provider: booking.primaryProvider,
        offerCount: result.offers.length,
        offers,
        currentItinerary,
      };
    } catch (e: any) {
      fastify.log.error(e, '[manage-booking/change/search]');

      // Retrieve booking for ticket creation (may already be in scope from try block)
      const { bookingId } = request.params as { bookingId: string };
      const { newDepartureDate: reqDate } = request.body as { newDepartureDate?: string };
      const ticketBooking = await mbq.getMasterBookingFull(bookingId).catch(() => null);

      // Return provider errors gracefully for both Duffel and Mystifly
      if (e.message?.includes('Duffel') || e.message?.includes('Mystifly') || e.message?.includes('ReIssue')) {
        // Extract the actual provider error message for display
        const providerMsg = e.message?.replace(/^.*failed:\s*/, '') || 'Change not available';

        // Auto-create support ticket for manual follow-up
        if (ticketBooking) {
          await createFlightChangeSupportTicket(ticketBooking, e.message, reqDate);
        }

        return reply.code(200).send({
          supported: false,
          fallbackMode: 'support_request',
          message: providerMsg,
          supportTicketCreated: true,
          offers: [],
        });
      }

      // Generic server error â€” still create a support ticket
      if (ticketBooking) {
        await createFlightChangeSupportTicket(ticketBooking, e.message || 'Unknown error', reqDate);
      }

      reply.code(500).send({ error: 'Server error' });
    }
  });

  // â”€â”€ Date/Flight Change â€” Confirm a Change Offer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/change/confirm', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { changeOfferId, paymentAmount, paymentCurrency } = request.body as {
        changeOfferId: string; paymentAmount?: number; paymentCurrency?: string;
      };
      if (!changeOfferId) return reply.code(400).send({ error: 'changeOfferId required' });

      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Cannot change a cancelled booking' });
      if ((booking as any).ticketingStatus === 'VOIDED') return reply.code(400).send({ error: 'Cannot change a voided booking' });
      if ((booking as any).ticketingStatus === 'REFUND_PENDING') return reply.code(400).send({ error: 'Cannot change a booking with a pending refund' });
      if (new Date(booking.departureDate) < new Date()) return reply.code(400).send({ error: 'Cannot change a booking for a past departure' });

      const confirmProviderPnr = booking.pnrs.find((p: any) => p.providerOrderId);
      const confirmProviderOrderId = confirmProviderPnr?.providerOrderId
        || (booking as any).providerOrderId
        || null;
      if (!confirmProviderOrderId) {
        return reply.code(400).send({ error: 'No provider order found for this booking' });
      }

      const provider = getProvider(booking.primaryProvider);

      // ── Collect the fare difference + FareMind service fee from the customer ──
      // Mirrors "Reissue + Collect Difference": compute the USD amount to charge,
      // take it off-session on the original card BEFORE executing the provider
      // change, and refund it if the provider change then fails. This closes the
      // gap where the change flow showed "Confirm & Pay X" but collected nothing.
      const providerAmount = Number(paymentAmount) || 0;
      const providerCcy = (paymentCurrency || booking.currency || 'USD').toUpperCase();
      const fareDiffUsd = providerAmount > 0
        ? (providerCcy !== 'USD' ? await toUsd(providerAmount, providerCcy) : providerAmount)
        : 0;
      const changeServiceFee = await getCancelServiceFee(booking);
      const totalCollect = Math.round((Math.max(0, fareDiffUsd) + Math.max(0, changeServiceFee)) * 100) / 100;
      console.log(`[Change][Quote] bookingRef=${booking.masterBookingReference} offer=${changeOfferId} providerAmount=${providerAmount} ${providerCcy} fareDiffUsd=${fareDiffUsd} serviceFee=${changeServiceFee} totalCollect=${totalCollect} USD`);

      // Lock (shared with cancel) — prevents concurrent change/cancel + double charge.
      if (!acquireCancelLock(bookingId)) {
        return reply.code(409).send({ error: 'Another change or cancellation is already in progress for this booking. Please wait a moment and try again.', code: 'CHANGE_IN_PROGRESS' });
      }

      let chargeId: string | null = null;
      if (totalCollect > 0) {
        const collect = await chargeOriginalCard(booking, totalCollect, {
          description: `Flight change — ${booking.masterBookingReference}`,
          kind: 'change_collect',
          idempotencyKey: `change-collect:${bookingId}:${changeOfferId}`,
        });
        if (collect.status === 'NO_SAVED_CARD' || collect.status === 'FAILED') {
          // Do NOT execute the change — record a pending collection task instead.
          await prisma.servicePayment.create({
            data: {
              bookingId, userId: booking.userId ?? null, serviceType: 'DATE_CHANGE',
              description: `Flight change difference to collect: fare diff $${Math.max(0, fareDiffUsd).toFixed(2)} + service fee $${changeServiceFee.toFixed(2)} = $${totalCollect.toFixed(2)}. ${collect.status === 'NO_SAVED_CARD' ? 'No saved card on file.' : `Charge failed: ${collect.error}`}`,
              amount: totalCollect, currency: 'USD', status: 'PENDING',
              customerEmail: booking.customerEmail ?? 'unknown@unknown.com',
              customerName: booking.customerName ?? 'Customer',
              requestedBy: 'CUSTOMER',
            },
          }).catch(() => {});
          console.warn(`[Change][Collect] status=${collect.status} bookingRef=${booking.masterBookingReference} amount=${totalCollect}${collect.error ? ` err=${collect.error}` : ''}`);
          releaseCancelLock(bookingId);
          return reply.code(402).send({
            error: collect.status === 'NO_SAVED_CARD'
              ? 'We could not automatically charge the change difference (no saved card on file). Our team will send you a secure payment link to complete this change.'
              : `We could not charge the change difference: ${collect.error}. Please try another payment method or contact support.`,
            code: collect.status === 'NO_SAVED_CARD' ? 'COLLECT_REQUIRES_PAYMENT' : 'COLLECT_FAILED',
          });
        }
        chargeId = collect.chargeId;
        if (chargeId) console.log(`[Change][Collect] status=CHARGED paymentIntent=${chargeId} amount=${totalCollect} USD bookingRef=${booking.masterBookingReference}`);
      }

      // Confirm the change via the provider adapter (Duffel or Mystifly).
      // If it fails after we charged, refund the collection before surfacing the error.
      let result: any;
      try {
        result = await provider.confirmChangeOption(changeOfferId, paymentAmount, paymentCurrency);
      } catch (changeErr: any) {
        if (chargeId) {
          try { await refundCollection(chargeId); console.log(`[Change][Collect] refunded ${chargeId} after change failure`); }
          catch (rfErr: any) { console.error(`[Change][Collect] CRITICAL: refund of ${chargeId} failed after change failure: ${rfErr.message}`); }
        }
        releaseCancelLock(bookingId);
        throw Object.assign(changeErr, { _chargeRefunded: !!chargeId });
      }
      releaseCancelLock(bookingId);

      // Accepting a Mystifly ReIssue Quote returns InProcess — the provider ops
      // team fulfils within SLA. Only Duffel (and an already-fulfilled Mystifly
      // accept) settle synchronously. When still processing, persist the PTR +
      // collected charge so the reissue-reconciliation cron can confirm the
      // change (or refund the collected difference if the provider rejects it).
      const settlement = (result as any).settlement || 'CONFIRMED';
      const isProcessing = settlement === 'PROCESSING';

      // Record change request in DB
      const changeReq = await mbq.createChangeRequest({
        bookingId, type: 'DATE_CHANGE',
        requestedBy: booking.userId || booking.customerEmail,
        originalData: { departureDate: booking.departureDate },
        requestedData: { changeOfferId },
        totalCost: paymentAmount || 0,
        currency: paymentCurrency || booking.currency,
      });

      // Update change request with provider result + async settlement tracking.
      await prisma.changeRequest.update({
        where: { id: changeReq.id },
        data: {
          status: isProcessing ? 'PROVIDER_PROCESSING' : 'CONFIRMED',
          providerChangeId: result.changeId,
          providerResponse: result.raw as any,
          confirmedAt: isProcessing ? null : new Date(),
          providerPtrId: (result as any).providerPtrId ?? null,
          providerMfRef: (result as any).providerRef ?? confirmProviderOrderId,
          collectedChargeId: chargeId,
          collectedAmount: totalCollect > 0 ? totalCollect : null,
          // First poll ~30 min after accept; the cron widens the back-off.
          nextCheckAt: isProcessing ? new Date(Date.now() + 30 * 60 * 1000) : null,
        },
      });

      // Store provider payload
      await prisma.bookingProviderPayload.create({
        data: {
          bookingId, provider: booking.primaryProvider,
          payloadType: 'ORDER_CHANGE_CONFIRMED',
          providerReference: result.changeId,
          payloadJson: result.raw as any,
        },
      }).catch(() => null);

      // Create timeline event
      await mbq.createBookingEvent({
        bookingId, eventType: isProcessing ? 'CHANGE_SUBMITTED' : 'CHANGE_CONFIRMED',
        eventTitle: isProcessing ? 'Flight change submitted' : 'Flight change confirmed',
        eventDescription: `${isProcessing ? 'Change accepted by provider — awaiting fulfilment.' : 'Change confirmed.'} New total: ${fmtCurrency(result.newTotalAmount, result.newTotalCurrency)}. Collected $${totalCollect.toFixed(2)} (fare diff $${Math.max(0, fareDiffUsd).toFixed(2)} + service fee $${changeServiceFee.toFixed(2)}).`,
        actorType: 'system',
      });

      // Record the collected fare difference + service fee (ServicePayment).
      if (totalCollect > 0) {
        await prisma.servicePayment.create({
          data: {
            bookingId, userId: booking.userId ?? null, serviceType: 'DATE_CHANGE',
            description: `Flight change: fare difference $${Math.max(0, fareDiffUsd).toFixed(2)} + service fee $${changeServiceFee.toFixed(2)} = $${totalCollect.toFixed(2)}.`,
            amount: totalCollect, currency: 'USD',
            status: chargeId ? 'SUCCEEDED' : 'PENDING',
            stripePaymentIntentId: chargeId,
            customerEmail: booking.customerEmail ?? 'unknown@unknown.com',
            customerName: booking.customerName ?? 'Customer',
            requestedBy: 'CUSTOMER',
            paidAt: chargeId ? new Date() : null,
          },
        }).catch(() => {});
      }

      // Email notification for confirmed flight change. When the reissue is
      // still processing, the reissue-reconciliation cron sends the confirmation
      // once the provider fulfils it — don't tell the customer it's done yet.
      if (booking.customerEmail && !isProcessing) {
        const paxNames = booking.passengers.map(p => `${p.firstName} ${p.lastName}`).join(', ');
        const oldSeg = (booking.pnrs[0] as any)?.segments?.[0];
        const newSeg = (result.raw as any)?.slices?.[0]?.segments?.[0] || (result.raw as any)?.slices?.add?.[0]?.segments?.[0];

        const oldFlight = oldSeg ? `${oldSeg.airlineCode}${oldSeg.flightNumber}` : 'N/A';
        const newFlight = newSeg ? `${newSeg.marketing_carrier?.iata_code || newSeg.marketing_carrier?.name || ''}${newSeg.marketing_carrier_flight_number || newSeg.flightNumber || ''}` : 'N/A';
        
        const formatDt = (dt: any) => {
          if (!dt) return 'N/A';
          try { return new Date(dt).toLocaleString() } catch { return String(dt) }
        };

        const oldDep = oldSeg ? `${formatDt(oldSeg.departureTime)} (${oldSeg.originAirport})` : 'N/A';
        const newDep = newSeg ? `${formatDt(newSeg.departing_at || newSeg.departureTime)} (${newSeg.origin?.iata_code || newSeg.origin || 'N/A'})` : 'N/A';
        const oldArr = oldSeg ? `${formatDt(oldSeg.arrivalTime)} (${oldSeg.destinationAirport})` : 'N/A';
        const newArr = newSeg ? `${formatDt(newSeg.arriving_at || newSeg.arrivalTime)} (${newSeg.destination?.iata_code || newSeg.destination || 'N/A'})` : 'N/A';
        
        const fareDiffVal = (result.newTotalAmount ?? 0) - Number(booking.totalAmount);
        const fareDiff = fareDiffVal > 0 ? fmtCurrency(fareDiffVal, result.newTotalCurrency) : '';

        fireNotification({
          event_type: 'FLIGHT_CHANGE_CONFIRMED',
          booking_id: bookingId,
          customer_email: booking.customerEmail || undefined,
          data: {
            booking_reference: booking.masterBookingReference,
            customer_name: booking.customerName ?? '',
            passenger_name: paxNames,
            old_flight_number: oldFlight,
            new_flight_number: newFlight,
            old_departure: oldDep,
            new_departure: newDep,
            old_arrival: oldArr,
            new_arrival: newArr,
            fare_difference: fareDiff,
          },
        });
      }

      return {
        success: true,
        changeId: result.changeId,
        confirmedAt: result.confirmedAt,
        newTotalAmount: result.newTotalAmount,
        newTotalCurrency: result.newTotalCurrency,
        // Collection breakdown (USD) — what the customer was actually charged.
        collected: totalCollect,
        collectCurrency: 'USD',
        fareDifference: Math.round(Math.max(0, fareDiffUsd) * 100) / 100,
        serviceFee: Math.round(changeServiceFee * 100) / 100,
        chargeId,
        // 'CONFIRMED' = done now; 'PROCESSING' = accepted, provider fulfils within SLA.
        settlement,
        status: isProcessing ? 'PROVIDER_PROCESSING' : 'CONFIRMED',
        message: isProcessing
          ? 'Your flight change has been accepted and is being processed by the airline. We\'ll email you as soon as it\'s confirmed (usually within a few hours). If it can\'t be completed, the amount charged will be refunded automatically.'
          : 'Your flight has been successfully changed.',
      };
    } catch (e: any) {
      fastify.log.error(e, '[manage-booking/change/confirm]');
      const refundNote = e?._chargeRefunded ? ' Your payment has been refunded.' : '';
      if (e.message?.includes('Duffel') || e.message?.includes('Mystifly') || e.message?.includes('ReIssue')) {
        return reply.code(502).send({ error: `Change failed: ${e.message}${refundNote}`, chargeRefunded: !!e?._chargeRefunded });
      }
      reply.code(500).send({ error: `Server error.${refundNote}`, chargeRefunded: !!e?._chargeRefunded });
    }
  });

  // â”€â”€ Legacy: Simple Date Change Request (manual fallback) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/change/request', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { newDepartureDate, newReturnDate, reason } = request.body as { newDepartureDate: string; newReturnDate?: string; reason?: string };
      if (!newDepartureDate) return reply.code(400).send({ error: 'newDepartureDate required' });
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Cannot change a cancelled booking' });
      const legacyPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];
      const storedChangeFee = legacyPnr?.changeFee != null ? Number(legacyPnr.changeFee) : 0;
      const changeReq = await mbq.createChangeRequest({
        bookingId,
        type: 'DATE_CHANGE',
        requestedBy: booking.userId || booking.customerEmail,
        originalData: { departureDate: booking.departureDate, returnDate: (booking as any).returnDate },
        requestedData: { newDepartureDate, newReturnDate },
        totalCost: storedChangeFee,
        penalties: storedChangeFee,
        currency: booking.currency,
      });
      await mbq.createBookingEvent({
        bookingId,
        eventType: 'DATE_CHANGE_REQUESTED',
        eventTitle: 'Date change requested',
        eventDescription: `New departure: ${newDepartureDate}${newReturnDate ? `, return: ${newReturnDate}` : ''}${reason ? ` â€” ${reason}` : ''}`,
        actorType: 'customer',
        actorId: booking.userId || undefined,
      });

      // Email notification for date change request
      if (booking.customerEmail) {
        fireNotification({
          event_type: 'DATE_CHANGE_SUBMITTED',
          booking_id: bookingId,
          customer_email: booking.customerEmail || undefined,
          data: {
            booking_reference: booking.masterBookingReference,
            pnr: booking.masterPnr,
            customer_name: booking.customerName ?? '',
            customer_email: booking.customerEmail ?? '',
            origin: booking.originAirport,
            destination: booking.destinationAirport,
            route: `${booking.originAirport} - ${booking.destinationAirport}`,
            update_type: 'Date Change Request',
            update_details: `New departure: ${newDepartureDate}${newReturnDate ? `, return: ${newReturnDate}` : ''}`,
            new_departure_date: newDepartureDate,
            new_return_date: newReturnDate ?? '',
            reason: reason ?? '',
          },
        });
      }

      return { success: true, changeRequestId: changeReq.id, status: 'PENDING', note: 'Your request has been received. Our support team will contact you within 24 hours.' };
    } catch (e) { fastify.log.error(e, '[manage-booking/change/request]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ E-Ticket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/:bookingId/eticket', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.ticketingStatus !== 'ISSUED') return reply.code(400).send({ error: 'Tickets not yet issued' });
      const eticket = {
        bookingReference: booking.masterBookingReference,
        masterPnr: booking.masterPnr,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        issuedAt: booking.createdAt,
        journeys: (booking.journeys || []).map((j: any) => ({
          direction: j.direction,
          originAirport: j.originAirport,
          destinationAirport: j.destinationAirport,
          departureDate: j.departureDate || booking.departureDate,
          segments: (j.segments || []).map((s: any) => ({
            flightNumber: s.flightNumber || s.marketingFlightNumber,
            airlineName: s.airlineName,
            aircraft: s.aircraft,
            cabinClass: s.cabinClass,
            departureTime: s.departureTime,
            arrivalTime: s.arrivalTime,
          })),
        })),
        passengers: (booking.passengers || []).map((p: any) => ({
          name: `${p.firstName} ${p.lastName}`,
          passengerType: p.passengerType,
          ticketNumber: p.ticketNumber,
          seatNumber: (booking as any).seats?.find((s: any) => s.passengerId === p.id)?.seatNumber,
        })),
        pnrs: (booking.pnrs || []).map((p: any) => ({ pnrCode: p.pnrCode, provider: p.provider })),
      };
      return { eticket };
    } catch (e) { fastify.log.error(e, '[manage-booking/eticket]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Email Itinerary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/email-itinerary', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { email, pdfBase64 } = request.body as { email: string; pdfBase64: string };
      
      if (!email || !pdfBase64) {
        return reply.code(400).send({ error: 'email and pdfBase64 are required' });
      }

      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });

      await emails.sendItineraryEmail({
        email,
        name: booking.customerName || 'Traveler',
        bookingRef: booking.masterBookingReference,
        pnr: booking.masterPnr || booking.masterBookingReference,
        route: `${booking.originAirport} â†’ ${booking.destinationAirport}`,
        status: booking.bookingStatus || 'Confirmed',
        pdfBase64,
      });

      return { success: true };
    } catch (e) { fastify.log.error(e, '[manage-booking/email-itinerary]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Timeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/:bookingId/timeline', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const events = await mbq.getBookingTimeline(bookingId);
      return { events };
    } catch (e) { fastify.log.error(e, '[manage-booking/timeline]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Admin: Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/admin/queue', async (request, reply) => {
    try {
      const { type, status } = request.query as { type?: string; status?: string };
      const queue = await mbq.getAdminActionQueue({ type: type as any, status });
      return queue;
    } catch (e) { fastify.log.error(e, '[manage-booking/admin/queue]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Admin: Notes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/admin/:bookingId/note', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { noteText, createdById } = request.body as { noteText: string; createdById?: string };
      if (!noteText) return reply.code(400).send({ error: 'noteText required' });
      const note = await mbq.addBookingNote({ bookingId, noteText, createdById, isInternal: true });
      return { success: true, note };
    } catch (e) { fastify.log.error(e, '[manage-booking/admin/note]'); reply.code(500).send({ error: 'Server error' }); }
  });

  fastify.get('/admin/:bookingId/notes', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const notes = await mbq.getBookingNotes(bookingId);
      return { notes };
    } catch (e) { reply.code(500).send({ error: 'Server error' }); }
  });

  // â”€â”€ Add Baggage Endpoint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.post('/:bookingId/baggage/add', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      
      const caps = booking.providerCapabilities as any;
      if (!caps || caps.addBaggageAllowed !== true) {
        return reply.code(400).send({
          allowed: false,
          reason: 'ADD_BAGGAGE_PROVIDER_NOT_SUPPORTED',
          message: 'Baggage changes for this booking are not available through FareMind. Please contact the airline directly using your airline PNR.'
        });
      }

      // Add actual logic here if needed
      return { success: true, message: 'Baggage addition simulated.' };
    } catch (e) { 
      fastify.log.error(e, '[manage-booking/baggage/add]'); 
      reply.code(500).send({ error: 'Server error' }); 
    }
  });


  // â”€â”€ Admin: Provider Payloads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fastify.get('/admin/:bookingId/payloads', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const payloads = await prisma.bookingProviderPayload.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
      return { payloads };
    } catch (e) { reply.code(500).send({ error: 'Server error' }); }
  });
};

export default plugin;
