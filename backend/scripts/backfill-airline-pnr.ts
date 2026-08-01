/**
 * Capture the AIRLINE's record locator for bookings made before it was stored.
 *
 *   cd backend && DATABASE_URL="postgres://…" npx tsx scripts/backfill-airline-pnr.ts [--ref FMXXXXXX | --all] [--apply]
 *
 * DRY RUN BY DEFAULT. Without --apply it reports what would change and writes
 * nothing.
 *
 * The platform showed Mystifly's booking reference ("MF35532626") under an
 * "Airline PNR" label. The airline's own locator ("EMBV6D7") lives in
 * TripDetails at ReservationItems[].AirlinePNR and was never stored. New
 * bookings now capture it at checkout, at the reconciliation ISSUED transition,
 * and lazily on first view of the servicing screen; this covers everything
 * booked before that.
 *
 * Reads TripDetails (a read, not a billable call). Writes nothing when the
 * airline has published no locator — "Not Available" is the correct outcome, and
 * is never replaced with the Mystifly reference.
 */
import { prisma } from '../src/lib/db';
import { extractAirlinePnrs, safeAirlinePnr } from '../src/lib/airline-pnr';
import { backfillAirlinePnr } from '../src/lib/airline-pnr-backfill';
import * as mystifly from '../src/services/mystifly';

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const REF = arg('--ref');
const APPLY = argv.includes('--apply');
const ALL = argv.includes('--all') || !!REF;

async function main() {
  if (!ALL) {
    console.log('Specify --ref FMXXXXXX or --all.  Add --apply to write; omit it for a dry run.');
    process.exit(1);
  }

  const bookings = await prisma.masterBooking.findMany({
    where: {
      ...(REF ? { masterBookingReference: REF } : {}),
      primaryProvider: { equals: 'mystifly', mode: 'insensitive' },
    },
    select: {
      id: true, masterBookingReference: true, masterPnr: true,
      mystiflyMfRef: true, airlinePnr: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${bookings.length} Mystifly booking(s)\n`);
  console.log(`${'booking'.padEnd(10)} ${'mystifly ref'.padEnd(13)} ${'stored'.padEnd(12)} airline PNR from TripDetails`);
  console.log('─'.repeat(72));

  let found = 0, already = 0, none = 0;

  for (const b of bookings) {
    const mfRef = b.mystiflyMfRef || b.masterPnr;
    if (!mfRef) {
      console.log(`${b.masterBookingReference.padEnd(10)} — no provider reference, skipped`);
      continue;
    }

    const raw = await mystifly.getTripDetailsResilient(mfRef).catch(() => null);
    const { primary, entries } = extractAirlinePnrs(raw);
    const value = safeAirlinePnr(primary);

    const stored = b.airlinePnr ?? '(none)';
    if (!value) {
      none++;
      console.log(`${b.masterBookingReference.padEnd(10)} ${String(mfRef).padEnd(13)} ${stored.padEnd(12)} not published — leaving as Not Available`);
      continue;
    }
    if (b.airlinePnr === value) {
      already++;
      console.log(`${b.masterBookingReference.padEnd(10)} ${String(mfRef).padEnd(13)} ${stored.padEnd(12)} already correct`);
      continue;
    }

    found++;
    const extra = entries.length > 1 ? `  (+${entries.length - 1} more carrier locator(s))` : '';
    console.log(`${b.masterBookingReference.padEnd(10)} ${String(mfRef).padEnd(13)} ${stored.padEnd(12)} → ${value}${extra}`);

    if (APPLY) {
      const res = await backfillAirlinePnr(b.id, mfRef, raw);
      if (!res.updated) console.log(`${' '.repeat(10)} (no rows changed)`);
    }
  }

  console.log(`\nlocator captured   : ${found}${APPLY ? ' (written)' : ' (dry run — nothing written)'}`);
  console.log(`already correct    : ${already}`);
  console.log(`not published yet  : ${none}`);
  if (!APPLY && found > 0) console.log('\nRe-run with --apply to write these.');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
