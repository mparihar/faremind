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
import * as crypto from 'crypto';
import * as mystifly from '../services/mystifly';
import type {
  MystiflyAirTraveler,
  MystiflyPassengerType,
  MystiflyGender,
  MystiflyPassengerTitle,
} from '../services/mystifly';

// ═══════════════════════════════════════════════
// FSC Lifecycle Tracing Helpers (Points 4, 9)
// ═══════════════════════════════════════════════

/**
 * SHA-256 hash of a FareSourceCode for traceability logging.
 */
function hashFsc(fsc: string): string {
  return crypto.createHash('sha256').update(fsc).digest('hex').slice(0, 16);
}

/**
 * Deep recursive search for ALL occurrences of 'FareSourceCode' in an object.
 * Returns array of { path, value } for every match found at any nesting depth.
 */
function findAllFareSourceCodes(obj: any, path = 'root'): { path: string; value: string }[] {
  const results: { path: string; value: string }[] = [];
  if (obj == null || typeof obj !== 'object') return results;

  for (const key of Object.keys(obj)) {
    const fullPath = `${path}.${key}`;
    if (key === 'FareSourceCode' && typeof obj[key] === 'string' && obj[key].length > 0) {
      results.push({ path: fullPath, value: obj[key] });
    }
    if (typeof obj[key] === 'object') {
      results.push(...findAllFareSourceCodes(obj[key], fullPath));
    }
  }
  return results;
}

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
 * Normalize a country value to a 2-letter uppercase ISO code.
 * Mystifly requires format ^([A-Z][A-Z])$ (ERBUK037).
 * Handles: full names ("United States" → "US"), lowercase ("us" → "US"), etc.
 */
function toIsoCountry(value: string | undefined): string {
  if (!value) return 'US';
  const v = value.trim();

  // Already a 2-letter code — just uppercase it
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();

  // Common full name → code mappings
  const map: Record<string, string> = {
    'united states': 'US', 'united states of america': 'US', 'usa': 'US',
    'india': 'IN', 'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB',
    'canada': 'CA', 'australia': 'AU', 'germany': 'DE', 'france': 'FR',
    'china': 'CN', 'japan': 'JP', 'singapore': 'SG', 'malaysia': 'MY',
    'thailand': 'TH', 'indonesia': 'ID', 'philippines': 'PH',
    'united arab emirates': 'AE', 'uae': 'AE', 'saudi arabia': 'SA',
    'pakistan': 'PK', 'bangladesh': 'BD', 'sri lanka': 'LK',
    'nepal': 'NP', 'mexico': 'MX', 'brazil': 'BR', 'south korea': 'KR',
    'nigeria': 'NG', 'south africa': 'ZA', 'egypt': 'EG', 'kenya': 'KE',
    'turkey': 'TR', 'russia': 'RU', 'italy': 'IT', 'spain': 'ES',
    'netherlands': 'NL', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
    'finland': 'FI', 'ireland': 'IE', 'new zealand': 'NZ', 'portugal': 'PT',
    'switzerland': 'CH', 'belgium': 'BE', 'austria': 'AT', 'poland': 'PL',
    'czech republic': 'CZ', 'greece': 'GR', 'hungary': 'HU', 'romania': 'RO',
    'israel': 'IL', 'qatar': 'QA', 'bahrain': 'BH', 'kuwait': 'KW', 'oman': 'OM',
  };

  const lower = v.toLowerCase();
  if (map[lower]) return map[lower];

  // If it looks like a 3-letter code, take first 2 as best guess
  if (/^[A-Za-z]{3}$/.test(v)) return v.slice(0, 2).toUpperCase();

  // Fallback
  console.warn(`[Mystifly] Unknown country "${v}" — defaulting to US`);
  return 'US';
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
      Country: toIsoCountry(p.passportCountry || p.nationality),
    } : undefined,
    PassengerNationality: toIsoCountry(p.nationality),
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

      // ── Point 1 & 9: Log the exact Search v2 FSC with hash ──
      const searchFscHash = hashFsc(fareSourceCode);
      console.log(`[FSC-Trace] SEARCH FSC — len=${fareSourceCode.length}, sha256=${searchFscHash}, preview=${fareSourceCode.slice(0, 60)}...`);

      // ── Point 2: Send the exact Search FSC to Revalidate v1 ──
      console.log(`[Mystifly] Revalidating fare via POST /api/v1/Revalidate/Flight`);
      const result = await mystifly.revalidateFlight(fareSourceCode);

      // Check for Mystifly-level errors
      const error = result?.Data?.Error || result?.Error;
      if (error?.ErrorCode && error.ErrorCode !== '0') {
        console.warn(`[Mystifly] Revalidation failed: ${error.ErrorMessage}`);
        return reply.code(422).send({
          error: error.ErrorMessage || 'Fare is no longer available',
          errorCode: 'REVALIDATION_FAILED',
          raw: error,
        });
      }

      // ── Point 3: Log the COMPLETE raw Revalidate response ──
      console.log(`[FSC-Trace] REVALIDATE RAW RESPONSE (full):\n${JSON.stringify(result, null, 2)}`);

      // ── Point 4: Deep recursive search for FareSourceCode in response ──
      const allFscs = findAllFareSourceCodes(result);
      console.log(`[FSC-Trace] Deep search found ${allFscs.length} FareSourceCode(s) in response:`);
      for (const found of allFscs) {
        const h = hashFsc(found.value);
        console.log(`[FSC-Trace]   path=${found.path}, len=${found.value.length}, sha256=${h}, preview=${found.value.slice(0, 60)}...`);
        console.log(`[FSC-Trace]   matchesSearch=${found.value === fareSourceCode}`);
      }

      // Extract revalidated fare info
      const itinerary = result?.Data?.PricedItineraries?.[0] ?? result?.PricedItineraries?.[0];
      const totalFare = itinerary?.AirItineraryPricingInfo?.ItinTotalFare?.TotalFare?.Amount;
      const currency = itinerary?.AirItineraryPricingInfo?.ItinTotalFare?.TotalFare?.CurrencyCode ?? 'USD';

      // ── Extract IsValid and HoldAllowed from revalidation response ──
      // These fields determine the correct booking flow:
      //   HoldAllowed=true  → Hold booking: BookFlight → OrderTicket (payment at OrderTicket)
      //   HoldAllowed=false → Webfare:      BookFlight (payment at BookFlight, no OrderTicket)
      const isValidRaw = result?.Data?.IsValid ?? result?.IsValid ?? itinerary?.IsValid;
      const isValid = isValidRaw === true || isValidRaw === 'true' || isValidRaw === 'True';
      const holdAllowedRaw = result?.Data?.HoldAllowed ?? result?.HoldAllowed ?? itinerary?.HoldAllowed;
      const holdAllowed = holdAllowedRaw === true || holdAllowedRaw === 'true' || holdAllowedRaw === 'True';

      console.log(`[Mystifly] Revalidation flags — IsValid: ${isValidRaw} (${isValid}), HoldAllowed: ${holdAllowedRaw} (${holdAllowed})`);

      // ── Block booking if IsValid is explicitly false ──
      if (isValidRaw !== undefined && !isValid) {
        console.error(`[Mystifly] ❌ Revalidation returned IsValid=false — fare is no longer available`);
        return reply.code(422).send({
          error: 'Fare is no longer valid. Please select an alternate flight.',
          errorCode: 'REVALIDATION_INVALID',
          searchFscHash,
          raw: result,
        });
      }

      // Use the FIRST non-search FSC found in deep search, or the first FSC found
      let revalidatedFareSourceCode: string | null = null;
      for (const found of allFscs) {
        // Prefer an FSC that is DIFFERENT from search (indicates revalidation produced a new one)
        if (found.value !== fareSourceCode) {
          revalidatedFareSourceCode = found.value;
          console.log(`[FSC-Trace] Using REVALIDATED FSC from path=${found.path} (differs from search)`);
          break;
        }
      }
      // If all found FSCs match the search FSC, use the first one (echo-back is valid for some providers)
      if (!revalidatedFareSourceCode && allFscs.length > 0) {
        revalidatedFareSourceCode = allFscs[0].value;
        console.log(`[FSC-Trace] Using FSC from path=${allFscs[0].path} (same as search — echo-back)`);
      }

      // ── Point 5 & 10: Do NOT fallback to original search FSC ──
      if (!revalidatedFareSourceCode) {
        console.error(`[FSC-Trace] ❌ BLOCKING: Revalidation returned NO FareSourceCode. Cannot proceed to Book.`);
        return reply.code(422).send({
          error: 'Revalidation succeeded but returned no FareSourceCode. Booking blocked.',
          errorCode: 'REVALIDATION_NO_FSC',
          searchFscHash,
          raw: result,
        });
      }

      // ── Point 9: Log revalidated FSC hash ──
      const revalFscHash = hashFsc(revalidatedFareSourceCode);
      console.log(`[FSC-Trace] REVALIDATED FSC — len=${revalidatedFareSourceCode.length}, sha256=${revalFscHash}`);
      console.log(`[FSC-Trace] FSC comparison — search=${searchFscHash} vs reval=${revalFscHash}, match=${searchFscHash === revalFscHash}`);
      console.log(`[Mystifly] Revalidation success — fare: ${totalFare} ${currency}, holdAllowed: ${holdAllowed}`);

      return {
        success: true,
        isValid,
        holdAllowed,
        totalFare: totalFare ? parseFloat(totalFare) : null,
        currency,
        fareSourceCode: revalidatedFareSourceCode,
        revalidatedFareSourceCode,
        searchFscHash,
        revalFscHash,
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
        holdBooking,
      } = request.body as {
        fareSourceCode?: string;
        passengers?: any[];
        email?: string;
        phone?: string;
        countryCode?: string;
        clientReferenceNo?: string;
        holdBooking?: boolean;
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

      // ── Point 9: Log BOOK FSC with hash ──
      const bookFscHash = hashFsc(fareSourceCode);
      console.log(`[FSC-Trace] BOOK FSC — len=${fareSourceCode.length}, sha256=${bookFscHash}, preview=${fareSourceCode.slice(0, 60)}...`);

      // ── Point 7: Build a DEDICATED Book v1 request payload ──
      // Do NOT spread or reuse the Search v2 response model.
      const travelers = toMystiflyTravelers(passengers);

      console.log(
        `[Mystifly] Creating booking via POST /api/v1/Book/Flight — ${travelers.length} passenger(s), ` +
        `FSC hash: ${bookFscHash}`
      );

      const result = await mystifly.bookFlight({
        fareSourceCode,
        travelers,
        phoneNumber: (phone || '0000000000').replace(/[^0-9]/g, ''),
        email,
        countryCode: toIsoCountry(countryCode),
        clientReferenceNo,
        holdBooking: holdBooking ?? false,
      });

      // Log full Book response for debugging
      console.log(`[FSC-Trace] BOOK RAW RESPONSE:\n${JSON.stringify(result, null, 2)}`);

      // Check for Mystifly-level errors
      const errors = result?.Data?.Errors || result?.Errors || [];
      const error = result?.Data?.Error || result?.Error;
      const hasError = (error?.ErrorCode && error.ErrorCode !== '0') ||
                       (Array.isArray(errors) && errors.length > 0 && errors.some((e: any) => e.Code && e.Code !== '0'));

      if (hasError) {
        const errMsg = error?.ErrorMessage || errors?.[0]?.Message || 'Booking creation failed';
        const errCode = error?.ErrorCode || errors?.[0]?.Code || 'UNKNOWN';
        console.error(`[Mystifly] ❌ Booking failed: [${errCode}] ${errMsg}`);
        console.error(`[FSC-Trace] BOOK FAILED with FSC hash=${bookFscHash}`);
        return reply.code(422).send({
          error: errMsg,
          errorCode: 'MYSTIFLY_BOOKING_FAILED',
          mystiflyErrorCode: errCode,
          bookFscHash,
          raw: result,
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

      console.log(`[Mystifly] ✅ Booking created — MFRef: ${uniqueId}, status: ${status}, FSC hash: ${bookFscHash}`);

      return {
        success: true,
        uniqueId,
        status,
        bookFscHash,
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

