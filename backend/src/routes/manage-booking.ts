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

function hashOtp(otp: string): string { return createHash('sha256').update(otp).digest('hex'); }
function generateOtp(): string { return String(Math.floor(100_000 + Math.random() * 900_000)); }
function fmtCurrency(n: number, c = 'USD') { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(n); }

// Master OTP for super admin
const MASTER_OTP = '778899';
const SUPER_ADMIN_EMAILS = ['mparihar@gmail.com'];

const BREVO_URL    = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL ?? 'noreply@faremind.ai';
const SENDER_NAME  = 'FareMind';

async function sendBookingOtpEmail(toEmail: string, toName: string, otp: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(`[manage-booking] BREVO_API_KEY not set — OTP for ${toEmail}: ${otp}`);
    return;
  }
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
      <h2 style="color:#1ABC9C;margin-bottom:8px">Your FareMind booking access code</h2>
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
      subject: `${otp} — Your FareMind booking access code`,
      htmlContent: html,
      textContent: `Your FareMind booking access code is: ${otp}\n\nValid for 5 minutes. Do not share it.`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[manage-booking] Brevo error ${res.status}:`, body);
    throw new Error(`Brevo ${res.status}: ${body}`);
  }
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
      const { filter } = request.query as { filter?: 'upcoming' | 'past' | 'cancelled' | 'all' };
      const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      const bookings = await mbq.getUserMasterBookings(userId, filter || 'all', dbUser?.email ?? undefined);
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
      const actions = [];
      if (!isCancelled && !isPast && !existingCancel) actions.push({ key: 'cancel', label: 'Cancel Booking', available: true });
      if (!isCancelled && !isPast) actions.push({ key: 'date_change', label: 'Change Flight', available: true });
      if (!isCancelled && !isPast) actions.push({ key: 'seat_change', label: 'Change Seat', available: true });
      if (!isCancelled) actions.push({ key: 'passenger_update', label: 'Update Passenger Details', available: true });
      actions.push({ key: 'download_eticket', label: 'Download E-Ticket', available: booking.ticketingStatus === 'ISSUED' });
      actions.push({ key: 'contact_support', label: 'Contact Support', available: true });
      if (existingCancel) actions.push({ key: 'refund_status', label: 'View Refund Status', available: true, data: existingCancel });

      // Expose stored fare rules from primary PNR
      const primaryPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];
      const fareRules = primaryPnr ? {
        refundable: primaryPnr.refundable,
        changeable: primaryPnr.changeable,
        cancellationFee: primaryPnr.cancellationFee != null ? Number(primaryPnr.cancellationFee) : null,
        changeFee: primaryPnr.changeFee != null ? Number(primaryPnr.changeFee) : null,
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

      const FAREMIND_FEE = 20;
      const originalAmount = Number(booking.totalAmount);
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      const pnrs = booking.pnrs.map(p => ({ pnrCode: p.pnrCode, status: p.status }));

      if (providerPnr?.providerOrderId) {
        try {
          const provider = getProvider(booking.primaryProvider);
          const quote = await provider.getCancellationQuote(providerPnr.providerOrderId);
          await mbq.storeProviderPayload({ bookingId, provider: booking.primaryProvider, payloadType: 'cancellation_quote', providerReference: quote.quoteId, payloadJson: quote.raw as object });

          const airlinePenalty = Math.max(0, originalAmount - quote.refundAmount);
          const estimatedRefund = Math.max(0, quote.refundAmount - FAREMIND_FEE);
          const refundability = estimatedRefund <= 0 ? 'NON_REFUNDABLE' : airlinePenalty > 0 ? 'PARTIAL_REFUND' : 'FULL_REFUND';

          return {
            quoteId: quote.quoteId,
            bookingReference: booking.masterBookingReference,
            bookingStatus: booking.bookingStatus,
            cancellationAllowed: true,
            airlinePermitted: true,
            refundability,
            originalAmount,
            currency: booking.currency,
            airlinePenalty,
            fareMindFee: FAREMIND_FEE,
            penaltyAmount: airlinePenalty + FAREMIND_FEE,
            estimatedRefund,
            refundAmount: quote.refundAmount,
            refundCurrency: quote.refundCurrency,
            refundTo: quote.refundTo,
            refundMethod: 'ORIGINAL_PAYMENT',
            refundTimeline: '5–10 business days',
            warningMessage: 'Cancellation penalties may vary until airline confirmation. This action cannot be undone.',
            pnrs,
            expiresAt: quote.expiresAt,
          };
        } catch (providerErr) {
          fastify.log.warn({ providerErr }, '[manage-booking/cancel/quote] Provider call failed — returning estimate');
        }
      }

      // Fallback estimate — use stored fare rules if available
      const primaryPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];
      const storedCancelFee = primaryPnr?.cancellationFee != null ? Number(primaryPnr.cancellationFee) : null;
      const isRefundable = primaryPnr?.refundable ?? false;

      const airlinePenalty = storedCancelFee != null
        ? storedCancelFee
        : (isRefundable ? 0 : Math.round(originalAmount * 0.15));
      const estimatedRefund = Math.max(0, originalAmount - airlinePenalty - FAREMIND_FEE);
      const refundability = isRefundable && airlinePenalty === 0
        ? 'FULL_REFUND'
        : estimatedRefund <= 0 ? 'NON_REFUNDABLE' : 'PARTIAL_REFUND';

      return {
        quoteId: `est_${bookingId}_${Date.now()}`,
        bookingReference: booking.masterBookingReference,
        bookingStatus: booking.bookingStatus,
        cancellationAllowed: true,
        airlinePermitted: null,
        refundability,
        originalAmount,
        currency: booking.currency,
        airlinePenalty,
        fareMindFee: FAREMIND_FEE,
        penaltyAmount: airlinePenalty + FAREMIND_FEE,
        estimatedRefund,
        refundAmount: estimatedRefund,
        refundCurrency: booking.currency,
        refundTo: 'original_form_of_payment',
        refundMethod: 'ORIGINAL_PAYMENT',
        refundTimeline: '5–10 business days',
        warningMessage: storedCancelFee != null
          ? 'Cancellation fee is based on your fare rules. This action cannot be undone.'
          : 'This is an estimate based on standard airline policies. Actual refund may vary. Our team will confirm exact amounts.',
        fareRules: {
          refundable: isRefundable,
          changeable: primaryPnr?.changeable ?? false,
          cancellationFee: storedCancelFee,
          changeFee: primaryPnr?.changeFee != null ? Number(primaryPnr.changeFee) : null,
        },
        pnrs,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
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
        // No Duffel order linked — record cancellation without provider call
        result = {
          cancellationId: `manual_${bookingId}_${Date.now()}`,
          refundAmount: 0,
          refundCurrency: booking.currency,
          raw: { note: 'Manual cancellation — no provider order' },
        };
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
      const isFullRefund = result.refundAmount >= originalAmount - 1; // 1 USD tolerance
      const newPaymentStatus = isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

      await prisma.masterBooking.update({
        where: { id: bookingId },
        data: { bookingStatus: 'CANCELLED', paymentStatus: newPaymentStatus as any, ticketingStatus: 'VOIDED' },
      });

      // Mark all PNRs cancelled
      await prisma.bookingPnr.updateMany({ where: { bookingId }, data: { status: 'CANCELLED' } });
      // Mark all journeys and segments cancelled
      await prisma.bookingJourney.updateMany({ where: { bookingId }, data: { journeyStatus: 'cancelled' } });
      await prisma.bookingSegment.updateMany({ where: { bookingId }, data: { segmentStatus: 'cancelled' } });

      // Persist cancellation record
      const penaltyAmount = Math.max(0, originalAmount - result.refundAmount);
      const cancel = await mbq.createCancellationRecord({
        bookingId, requestedBy: booking.userId || booking.customerEmail, originalAmount,
        penaltyAmount, airlinePenalty: penaltyAmount, refundAmount: result.refundAmount,
        currency: result.refundCurrency, refundMethod: resolvedRefundMethod as any,
        providerCancelId: result.cancellationId, providerResponse: result.raw as object,
        notes: isEstimate ? 'Manual cancellation — provider order not linked' : undefined,
      } as any);

      // Create refund record
      if (result.refundAmount > 0) {
        await prisma.bookingRefund.create({
          data: {
            bookingId,
            cancellationId: cancel.id,
            amount: result.refundAmount,
            currency: result.refundCurrency,
            method: resolvedRefundMethod as any,
            status: 'INITIATED',
            processingDays: 10,
          },
        });
      }

      await mbq.createBookingEvent({
        bookingId, eventType: 'BOOKING_CANCELLED', eventTitle: 'Booking cancelled',
        eventDescription: `Refund: ${fmtCurrency(result.refundAmount, result.refundCurrency)} via ${resolvedRefundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment'}`,
        actorType: 'system',
      });

      // ── Notifications (fire-and-forget) ───────────────────────────────────
      const fmtRef = fmtCurrency(result.refundAmount, result.refundCurrency);
      const fmtOrig = fmtCurrency(originalAmount, booking.currency);
      const fmtPenalty = fmtCurrency(penaltyAmount, booking.currency);

      emails.sendCancellationEmail({
        email: booking.customerEmail, name: booking.customerName, bookingRef: booking.masterBookingReference,
        route, originalAmount: fmtOrig, penaltyAmount: fmtPenalty, refundAmount: fmtRef,
        refundMethod: resolvedRefundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment Method',
      }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking] customer cancel email failed'));

      emails.sendAdminCancellationEmail({
        bookingRef: booking.masterBookingReference, customerName: booking.customerName, customerEmail: booking.customerEmail,
        route, originalAmount: fmtOrig, penaltyAmount: fmtPenalty, refundAmount: fmtRef,
        refundMethod: resolvedRefundMethod === 'AIRLINE_CREDIT' ? 'Airline Credit' : 'Original Payment Method',
        pnrs: booking.pnrs.map(p => p.pnrCode).join(', '),
        cancellationId: result.cancellationId,
      }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking] admin cancel email failed'));

      return {
        success: true,
        cancellationId: cancel.id,
        bookingReference: booking.masterBookingReference,
        refundAmount: result.refundAmount,
        refundCurrency: result.refundCurrency,
        refundTimeline: '5–10 business days',
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
      // Try to get seat map from provider; fall back to mock
      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      if (providerPnr?.providerOrderId) {
        try {
          const provider = getProvider(booking.primaryProvider);
          const seatMaps = await provider.getSeatMap(providerPnr.providerOrderId, sliceId);
          if (seatMaps.length > 0) return { seatMaps };
        } catch { /* fall through to mock */ }
      }
      // ── Mock seat map fallback ──────────────────────────────────────────────
      // Controlled by ENABLE_MOCK_SEATMAP env variable:
      //   true  (default) = return demo seat map for development/testing
      //   false           = return empty array, rely on real provider only
      const enableMock = (process.env.ENABLE_MOCK_SEATMAP ?? 'true').toLowerCase() !== 'false';

      if (!enableMock) {
        fastify.log.info(`[manage-booking/seats] No provider seat map for booking ${bookingId} — mock disabled via ENABLE_MOCK_SEATMAP=false`);
        return {
          seatMaps: [],
          isMock: false,
          error: 'Seat map not available for this booking. Please manage seat selection at airline check-in or contact support.',
        };
      }

      // Mock seat map for demo/test — clearly labelled so frontend can show appropriate messaging
      fastify.log.warn(`[manage-booking/seats] No provider seat map available for booking ${bookingId} — returning demo-only mock`);
      const seatLetters = ['A','B','C','D','E','F'];
      const types: Record<string,string> = { A:'window', B:'middle', C:'aisle', D:'aisle', E:'middle', F:'window' };
      const rows = Array.from({ length: 30 }, (_, i) => ({
        row: i + 1,
        seats: seatLetters.map(l => ({ designator: `${i+1}${l}`, available: Math.random() > 0.3, type: types[l], price: i < 5 ? 45 : i < 12 ? 25 : i < 14 ? 15 : 0, currency: 'USD', cabinClass: i < 5 ? 'business' : 'economy', isExitRow: i === 13 || i === 14, hasExtraLegroom: i < 5 || i === 13 || i === 14, serviceId: null })),
      }));
      return {
        seatMaps: [{ sliceId, segmentId: '', cabin: 'economy', rows }],
        isMock: true,
        warning: 'This is a demo seat map. Actual seat availability may differ. Seat assignments are subject to airline confirmation.',
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
        const resolvedJourneyId = journeyId || booking.journeys?.[0]?.id;
        const resolvedSegmentId = segmentId || booking.segments?.[0]?.id;
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
        emails.sendSeatChangedEmail({
          email: booking.customerEmail,
          name: booking.customerName,
          bookingRef: booking.masterBookingReference,
          segment: '',
          oldSeat: existingSeat?.seatNumber || 'None',
          newSeat: seatDesignator,
        }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking] seat change email failed'));

        fireNotification({
          event_type: 'BOOKING_UPDATED',
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
            update_type: 'Seat Change',
            update_details: `Seat changed from ${existingSeat?.seatNumber || 'None'} to ${seatDesignator}`,
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
            : 'Seat preference recorded in FareMind. Post-booking seat changes are not available online for this provider — please contact the airline directly or manage at check-in.',
      };
    } catch (e) { fastify.log.error(e, '[manage-booking/seats/select]'); reply.code(500).send({ error: 'Server error' }); }
  });

  // ── Passenger Update ────────────────────────────────────────────────────────────
  fastify.post('/:bookingId/passenger/update', async (request, reply) => {
    try {
      const { bookingId } = request.params as { bookingId: string };
      const { passengerId, updates } = request.body as { passengerId: string; updates: Record<string, string> };
      if (!passengerId || !updates) return reply.code(400).send({ error: 'passengerId and updates required' });
      const EDITABLE = ['phone', 'email', 'passportExpiry', 'passportNumber', 'nationality'];
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
          event_type: 'BOOKING_UPDATED',
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
            update_type: 'Passenger Update',
            update_details: `Updated: ${Object.keys(updates).join(', ')} for ${passenger.firstName} ${passenger.lastName}`,
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

      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      if (!providerPnr?.providerOrderId) {
        // No provider order — fall back to manual request, using stored change fee
        const fallbackPnr = booking.pnrs.find(p => p.isPrimary) ?? booking.pnrs[0];
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

      // Get the Duffel order to identify slice IDs
      const order = await provider.getOrder(providerPnr.providerOrderId);
      const targetSlice = order.slices[sliceIndex ?? 0];
      if (!targetSlice) return reply.code(400).send({ error: 'No matching slice found for this journey' });

      // Determine cabin class from first segment
      const cabinClass = targetSlice.segments[0]?.cabin || 'economy';

      // Search for change options via Duffel
      const result = await provider.searchChangeOptions(
        providerPnr.providerOrderId,
        [{ slice_id: targetSlice.id }],
        [{
          origin: targetSlice.origin,
          destination: targetSlice.destination,
          departure_date: newDepartureDate,
          cabin_class: cabinClass,
        }]
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
        offerCount: result.offers.length,
        offers: result.offers.map(o => ({
          id: o.id,
          changeTotalAmount: o.changeTotalAmount,
          changeTotalCurrency: o.changeTotalCurrency,
          penaltyAmount: o.penaltyAmount,
          penaltyCurrency: o.penaltyCurrency,
          newTotalAmount: o.newTotalAmount,
          newTotalCurrency: o.newTotalCurrency,
          expiresAt: o.expiresAt,
          newSlices: o.slices.add,
          removedSlices: o.slices.remove,
          conditions: o.conditions,
        })),
        currentItinerary: {
          origin: targetSlice.origin,
          destination: targetSlice.destination,
          departureAt: targetSlice.departureAt,
          duration: targetSlice.duration,
        },
      };
    } catch (e: any) {
      fastify.log.error(e, '[manage-booking/change/search]');
      // Return provider errors gracefully
      if (e.message?.includes('Duffel')) {
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

      const providerPnr = booking.pnrs.find(p => p.providerOrderId);
      if (!providerPnr?.providerOrderId) {
        return reply.code(400).send({ error: 'No provider order found for this booking' });
      }

      const provider = getProvider(booking.primaryProvider);

      // Confirm the change via Duffel
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

      // Email notification for confirmed date change
      if (booking.customerEmail) {
        fireNotification({
          event_type: 'DATE_CHANGE_APPROVED',
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
            update_type: 'Flight Change',
            update_details: `Flight changed. New total: ${fmtCurrency(result.newTotalAmount, result.newTotalCurrency)}`,
            new_total: fmtCurrency(result.newTotalAmount, result.newTotalCurrency),
          },
        });

        emails.sendFlightChangedEmail({
          email: booking.customerEmail,
          name: booking.customerName,
          bookingRef: booking.masterBookingReference,
          oldRoute: `${booking.originAirport} → ${booking.destinationAirport}`,
          newRoute: `${booking.originAirport} → ${booking.destinationAirport}`,
          fareDifference: fmtCurrency((result.newTotalAmount ?? 0) - Number(booking.totalAmount), result.newTotalCurrency),
          newTotal: fmtCurrency(result.newTotalAmount, result.newTotalCurrency),
        }).catch((err: unknown) => fastify.log.warn({ err }, '[manage-booking] flight change email failed'));
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
