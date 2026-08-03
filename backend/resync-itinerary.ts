/**
 * Resync one booking's itinerary from the provider. Temporary.
 *
 *   npx tsx resync-itinerary.ts FMVTT9ZQ           # dry run — shows the diff
 *   npx tsx resync-itinerary.ts FMVTT9ZQ --apply   # writes it
 */
import { prisma } from './src/lib/db';
import { getTripDetailsResilient } from './src/services/mystifly';
import { mapProviderSegments, syncItineraryFromTripDetails } from './src/services/itinerary-sync';

async function main() {
  const ref = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!ref) { console.log('usage: resync-itinerary.ts <FM ref> [--apply]'); return; }

  const b = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: ref },
    include: { segments: { orderBy: { segmentOrder: 'asc' } } },
  });
  if (!b?.mystiflyMfRef) { console.log(`${ref}: not found or no provider reference`); return; }

  const trip = await getTripDetailsResilient(b.mystiflyMfRef);
  // Both sides sorted by departure: segmentOrder is not always distinct, so the
  // stored order alone made an in-sync booking read as mismatched.
  const provider = [...mapProviderSegments(trip)].sort(
    (x, y) => (x.departureDateTime?.getTime() ?? 0) - (y.departureDateTime?.getTime() ?? 0));
  const storedSorted = [...b.segments].sort(
    (x, y) => x.departureDateTime.getTime() - y.departureDateTime.getTime());

  console.log(`${ref}  MF=${b.mystiflyMfRef}  pnr=${b.airlinePnr}\n`);
  console.log('ord  STORED                                  PROVIDER');
  const rows = Math.max(storedSorted.length, provider.length);
  for (let i = 0; i < rows; i++) {
    const s = storedSorted[i];
    const p = provider[i];
    const L = s ? `${s.airlineCode}${s.flightNumber} ${s.originAirport}->${s.destinationAirport} ${s.departureDateTime.toISOString()}` : '—';
    const R = p ? `${p.airlineCode}${p.flightNumber} ${p.originAirport}->${p.destinationAirport} ${p.departureDateTime?.toISOString()}` : '—';
    const same = L === R;
    console.log(`${String(i).padEnd(4)} ${L.padEnd(40)} ${R}${same ? '' : '   <-- differs'}`);
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    await prisma.$disconnect();
    return;
  }

  const result = await syncItineraryFromTripDetails(b.id, b.mystiflyMfRef, trip);
  console.log('\nresult:', JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
