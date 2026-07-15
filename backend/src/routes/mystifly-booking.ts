/**
 * Mystifly Booking Proxy Routes
 *
 * Exposes Mystifly booking operations as REST endpoints callable from
 * the Next.js API routes. The full Mystifly client (auth, session,
 * retries) lives in services/mystifly.ts — these are thin proxies.
 *
 * Endpoints:
 *   POST /api/mystifly/revalidate   — Confirm price/availability
 *   POST /api/mystifly/book         — Create PNR (no ticket yet)
 *   POST /api/mystifly/order-ticket — Issue ticket (after payment)
 *   POST /api/mystifly/cancel       — Cancel booking by MFRef
 */

import { FastifyPluginAsync } from 'fastify';
import * as mystifly from '../services/mystifly';
import type {
  MystiflyAirTraveler,
  MystiflyPassengerType,
  MystiflyGender,
  MystiflyPassengerTitle,
} from '../services/mystifly';

// ═══════════════════════════════════════════════
// Passenger Mapping Helpers
// ═══════════════════════════════════════════════

/**
 * Convert checkout passenger type to Mystifly's passenger type code.
 */
function toMystiflyPaxType(type: string): MystiflyPassengerType {
  switch (type?.toLowerCase()) {
    case 'child': return 'CHD';
    case 'infant': return 'INF';
    default: return 'ADT';
  }
}

/**
 * Convert gender to Mystifly's gender code.
 */
function toMystiflyGender(gender: string): MystiflyGender {
  switch (gender?.toLowerCase()) {
    case 'female': return 'F';
    case 'male': return 'M';
    default: return 'U';
  }
}

/**
 * Derive Mystifly passenger title from gender and type.
 */
function toMystiflyTitle(gender: string, type: string): MystiflyPassengerTitle {
  if (type?.toLowerCase() === 'infant') return 'INF';
  if (type?.toLowerCase() === 'child') {
    return gender?.toLowerCase() === 'female' ? 'MISS' : 'MSTR';
  }
  return gender?.toLowerCase() === 'female' ? 'MS' : 'MR';
}

/**
 * Convert checkout passengers to Mystifly's AirTraveler format.
 */
function toMystiflyTravelers(passengers: any[]): MystiflyAirTraveler[] {
  return passengers.map((p) => ({
    PassengerType: toMystiflyPaxType(p.type),
    Gender: toMystiflyGender(p.gender),
    PassengerName: {
      PassengerTitle: toMystiflyTitle(p.gender, p.type),
      PassengerFirstName: (p.firstName || 'Unknown').toUpperCase(),
      PassengerLastName: (p.lastName || 'Traveler').toUpperCase(),
    },
    DateOfBirth: p.dateOfBirth || '1990-01-01',
    Passport: p.passportNumber ? {
      PassportNumber: p.passportNumber,
      ExpiryDate: p.passportExpiry || '',
      Country: p.passportCountry || p.nationality || 'US',
    } : undefined,
    PassengerNationality: p.nationality || 'US',
  }));
}

// ═══════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════

const plugin: FastifyPluginAsync = async (fastify) => {

  // ── Revalidate ──────────────────────────────────────────────────────────────
  // Confirms the fare is still available and returns current pricing.
  // Must be called before booking.

  fastify.post('/revalidate', async (request, reply) => {
    try {
      const { fareSourceCode } = request.body as { fareSourceCode?: string };

      if (!fareSourceCode) {
        return reply.code(400).send({ error: 'fareSourceCode is required' });
      }

      console.log(`[Mystifly] Revalidating fare: ${fareSourceCode.slice(0, 40)}...`);
      const result = await mystifly.revalidateFlight(fareSourceCode);

      // Check for Mystifly-level errors in the response
      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.warn(`[Mystifly] Revalidation failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Fare is no longer available',
          errorCode: 'REVALIDATION_FAILED',
          raw: error,
        });
      }

      // Extract revalidated fare amount
      const itinerary = result?.Data?.PricedItineraries?.[0] ?? result?.PricedItineraries?.[0];
      const totalFare = itinerary?.AirItineraryPricingInfo?.ItinTotalFare?.TotalFare?.Amount;
      const currency = itinerary?.AirItineraryPricingInfo?.ItinTotalFare?.TotalFare?.CurrencyCode ?? 'USD';

      // CRITICAL: Mystifly revalidation issues a NEW FareSourceCode that MUST be
      // used for booking. Using the original search FSC causes ERBUK103
      // ("API version mismatch - Invalid FareSourceCode").
      const revalidatedFareSourceCode = itinerary?.FareSourceCode || null;
      if (revalidatedFareSourceCode && revalidatedFareSourceCode !== fareSourceCode) {
        console.log(`[Mystifly] FareSourceCode updated: ${fareSourceCode.slice(0, 30)}... → ${revalidatedFareSourceCode.slice(0, 30)}...`);
      }

      console.log(`[Mystifly] Revalidation success — fare: ${totalFare} ${currency}`);

      return {
        success: true,
        totalFare: totalFare ? parseFloat(totalFare) : null,
        currency,
        fareSourceCode: revalidatedFareSourceCode || fareSourceCode,
        revalidatedFareSourceCode,
        raw: result,
      };
    } catch (error: any) {
      console.error('[Mystifly] Revalidation error:', error.message);
      return reply.code(502).send({
        error: `Mystifly revalidation failed: ${error.message}`,
        errorCode: 'MYSTIFLY_REVALIDATION_ERROR',
      });
    }
  });

  // ── Book ────────────────────────────────────────────────────────────────────
  // Creates a PNR. Does NOT issue tickets — that requires orderTicket().

  fastify.post('/book', async (request, reply) => {
    try {
      const {
        fareSourceCode,
        passengers,
        email,
        phone,
        countryCode,
        clientReferenceNo,
      } = request.body as {
        fareSourceCode?: string;
        passengers?: any[];
        email?: string;
        phone?: string;
        countryCode?: string;
        clientReferenceNo?: string;
      };

      if (!fareSourceCode) {
        return reply.code(400).send({ error: 'fareSourceCode is required' });
      }
      if (!passengers || passengers.length === 0) {
        return reply.code(400).send({ error: 'passengers are required' });
      }
      if (!email) {
        return reply.code(400).send({ error: 'email is required' });
      }

      const travelers = toMystiflyTravelers(passengers);

      console.log(
        `[Mystifly] Creating booking — ${travelers.length} passenger(s), ` +
        `fare: ${fareSourceCode.slice(0, 40)}...`
      );

      const result = await mystifly.bookFlight({
        fareSourceCode,
        travelers,
        phoneNumber: (phone || '0000000000').replace(/[^0-9]/g, ''),
        email,
        countryCode: countryCode || 'US',
        clientReferenceNo,
        holdBooking: false,
      });

      // Check for Mystifly-level errors
      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.error(`[Mystifly] Booking failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Booking creation failed',
          errorCode: 'MYSTIFLY_BOOKING_FAILED',
          raw: error,
        });
      }

      // Extract booking reference
      const uniqueId = result?.Data?.UniqueID || result?.UniqueID || null;
      const status = result?.Data?.Status || result?.Status || 'Unknown';

      if (!uniqueId) {
        console.error('[Mystifly] Booking returned no UniqueID:', JSON.stringify(result, null, 2));
        return reply.code(502).send({
          error: 'Booking created but no reference returned',
          errorCode: 'MYSTIFLY_NO_REFERENCE',
          raw: result,
        });
      }

      console.log(`[Mystifly] ✅ Booking created — MFRef: ${uniqueId}, status: ${status}`);

      return {
        success: true,
        uniqueId,
        status,
        raw: result,
      };
    } catch (error: any) {
      console.error('[Mystifly] Booking error:', error.message);
      return reply.code(502).send({
        error: `Mystifly booking failed: ${error.message}`,
        errorCode: 'MYSTIFLY_BOOKING_ERROR',
      });
    }
  });

  // ── Order Ticket ────────────────────────────────────────────────────────────
  // Issues the ticket. ONLY call this AFTER payment succeeds.

  fastify.post('/order-ticket', async (request, reply) => {
    try {
      const {
        uniqueId,
        fareSourceCode,
        clientReferenceNo,
      } = request.body as {
        uniqueId?: string;
        fareSourceCode?: string;
        clientReferenceNo?: string;
      };

      if (!uniqueId) {
        return reply.code(400).send({ error: 'uniqueId is required' });
      }

      console.log(`[Mystifly] Issuing ticket — MFRef: ${uniqueId}`);

      const result = await mystifly.orderTicket(uniqueId, fareSourceCode, clientReferenceNo);

      // Check for errors
      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.error(`[Mystifly] Ticketing failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Ticketing failed',
          errorCode: 'MYSTIFLY_TICKETING_FAILED',
          raw: error,
        });
      }

      const status = result?.Data?.Status || result?.Status || 'Unknown';
      console.log(`[Mystifly] ✅ Ticket issued — MFRef: ${uniqueId}, status: ${status}`);

      return {
        success: true,
        uniqueId,
        status,
        raw: result,
      };
    } catch (error: any) {
      console.error('[Mystifly] Ticketing error:', error.message);
      return reply.code(502).send({
        error: `Mystifly ticketing failed: ${error.message}`,
        errorCode: 'MYSTIFLY_TICKETING_ERROR',
      });
    }
  });

  // ── Cancel ──────────────────────────────────────────────────────────────────

  fastify.post('/cancel', async (request, reply) => {
    try {
      const { uniqueId } = request.body as { uniqueId?: string };

      if (!uniqueId) {
        return reply.code(400).send({ error: 'uniqueId is required' });
      }

      console.log(`[Mystifly] Cancelling booking — MFRef: ${uniqueId}`);

      const result = await mystifly.cancelBooking(uniqueId);

      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.error(`[Mystifly] Cancellation failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Cancellation failed',
          errorCode: 'MYSTIFLY_CANCEL_FAILED',
          raw: error,
        });
      }

      const status = result?.Data?.Status || result?.Status || 'Cancelled';
      console.log(`[Mystifly] ✅ Booking cancelled — MFRef: ${uniqueId}, status: ${status}`);

      return {
        success: true,
        uniqueId,
        status,
        raw: result,
      };
    } catch (error: any) {
      console.error('[Mystifly] Cancellation error:', error.message);
      return reply.code(502).send({
        error: `Mystifly cancellation failed: ${error.message}`,
        errorCode: 'MYSTIFLY_CANCEL_ERROR',
      });
    }
  });

  // ── Ticket Status (AirTicketOrderStatus) ───────────────────────────────────
  // Returns the current ticketing status for a booking.
  // Used by the ticketing reconciliation worker and admin UI.

  fastify.post('/ticket-status', async (request, reply) => {
    try {
      const { uniqueId } = request.body as { uniqueId?: string };

      if (!uniqueId) {
        return reply.code(400).send({ error: 'uniqueId is required' });
      }

      console.log(`[Mystifly] Checking ticket status — MFRef: ${uniqueId}`);

      const result = await mystifly.getTicketOrderStatus(uniqueId);

      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.warn(`[Mystifly] Ticket status check failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Ticket status check failed',
          errorCode: 'MYSTIFLY_TICKET_STATUS_FAILED',
          raw: error,
        });
      }

      // Extract status — Mystifly uses "TktStatus" or similar fields
      const ticketStatus = result?.Data?.TktStatus || result?.Data?.Status || result?.Status || 'Unknown';
      const ticketNumbers = result?.Data?.TicketNumbers || result?.Data?.ETicketNumbers || [];

      console.log(`[Mystifly] Ticket status for ${uniqueId}: ${ticketStatus}`);

      return {
        success: true,
        uniqueId,
        ticketStatus,
        ticketNumbers,
        raw: result,
      };
    } catch (error: any) {
      console.error('[Mystifly] Ticket status error:', error.message);
      return reply.code(502).send({
        error: `Mystifly ticket status check failed: ${error.message}`,
        errorCode: 'MYSTIFLY_TICKET_STATUS_ERROR',
      });
    }
  });

  // ── Trip Details ───────────────────────────────────────────────────────────
  // Returns full booking/trip details from Mystifly.
  // Used to reconcile booking state and extract ticket numbers.

  fastify.post('/trip-details', async (request, reply) => {
    try {
      const { uniqueId } = request.body as { uniqueId?: string };

      if (!uniqueId) {
        return reply.code(400).send({ error: 'uniqueId is required' });
      }

      console.log(`[Mystifly] Fetching trip details — MFRef: ${uniqueId}`);

      const result = await mystifly.getTripDetails(uniqueId);

      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.warn(`[Mystifly] Trip details fetch failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Trip details fetch failed',
          errorCode: 'MYSTIFLY_TRIP_DETAILS_FAILED',
          raw: error,
        });
      }

      // Extract key info from trip details
      const tripData = result?.Data || result;
      const bookingStatus = tripData?.BookingStatus || tripData?.Status || 'Unknown';
      const ticketNumbers: string[] = [];

      // Extract ticket numbers from passengers
      const travelers = tripData?.TravelItinerary?.ItineraryInfo?.CustomerInfos || [];
      for (const traveler of travelers) {
        const eTickets = traveler?.ETicketNumbers || traveler?.TicketDocumentInfo || [];
        for (const ticket of eTickets) {
          const num = ticket?.eTicketNumber || ticket?.TicketNumber || ticket;
          if (num && typeof num === 'string') ticketNumbers.push(num);
        }
      }

      console.log(`[Mystifly] Trip details for ${uniqueId}: status=${bookingStatus}, tickets=[${ticketNumbers.join(', ')}]`);

      return {
        success: true,
        uniqueId,
        bookingStatus,
        ticketNumbers,
        raw: result,
      };
    } catch (error: any) {
      console.error('[Mystifly] Trip details error:', error.message);
      return reply.code(502).send({
        error: `Mystifly trip details failed: ${error.message}`,
        errorCode: 'MYSTIFLY_TRIP_DETAILS_ERROR',
      });
    }
  });

  // ═══════════════════════════════════════════════
  // Fare Rules — Agent Workspace
  // ═══════════════════════════════════════════════

  fastify.post('/fare-rules', async (request, reply) => {
    try {
      const { fareSourceCode } = request.body as { fareSourceCode?: string };
      if (!fareSourceCode) {
        return reply.code(400).send({ error: 'fareSourceCode is required' });
      }

      console.log(`[Mystifly] Fetching fare rules — FSC: ${fareSourceCode.slice(0, 20)}...`);
      const result = await mystifly.getFareRules(fareSourceCode);

      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        return reply.code(422).send({
          error: error.ErrorMessage || 'Fare rules fetch failed',
          errorCode: 'MYSTIFLY_FARE_RULES_FAILED',
          raw: error,
        });
      }

      return { success: true, ...result };
    } catch (error: any) {
      console.error('[Mystifly] Fare rules error:', error.message);
      return reply.code(502).send({
        error: `Mystifly fare rules failed: ${error.message}`,
        errorCode: 'MYSTIFLY_FARE_RULES_ERROR',
      });
    }
  });

  // ═══════════════════════════════════════════════
  // Seat Map — Agent Workspace
  // ═══════════════════════════════════════════════

  fastify.post('/seat-map', async (request, reply) => {
    try {
      const { fareSourceCode } = request.body as { fareSourceCode?: string };
      if (!fareSourceCode) {
        return reply.code(400).send({ error: 'fareSourceCode is required' });
      }

      console.log(`[Mystifly] Fetching seat map — FSC: ${fareSourceCode.slice(0, 20)}...`);
      const result = await mystifly.getSeatMap(fareSourceCode);

      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        return reply.code(422).send({
          error: error.ErrorMessage || 'Seat map fetch failed',
          errorCode: 'MYSTIFLY_SEAT_MAP_FAILED',
          raw: error,
        });
      }

      return { success: true, ...result };
    } catch (error: any) {
      console.error('[Mystifly] Seat map error:', error.message);
      return reply.code(502).send({
        error: `Mystifly seat map failed: ${error.message}`,
        errorCode: 'MYSTIFLY_SEAT_MAP_ERROR',
      });
    }
  });

  // ═══════════════════════════════════════════════
  // Booking Notes — Agent Workspace
  // ═══════════════════════════════════════════════

  fastify.post('/booking-notes', async (request, reply) => {
    try {
      const { uniqueId, notes } = request.body as { uniqueId?: string; notes?: string[] };
      if (!uniqueId || !notes || notes.length === 0) {
        return reply.code(400).send({ error: 'uniqueId and notes[] are required' });
      }

      console.log(`[Mystifly] Adding ${notes.length} booking note(s) — MFRef: ${uniqueId}`);
      const result = await mystifly.addBookingNotes(uniqueId, notes);

      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        return reply.code(422).send({
          error: error.ErrorMessage || 'Booking notes failed',
          errorCode: 'MYSTIFLY_BOOKING_NOTES_FAILED',
          raw: error,
        });
      }

      return { success: true, ...result };
    } catch (error: any) {
      console.error('[Mystifly] Booking notes error:', error.message);
      return reply.code(502).send({
        error: `Mystifly booking notes failed: ${error.message}`,
        errorCode: 'MYSTIFLY_BOOKING_NOTES_ERROR',
      });
    }
  });
};

export default plugin;

