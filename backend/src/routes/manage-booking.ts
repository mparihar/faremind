/**
 * Manage-Booking Routes — Post-Booking Management API
 * NEW route plugin — does NOT modify any existing routes.
 */

import { FastifyPluginAsync } from 'fastify';
import { getProvider } from '../services/provider-adapter';
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

    const matchedRule = rules.find(matchesRule);
    if (!matchedRule) return 20;

    const passengersCount = booking.passengers?.length || 1;
    const baseFare = Number(booking.totalAmount);

    if (matchedRule.calculationModel === 'FIXED_PER_BOOKING') {
      return Number(matchedRule.fixedAmount ?? 20);
    } else if (matchedRule.calculationModel === 'FIXED_PER_TRAVELER') {
      return Number(matchedRule.fixedAmount ?? 20) * passengersCount;
    } else if (matchedRule.calculationModel === 'PERCENTAGE_OF_FARE' || matchedRule.calculationModel === 'PERCENTAGE_OF_BOOKING_TOTAL') {
      return Math.round(baseFare * (Number(matchedRule.percentageValue ?? 0) / 100));
    } else if (matchedRule.calculationModel === 'HYBRID') {
      return Math.round(Number(matchedRule.fixedAmount ?? 20) * passengersCount + baseFare * (Number(matchedRule.percentageValue ?? 0) / 100));
    }

    return 20;
  } catch (err) {
    console.error('[getAdminServiceFee] Error calculating admin service fee:', err);
    return 20;
  }
}

/**
 * Create a support ticket for the admin support queue when a cancellation
 * cannot be processed automatically (e.g. provider API failure, no order linked).
 */
async function createCancellationSupportTicket(booking: any, reason: string): Promise<void> {
  try {
    const route = `${booking.originAirport} → ${booking.destinationAirport}`;
    const amount = fmtCurrency(Number(booking.totalAmount), booking.currency);

    await prisma.supportTicket.create({
      data: {
        subject: `Cancellation Assistance Required: ${booking.masterBookingReference} — ${booking.customerName ?? 'Customer'}`,
        description: [
          `A cancellation could not be processed automatically for booking ${booking.masterBookingReference}.`,
          '',
          `Customer: ${booking.customerName ?? 'N/A'} (${booking.customerEmail ?? 'N/A'})`,
          `Route: ${route}`,
          `Amount: ${amount}`,
          `Provider: ${booking.primaryProvider ?? 'Unknown'}`,
          `PNR: ${booking.masterPnr ?? 'N/A'}`,
          '',
          `Reason: ${reason}`,
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

async function sendBookingOtpEmail(toEmail: string, toName: string, otp: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[manage-booking] BREVO_API_KEY not set — OTP for ${toEmail}: ${otp}`);
    return;
  }
  const emailSubject = `${otp} — Your FAREMIND booking access code`;
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

  // ── Guest Lookup ────────────────────────────────────────────────────────────
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
      console.log(`[manage-booking][dev] OTP for ${booking.customerEmail}: ${otp}`);
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

  // ── User Bookings ───────────────────────────────────────────────────────────
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

  // ── Booking Detail ──────────────────────────────────────────────────────────
  fastify.get('/:bookingId', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      return { booking };
    } catch (e) { fastify.log.error(e, '[manage-booking/detail]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // ── Available Actions ───────────────────────────────────────────────────────
  fastify.get('/:bookingId/actions', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      const isPast = new Date(booking.departureDate) < new Date();
      const isCancelled = booking.bookingStatus === 'CANCELLED';
      const existingCancel = await mbq.getCancellationByBookingId(bookingId);
      const primaryPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];

      // ── Resolve fare rules ────────────────────────────────────────────────
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
            }).catch(() => {}); // Non-critical — silent fail
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

  // ── Cancel: Quote / Eligibility ─────────────────────────────────────────────
  fastify.post('/:bookingId/cancel/quote', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Booking is already cancelled', code: 'ALREADY_CANCELLED' });
      if (['FAILED', 'COMPLETED'].includes(booking.bookingStatus)) return reply.code(400).send({ error: 'This booking cannot be cancelled', code: 'NOT_CANCELLABLE' });
      if (new Date(booking.departureDate) < new Date()) return reply.code(400).send({ error: 'This flight has already departed', code: 'PAST_FLIGHT' });

      const FAREMIND_FEE = await getAdminServiceFee(booking);
      const originalAmount = Number(booking.totalAmount);
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      const pnrs = booking.pnrs.map(p => ({ pnrCode: p.pnrCode, status: p.status }));

      const primaryPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];
      const isRefundable = primaryPnr?.refundable ?? false;

      // ── Provider order must exist to proceed ──────────────────────────────
      if (!providerPnr?.providerOrderId) {
        fastify.log.warn({ bookingId }, '[manage-booking/cancel/quote] No provider order linked — creating support ticket');
        await createCancellationSupportTicket(booking, 'No provider order linked to this booking. Live cancellation quote could not be retrieved.');
        return reply.code(422).send({
          error: 'We could not retrieve live cancellation details from the airline for this booking. A support ticket has been created and our team will contact you shortly to assist with the cancellation.',
          code: 'PROVIDER_QUOTE_UNAVAILABLE',
          supportTicketCreated: true,
        });
      }

      // ── Fetch live cancellation quote from provider ───────────────────────
      let quote;
      try {
        const provider = getProvider(booking.primaryProvider);
        quote = await provider.getCancellationQuote(providerPnr.providerOrderId);
        await mbq.storeProviderPayload({ bookingId, provider: booking.primaryProvider, payloadType: 'cancellation_quote', providerReference: quote.quoteId, payloadJson: quote.raw as object });
      } catch (providerErr) {
        fastify.log.error({ providerErr }, '[manage-booking/cancel/quote] Provider API failed — creating support ticket');
        await createCancellationSupportTicket(booking, `Provider API error while fetching cancellation quote: ${providerErr instanceof Error ? providerErr.message : String(providerErr)}`);
        return reply.code(502).send({
          error: 'The airline provider could not return cancellation details at this time. A support ticket has been created and our team will process your cancellation request manually.',
          code: 'PROVIDER_QUOTE_FAILED',
          supportTicketCreated: true,
        });
      }

      // ── Use provider-returned penalty breakdown when available ─────────
      const cancellationMethod = quote.method || 'REFUND'; // VOID or REFUND
      const providerAirlinePenalty = quote.airlinePenalty ?? 0;
      const providerSupplierFee = quote.supplierFee ?? 0;

      // For VOID: use provider penalties directly (typically $0)
      // For REFUND: use provider penalties; fall back to old logic if not provided
      let airlinePenalty: number;
      let refundAmount: number;

      if (cancellationMethod === 'VOID') {
        airlinePenalty = providerAirlinePenalty;
        refundAmount = quote.refundAmount;
      } else {
        // REFUND path — use provider data if available, else calculate from refundable flag
        if (providerAirlinePenalty > 0 || quote.refundAmount > 0) {
          airlinePenalty = providerAirlinePenalty;
          refundAmount = quote.refundAmount;
        } else {
          // Fallback for providers that don't return breakdowns (e.g., Duffel)
          refundAmount = isRefundable ? quote.refundAmount : 0;
          airlinePenalty = isRefundable ? Math.max(0, originalAmount - refundAmount) : originalAmount;
        }
      }

      let estimatedRefund = Math.max(0, refundAmount - FAREMIND_FEE);
      let fareMindFee = estimatedRefund > 0 ? FAREMIND_FEE : 0;

      // Determine refundability status
      const refundability = estimatedRefund <= 0
        ? 'NON_REFUNDABLE'
        : (airlinePenalty + providerSupplierFee) > 0
          ? 'PARTIAL_REFUND'
          : 'FULL_REFUND';

      // Customer-friendly cancellation type
      const cancellationType = cancellationMethod === 'VOID'
        ? 'IMMEDIATE_VOID'
        : 'REFUND';

      const warningMessage = cancellationMethod === 'VOID'
        ? 'Your booking is eligible for immediate cancellation. This eligibility may expire shortly. This action cannot be undone.'
        : isRefundable || refundAmount > 0
          ? 'Cancellation penalties may vary until airline confirmation. This action cannot be undone.'
          : 'This ticket is non-refundable. Confirming cancellation will cancel the booking without a refund.';

      return {
        quoteId: quote.quoteId,
        bookingReference: booking.masterBookingReference,
        airlinePnr: booking.masterPnr || primaryPnr?.pnrCode || null,
        route: `${booking.originAirport} → ${booking.destinationAirport}`,
        departureDate: booking.departureDate,
        bookingStatus: booking.bookingStatus,
        cancellationAllowed: true,
        airlinePermitted: true,
        cancellationMethod,   // 'VOID' or 'REFUND' — for agent/internal use
        cancellationType,     // 'IMMEDIATE_VOID' or 'REFUND' — for UI display
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
        refundTimeline: cancellationMethod === 'VOID' ? '3–5 business days' : '5–10 business days',
        warningMessage,
        pnrs,
        expiresAt: quote.expiresAt,
      };

      // No fallback — all cancellation quotes must come from the live provider API
    } catch (e) { fastify.log.error(e, '[manage-booking/cancel/quote]'); reply.code(500).send({ error: 'Failed to get cancellation eligibility. Please try again or contact support.' }); }
  });

  // ── Cancel: Confirm ─────────────────────────────────────────────────────────
  fastify.post('/:bookingId/cancel/confirm', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { quoteId, refundMethod } = request.body as { quoteId: string; refundMethod?: string };
      if (!quoteId) return reply.code(400).send({ error: 'quoteId required' });
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (booking.bookingStatus === 'CANCELLED') return reply.code(400).send({ error: 'Booking is already cancelled' });

      const resolvedRefundMethod = refundMethod === 'AIRLINE_CREDIT' ? 'AIRLINE_CREDIT' : 'ORIGINAL_PAYMENT';
      const originalAmount = Number(booking.totalAmount);
      const route = `${booking.originAirport} → ${booking.destinationAirport}`;

      await mbq.createBookingEvent({ bookingId, eventType: 'CANCELLATION_STARTED', eventTitle: 'Cancellation in progress', actorType: 'customer', actorId: booking.userId || undefined });

      // ── Execute via provider ──────────────────────────────────────────────
      let result: { cancellationId: string; refundAmount: number; refundCurrency: string; raw: unknown };
      const isEstimate = quoteId.startsWith('est_');

      if (isEstimate) {
        // Estimate-based quotes are no longer allowed — escalate to admin support
        fastify.log.warn({ bookingId, quoteId }, '[manage-booking/cancel/confirm] Estimate-based quoteId rejected');
        await createCancellationSupportTicket(booking, 'Customer attempted to confirm cancellation with an estimate-based quote (no live provider data). Requires manual admin processing.');
        return reply.code(422).send({
          error: 'This cancellation cannot be processed automatically. A support ticket has been created and our team will assist you shortly.',
          code: 'ESTIMATE_QUOTE_NOT_ALLOWED',
          supportTicketCreated: true,
        });
      } else {
        try {
          const provider = getProvider(booking.primaryProvider);
          const duffelResult = await provider.confirmCancellation(quoteId);
          result = {
            cancellationId: duffelResult.cancellationId,
            refundAmount: duffelResult.refundAmount,
            refundCurrency: duffelResult.refundCurrency,
            raw: duffelResult.raw,
          };
          await mbq.storeProviderPayload({ bookingId, provider: booking.primaryProvider, payloadType: 'cancellation_confirmed', providerReference: result.cancellationId, payloadJson: result.raw as object });
        } catch (providerErr) {
          fastify.log.error({ providerErr }, '[manage-booking/cancel/confirm] Provider cancellation failed');
          return reply.code(502).send({ error: 'The airline could not process the cancellation. Please contact support.', code: 'PROVIDER_CANCEL_FAILED' });
        }
      }

      // ── Database updates (atomic-ish) ─────────────────────────────────────
      const primaryPnr = booking.pnrs.find((p: any) => p.isPrimary) ?? booking.pnrs[0];
      const isRefundable = primaryPnr?.refundable ?? false;
      const adminFee = (isRefundable || result.refundAmount > 0) ? await getAdminServiceFee(booking) : 0;

      // Determine cancellation method from quoteId encoding
      const isVoid = quoteId.startsWith('mystifly_void_');
      const cancellationMethod = isVoid ? 'VOID' : 'REFUND';

      const netRefundAmount = result.refundAmount > 0 ? Math.max(0, result.refundAmount - adminFee) : 0;
      const fareMindFee = netRefundAmount > 0 ? adminFee : 0;
      const airlinePenalty = Math.max(0, originalAmount - result.refundAmount);
      const totalPenalty = Math.max(0, originalAmount - netRefundAmount);

      const isFullRefund = netRefundAmount >= originalAmount - 1; // 1 USD tolerance
      const newPaymentStatus = netRefundAmount <= 0
        ? 'NO_REFUND'
        : isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      // Void = ticket is voided immediately; Refund = refund is pending airline processing
      const newTicketingStatus = isVoid ? 'VOIDED' : 'REFUND_PENDING';

      await prisma.masterBooking.update({
        where: { id: bookingId },
        data: { bookingStatus: 'CANCELLED', paymentStatus: newPaymentStatus as any, ticketingStatus: newTicketingStatus as any },
      });

      // Mark all PNRs cancelled
      await prisma.bookingPnr.updateMany({ where: { bookingId }, data: { status: 'CANCELLED' } });
      // Mark all journeys and segments cancelled
      await prisma.bookingJourney.updateMany({ where: { bookingId }, data: { journeyStatus: 'cancelled' } });
      await prisma.bookingSegment.updateMany({ where: { bookingId }, data: { segmentStatus: 'cancelled' } });

      // Persist cancellation record
      const cancel = await mbq.createCancellationRecord({
        bookingId, requestedBy: booking.userId || booking.customerEmail, originalAmount,
        penaltyAmount: totalPenalty, airlinePenalty, refundAmount: netRefundAmount,
        currency: result.refundCurrency, refundMethod: resolvedRefundMethod as any,
        providerCancelId: result.cancellationId, providerResponse: result.raw as object,
        notes: isEstimate ? 'Manual cancellation — provider order not linked' : undefined,
      } as any);

      // Create refund record & process live Stripe refund
      if (netRefundAmount > 0) {
        const refundRecord = await prisma.bookingRefund.create({
          data: {
            bookingId,
            cancellationId: cancel.id,
            amount: netRefundAmount,
            currency: result.refundCurrency,
            method: resolvedRefundMethod as any,
            status: 'INITIATED',
            processingDays: 10,
          },
        });

        // ── Fire-and-forget: Stripe refund, events, notifications ──────────
        // These run in the background so the response returns immediately to the user
        (async () => {
          try {
            // Stripe Refund
            const payment = await prisma.bookingPayment.findFirst({
              where: { bookingId, status: 'SUCCEEDED' },
              orderBy: { paidAt: 'desc' },
            });

            if (payment?.stripePaymentIntentId) {
              try {
                const refundAmountCents = Math.round(netRefundAmount * 100);
                const stripeRefund = await stripe.refunds.create({
                  payment_intent: payment.stripePaymentIntentId,
                  amount: refundAmountCents,
                  reason: 'requested_by_customer',
                  metadata: {
                    bookingId,
                    bookingReference: booking.masterBookingReference,
                    cancellationId: cancel.id,
                    netRefundAmount: String(netRefundAmount),
                    adminFeeDeducted: String(fareMindFee),
                  },
                });

                fastify.log.info(
                  `[Stripe] ✅ Refund created: ${stripeRefund.id} — $${(stripeRefund.amount / 100).toFixed(2)} ${stripeRefund.currency} → ${payment.stripePaymentIntentId}`
                );

                await prisma.bookingRefund.update({
                  where: { id: refundRecord.id },
                  data: {
                    status: stripeRefund.status === 'succeeded' ? 'COMPLETED' : 'PROCESSING',
                    stripeRefundId: stripeRefund.id,
                    completedAt: stripeRefund.status === 'succeeded' ? new Date() : undefined,
                  },
                }).catch(() => {});

                await mbq.createBookingEvent({
                  bookingId, eventType: 'REFUND_PROCESSED', eventTitle: 'Refund processed via Stripe',
                  eventDescription: `Stripe refund ${stripeRefund.id}: ${fmtCurrency(netRefundAmount, result.refundCurrency)} refunded to original payment method.`,
                  actorType: 'system',
                });
              } catch (stripeErr: any) {
                fastify.log.error({ stripeErr }, `[Stripe] ❌ Refund failed for PI ${payment.stripePaymentIntentId}`);

                await prisma.bookingRefund.update({
                  where: { id: refundRecord.id },
                  data: { status: 'FAILED', failedAt: new Date(), failureReason: stripeErr.message },
                }).catch(() => {});

                await createCancellationSupportTicket(
                  booking,
                  `Stripe refund failed for PaymentIntent ${payment.stripePaymentIntentId}: ${stripeErr.message}. Net refund amount: ${fmtCurrency(netRefundAmount, result.refundCurrency)}. Please process refund manually.`
                );

                await mbq.createBookingEvent({
                  bookingId, eventType: 'REFUND_FAILED', eventTitle: 'Stripe refund failed — support ticket created',
                  eventDescription: `Refund of ${fmtCurrency(netRefundAmount, result.refundCurrency)} could not be processed via Stripe. A support ticket has been created for manual refund processing. Error: ${stripeErr.message}`,
                  actorType: 'system',
                });
              }
            } else {
              fastify.log.warn({ bookingId }, '[manage-booking/cancel/confirm] No Stripe PaymentIntent found — refund requires manual processing');

              await createCancellationSupportTicket(
                booking,
                `No Stripe PaymentIntent found for this booking. Net refund amount: ${fmtCurrency(netRefundAmount, result.refundCurrency)}. Please process refund manually.`
              );

              await prisma.bookingRefund.update({
                where: { id: refundRecord.id },
                data: { status: 'PROCESSING' },
              }).catch(() => {});
            }
          } catch (bgErr) {
            fastify.log.error(bgErr, '[manage-booking/cancel/confirm] Background refund processing error');
          }
        })(); // fire-and-forget — don't await
      }

      // ── Fire-and-forget: Events & Notifications (for all cancellations) ──
      (async () => {
        try {
          await mbq.createBookingEvent({
            bookingId, eventType: 'BOOKING_CANCELLED', eventTitle: 'Booking cancelled',
            eventDescription: `Refund: ${fmtCurrency(netRefundAmount, result.refundCurrency)} via ${resolvedRefundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment'}`,
            actorType: 'system',
          });

          const fmtRef = fmtCurrency(netRefundAmount, result.refundCurrency);
          const fmtOrig = fmtCurrency(originalAmount, booking.currency);
          const fmtPenalty = fmtCurrency(totalPenalty, booking.currency);

          if (booking.customerEmail) {
            fireNotification({
              event_type: 'BOOKING_CANCELLED',
              booking_id: bookingId,
              customer_email: booking.customerEmail,
              data: {
                booking_reference: booking.masterBookingReference,
                pnr: booking.masterPnr,
                customer_name: booking.customerName ?? '',
                customer_email: booking.customerEmail,
                origin: booking.originAirport,
                destination: booking.destinationAirport,
                route,
                refund_amount: netRefundAmount > 0 ? fmtRef : 'Non-refundable',
                refund_status: netRefundAmount > 0 ? 'Pending' : 'Not Applicable',
              },
            });
          }

          emails.sendAdminCancellationEmail({
            bookingRef: booking.masterBookingReference, customerName: booking.customerName, customerEmail: booking.customerEmail,
            route, originalAmount: fmtOrig, penaltyAmount: fmtPenalty, refundAmount: fmtRef,
            refundMethod: resolvedRefundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment Method',
            pnrs: booking.pnrs.map(p => p.pnrCode).join(', '),
            cancellationId: result.cancellationId,
          }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking] admin cancel email failed'));

          // ── Agent notification ──────────────────────────────────────
          // If this booking was made by an agent, notify them too
          if ((booking as any).agentUserId) {
            try {
              const agentUser = await prisma.user.findUnique({
                where: { id: (booking as any).agentUserId },
                select: { email: true, firstName: true, lastName: true },
              });
              if (agentUser?.email) {
                const agentName = [agentUser.firstName, agentUser.lastName].filter(Boolean).join(' ') || 'Agent';
                emails.sendAgentCancellationEmail({
                  agentEmail: agentUser.email,
                  agentName,
                  bookingRef: booking.masterBookingReference,
                  customerName: booking.customerName ?? '',
                  customerEmail: booking.customerEmail ?? '',
                  route,
                  originalAmount: fmtOrig,
                  penaltyAmount: fmtPenalty,
                  refundAmount: fmtRef,
                  refundMethod: resolvedRefundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment Method',
                  pnrs: booking.pnrs.map(p => p.pnrCode).join(', '),
                  cancellationId: result.cancellationId,
                }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking] agent cancel email failed'));
              }
            } catch (agentErr) {
              fastify.log.warn({ agentErr }, '[manage-booking] Failed to look up agent for cancellation notification');
            }
          }
        } catch (notifErr) {
          fastify.log.error(notifErr, '[manage-booking/cancel/confirm] Background notification error');
        }
      })();

      return {
        success: true,
        cancellationId: cancel.id,
        bookingReference: booking.masterBookingReference,
        cancellationMethod,   // 'VOID' or 'REFUND'
        refundAmount: netRefundAmount,
        refundCurrency: result.refundCurrency,
        refundTimeline: isVoid ? '3–5 business days' : '5–10 business days',
        refundMethod: resolvedRefundMethod,
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/cancel/confirm]'); reply.code(500).send({ error: 'Cancellation failed. Please try again or contact support.' }); }
  });

  // ── Seat Map ────────────────────────────────────────────────────────────────
  fastify.get('/:bookingId/seats/:sliceId', async (request, reply) => {
    try {
      const { bookingId, sliceId } = request.params as { bookingId: string; sliceId: string };
      const booking = await mbq.getMasterBookingFull(bookingId);
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });

      // Only use real provider APIs — no mock fallback
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

  // ── Seat Select ─────────────────────────────────────────────────────────────────
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
            fastify.log.info(`[manage-booking/seats] Seat ${seatDesignator} — provider seat change API not yet wired for ${booking.primaryProvider}`);
          } catch (providerErr) {
            fastify.log.warn({ providerErr }, '[manage-booking/seats] Provider seat change failed — recording locally');
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
          : ' (preference recorded — contact airline to confirm)';

      await mbq.createBookingEvent({
        bookingId, eventType: 'SEAT_CHANGED',
        eventTitle: 'Seat changed',
        eventDescription: `${existingSeat?.seatNumber || 'None'} → ${seatDesignator}${statusNote}`,
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
            : 'Seat preference recorded in FAREMIND. Post-booking seat changes are not available online for this provider — please contact the airline directly or manage at check-in.',
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/seats/select]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // ── Passenger Update ────────────────────────────────────────────────────────────
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
          fastify.log.warn({ providerErr }, '[manage-booking/passenger] Provider update failed — updating locally only');
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

  // ── Provider Capabilities ───────────────────────────────────────────────────
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

  // ── Date/Flight Change — Search for Options ────────────────────────────────
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

      // Find the provider order ID — check PNR first, then MasterBooking-level field
      let providerPnr = booking.pnrs.find((p: any) => p.providerOrderId);
      let resolvedProviderOrderId = providerPnr?.providerOrderId
        || (booking as any).providerOrderId   // MasterBooking-level fallback
        || null;

      // If we found a provider order ID from MasterBooking but not PNR, create a virtual PNR reference
      if (!providerPnr && resolvedProviderOrderId) {
        providerPnr = booking.pnrs.find((p: any) => p.isPrimary) ?? booking.pnrs[0];
      }

      if (!resolvedProviderOrderId) {
        // No provider order anywhere — fall back to manual request
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

      // Determine itinerary details — Duffel needs slice IDs from getOrder,
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
        // For Mystifly, use booking-level data; the adapter handles trip details internally
        const primaryPnr = booking.pnrs.find((p: any) => p.isPrimary) ?? booking.pnrs[0];
        cabinClass = primaryPnr?.fareClass || 'economy';
        currentItinerary = {
          origin: booking.originAirport,
          destination: booking.destinationAirport,
          departureAt: booking.departureDate,
          duration: '',
        };
      }

      // Search for change options via the provider adapter
      // Pass DB passengers so Mystifly can use them (getTripDetails may not return passengers)
      const dbPassengers = (booking.passengers || []).map((p: any) => ({
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        type: p.passengerType || 'ADT',
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

      return {
        supported: true,
        requestId: result.requestId,
        provider: booking.primaryProvider,
        offerCount: result.offers.length,
        offers: result.offers.map((o: any) => ({
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
          // Enhanced itinerary (Mystifly PTR)
          newItinerary: o.newItinerary ?? null,
          newSlices: o.slices?.add || [],
          removedSlices: o.slices?.remove || [],
          conditions: o.conditions,
        })),
        currentItinerary,
      };
    } catch (e: any) {
      fastify.log.error(e, '[manage-booking/change/search]');
      // Return provider errors gracefully for both Duffel and Mystifly
      if (e.message?.includes('Duffel') || e.message?.includes('Mystifly') || e.message?.includes('ReIssue')) {
        return reply.code(200).send({
          supported: false,
          fallbackMode: 'support_request',
          message: `The airline could not process your change request automatically. ${e.message}`,
          offers: [],
        });
      }
      reply.code(500).send({ error: 'Server error' });
    }
  });

  // ── Date/Flight Change — Confirm a Change Offer ────────────────────────────
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

      // Confirm the change via the provider adapter (Duffel or Mystifly)
      const result = await provider.confirmChangeOption(
        changeOfferId,
        paymentAmount,
        paymentCurrency
      );

      // Record change request in DB
      const changeReq = await mbq.createChangeRequest({
        bookingId, type: 'DATE_CHANGE',
        requestedBy: booking.userId || booking.customerEmail,
        originalData: { departureDate: booking.departureDate },
        requestedData: { changeOfferId },
        totalCost: paymentAmount || 0,
        currency: paymentCurrency || booking.currency,
      });

      // Update change request with provider confirmation
      await prisma.changeRequest.update({
        where: { id: changeReq.id },
        data: {
          status: 'CONFIRMED',
          providerChangeId: result.changeId,
          providerResponse: result.raw as any,
          confirmedAt: new Date(),
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
        bookingId, eventType: 'CHANGE_CONFIRMED',
        eventTitle: 'Flight change confirmed',
        eventDescription: `Change confirmed. New total: ${fmtCurrency(result.newTotalAmount, result.newTotalCurrency)}`,
        actorType: 'system',
      });

      // Email notification for confirmed flight change
      if (booking.customerEmail) {
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
        message: 'Your flight has been successfully changed.',
      };
    } catch (e: any) {
      fastify.log.error(e, '[manage-booking/change/confirm]');
      if (e.message?.includes('Duffel')) {
        return reply.code(502).send({ error: `Change failed: ${e.message}` });
      }
      reply.code(500).send({ error: 'Server error' });
    }
  });

  // ── Legacy: Simple Date Change Request (manual fallback) ───────────────────
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
        eventDescription: `New departure: ${newDepartureDate}${newReturnDate ? `, return: ${newReturnDate}` : ''}${reason ? ` — ${reason}` : ''}`,
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

  // ── E-Ticket ────────────────────────────────────────────────────────────────
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

  // ── Email Itinerary ─────────────────────────────────────────────────────────
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
        route: `${booking.originAirport} → ${booking.destinationAirport}`,
        status: booking.bookingStatus || 'Confirmed',
        pdfBase64,
      });

      return { success: true };
    } catch (e) { fastify.log.error(e, '[manage-booking/email-itinerary]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // ── Timeline ────────────────────────────────────────────────────────────────
  fastify.get('/:bookingId/timeline', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const events = await mbq.getBookingTimeline(bookingId);
      return { events };
    } catch (e) { fastify.log.error(e, '[manage-booking/timeline]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // ── Admin: Queue ────────────────────────────────────────────────────────────
  fastify.get('/admin/queue', async (request, reply) => {
    try {
      const { type, status } = request.query as { type?: string; status?: string };
      const queue = await mbq.getAdminActionQueue({ type: type as any, status });
      return queue;
    } catch (e) { fastify.log.error(e, '[manage-booking/admin/queue]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // ── Admin: Notes ────────────────────────────────────────────────────────────
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

  // ── Add Baggage Endpoint ────────────────────────────────────────────────────
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


  // ── Admin: Provider Payloads ────────────────────────────────────────────────
  fastify.get('/admin/:bookingId/payloads', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const payloads = await prisma.bookingProviderPayload.findMany({ where: { bookingId }, orderBy: { createdAt: 'desc' } });
      return { payloads };
    } catch (e) { reply.code(500).send({ error: 'Server error' }); }
  });
};

export default plugin;
