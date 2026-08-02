/**
 * Resolve a booking's AIRLINE record locator, asking the provider when we do not
 * already hold it.
 *
 * The locator is frequently not in the BookFlight response — the airline
 * publishes it moments later. Anything that reads it straight off the booking at
 * checkout therefore sees null and renders "Not Available": the confirmation
 * screen, and worse, the confirmation email, which is the copy the customer
 * actually keeps and takes to the airport.
 *
 * So: read what we stored, and if there is nothing, call TripDetails, extract the
 * locator and persist it. Persisting means the next reader — My Trips, the agent
 * and admin consoles, servicing, the PDF — gets it without another provider call.
 *
 * Returns null when the airline genuinely has not published one. Callers must
 * render "Not Available" on null and must never substitute the Mystifly
 * reference, which the airline cannot look up.
 */
import prisma from '@/lib/db';
import { airlinePnrFromTripDetails } from '@/lib/airline-pnr-from-trip-details';
import { airlinePnr as safeAirlinePnr } from '@/lib/booking-identifiers';

const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');

export interface ResolvedAirlinePnr {
  airlinePnr: string | null;
  source: 'stored' | 'provider' | 'not_published_yet' | 'provider_unavailable' | 'unsupported_provider' | 'not_found';
}

/** Fill any per-PNR row that has no locator yet. Never overwrites one that has. */
async function backfillChildPnrs(bookingId: string, airlinePnr: string): Promise<void> {
  await prisma.bookingPnr.updateMany({
    where: { bookingId, airlinePnr: null },
    data: { airlinePnr },
  });
}

/**
 * `attempts` re-asks the provider when the first call finds nothing, spaced by
 * `delayMs`. Use it only off the request path — the confirmation email is sent
 * from `after()`, where waiting a few seconds for a real locator beats sending
 * the customer one that says "Not Available".
 */
export async function resolveAirlinePnr(
  bookingId: string,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<ResolvedAirlinePnr> {
  const attempts = Math.max(1, opts.attempts ?? 1);
  const delayMs = opts.delayMs ?? 5000;

  const booking = await prisma.masterBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, airlinePnr: true, mystiflyMfRef: true, masterPnr: true, primaryProvider: true },
  });
  if (!booking) return { airlinePnr: null, source: 'not_found' };

  if (booking.airlinePnr) {
    // The master has it, but the per-PNR rows can still be blank: checkout
    // writes the locator onto MasterBooking only, and a webfare is ticketed
    // instantly so reconciliation — which does fill the children — may never
    // run. Servicing reads providerPnr.airlinePnr, and lookup falls back to it
    // for multi-airline trips, so leaving them null loses the locator there.
    await backfillChildPnrs(booking.id, booking.airlinePnr);
    return { airlinePnr: booking.airlinePnr, source: 'stored' };
  }

  // Duffel orders carry their own identifiers through a different flow.
  const mfRef = booking.mystiflyMfRef || booking.masterPnr;
  if ((booking.primaryProvider || '').toLowerCase() !== 'mystifly' || !mfRef) {
    return { airlinePnr: null, source: 'unsupported_provider' };
  }

  let last: ResolvedAirlinePnr = { airlinePnr: null, source: 'not_published_yet' };

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const res = await fetch(`${BACKEND_URL}/api/mystifly/trip-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uniqueId: mfRef }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) { last = { airlinePnr: null, source: 'provider_unavailable' }; continue; }

      // safeAirlinePnr rejects an MF-shaped value, so a provider or mapping slip
      // cannot put the Mystifly reference under the airline's label.
      const found = safeAirlinePnr(airlinePnrFromTripDetails(data.raw));
      if (!found) { last = { airlinePnr: null, source: 'not_published_yet' }; continue; }

      await prisma.masterBooking.update({ where: { id: booking.id }, data: { airlinePnr: found } });
      await backfillChildPnrs(booking.id, found);
      console.log(`[AirlinePnr] ${bookingId}: captured ${found} from TripDetails`);
      return { airlinePnr: found, source: 'provider' };
    } catch (err: any) {
      console.warn(`[AirlinePnr] ${bookingId}: TripDetails attempt ${i + 1} failed: ${err?.message ?? err}`);
      last = { airlinePnr: null, source: 'provider_unavailable' };
    }
  }

  return last;
}
