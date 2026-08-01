/**
 * Persist the airline's record locator onto a booking.
 *
 * Mirrors fare-rules-backfill: TripDetails only carries the locator once the
 * airline has responded, so the value is usually absent at checkout and must be
 * captured later. Runs at the same three points — the reconciliation ISSUED
 * transition, and lazily on first view of the servicing screen — so a booking is
 * corrected by whichever happens first.
 *
 * Writes nothing when the provider has no locator yet. "Not available" must
 * never become "here is the Mystifly reference instead".
 */
import { prisma } from './db';
import * as mystifly from '../services/mystifly';
import { extractAirlinePnrs, safeAirlinePnr, type AirlinePnrResult } from './airline-pnr';

export async function backfillAirlinePnr(
  bookingId: string,
  mfRef: string,
  tripDetailsRaw?: any,
): Promise<{ updated: boolean; result: AirlinePnrResult }> {
  const raw = tripDetailsRaw ?? await mystifly.getTripDetailsResilient(mfRef).catch(() => null);
  const result = extractAirlinePnrs(raw);

  const primary = safeAirlinePnr(result.primary);
  if (!primary) {
    console.log(`[AirlinePnr] ${mfRef}: airline has not published a record locator yet — nothing written`);
    return { updated: false, result };
  }

  let updated = false;

  const booking = await prisma.masterBooking.findUnique({
    where: { id: bookingId },
    select: { airlinePnr: true, masterBookingReference: true },
  });

  if (booking && booking.airlinePnr !== primary) {
    await prisma.masterBooking.update({ where: { id: bookingId }, data: { airlinePnr: primary } });
    updated = true;
    console.log(`[AirlinePnr] ${booking.masterBookingReference}: airlinePnr ${booking.airlinePnr ?? '(none)'} → ${primary}`);
  }

  // Per-PNR locators keep multi-airline and codeshare bookings intact. With a
  // single locator every row gets it; with several, match on the carrier and
  // fall back to the primary so no row is left blank.
  const pnrs = await prisma.bookingPnr.findMany({
    where: { bookingId },
    select: { id: true, pnrCode: true, airlineCode: true, airlinePnr: true },
  });

  for (const pnr of pnrs) {
    const match = result.entries.find(
      (e) => e.airlineCode && pnr.airlineCode && e.airlineCode.toUpperCase() === pnr.airlineCode.toUpperCase(),
    );
    const value = safeAirlinePnr(match?.airlinePnr ?? primary);
    if (!value || pnr.airlinePnr === value) continue;
    await prisma.bookingPnr.update({ where: { id: pnr.id }, data: { airlinePnr: value } });
    updated = true;
  }

  if (updated) {
    await prisma.bookingEvent.create({
      data: {
        bookingId,
        eventType: 'AIRLINE_PNR_CAPTURED',
        eventTitle: 'Airline record locator captured',
        eventDescription:
          `The airline's own PNR is ${primary}` +
          (result.entries.length > 1
            ? ` (plus ${result.entries.length - 1} more for other carriers on this trip)`
            : '') +
          `. This is the code the customer quotes for airline check-in and airline support — ` +
          `distinct from the Mystifly reference ${mfRef}, which is used only for provider servicing calls.`,
        actorType: 'system',
      },
    }).catch((err) => {
      console.warn(`[AirlinePnr] event log failed for ${mfRef}:`, (err as Error).message);
    });
  }

  return { updated, result };
}
