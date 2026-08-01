/**
 * Correct BookingPnr fare rules on bookings that were ticketed before the
 * reconciliation backfill existed.
 *
 *   cd backend && DATABASE_URL="postgres://…" npx tsx scripts/backfill-fare-rules.ts [--ref FMXXXXXX | --all] [--apply]
 *
 * DRY RUN BY DEFAULT. Without --apply it reports what would change and writes
 * nothing.
 *
 * The snapshot is written moments after Book, but Mystifly does not publish
 * TripDetailsPTC_FareBreakdowns until the ticket is issued — so checkout falls
 * back to the search view, which reports RefundAllowed=false for fares the
 * airline will actually refund. Newly-ticketed bookings are now corrected by
 * the reconciliation worker; this handles the ones already past that point.
 *
 * Reads TripDetails (a read, not a billable call) and writes only where the
 * airline disagrees with what we stored.
 */
import { prisma } from '../src/lib/db';
import { fareRulesFromTripDetails, backfillFareRulesFromTripDetails } from '../src/lib/fare-rules-backfill';
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
      id: true, masterBookingReference: true, masterPnr: true, mystiflyMfRef: true,
      ticketingStatus: true, bookingStatus: true,
      pnrs: { select: { pnrCode: true, refundable: true, changeable: true, cancellationFee: true, changeFee: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${bookings.length} Mystifly booking(s)\n`);

  let changed = 0, agreed = 0, unavailable = 0;

  for (const b of bookings) {
    const mfRef = b.mystiflyMfRef || b.masterPnr;
    if (!mfRef) {
      console.log(`${b.masterBookingReference.padEnd(10)} no provider reference — skipped`);
      continue;
    }

    const raw = await mystifly.getTripDetailsResilient(mfRef).catch(() => null);
    const rules = fareRulesFromTripDetails(raw);

    if (!rules) {
      unavailable++;
      console.log(`${b.masterBookingReference.padEnd(10)} ${String(mfRef).padEnd(12)} airline has not published fare terms yet — leaving alone`);
      continue;
    }

    const diffs = b.pnrs.filter((p) =>
      p.refundable !== rules.refundable
      || p.changeable !== rules.changeable
      || (rules.cancellationFee !== null && Number(p.cancellationFee ?? NaN) !== rules.cancellationFee)
      || (rules.changeFee !== null && Number(p.changeFee ?? NaN) !== rules.changeFee));

    if (diffs.length === 0) {
      agreed++;
      console.log(`${b.masterBookingReference.padEnd(10)} ${String(mfRef).padEnd(12)} agrees with the airline`);
      continue;
    }

    changed++;
    for (const p of diffs) {
      console.log(
        `${b.masterBookingReference.padEnd(10)} ${String(mfRef).padEnd(12)} pnr=${p.pnrCode}\n` +
        `    refundable ${p.refundable} → ${rules.refundable}` +
        `   changeable ${p.changeable} → ${rules.changeable}\n` +
        `    refundFee  ${p.cancellationFee ?? '-'} → ${rules.cancellationFee ?? '-'}` +
        `   changeFee  ${p.changeFee ?? '-'} → ${rules.changeFee ?? '-'}`,
      );
    }

    if (APPLY) {
      const res = await backfillFareRulesFromTripDetails(b.id, mfRef, raw);
      console.log(`    → updated ${res.updated} PNR row(s)`);
    }
  }

  console.log(`\ndisagreed with the airline : ${changed}${APPLY ? ' (corrected)' : ' (dry run — nothing written)'}`);
  console.log(`already agreed             : ${agreed}`);
  console.log(`terms not yet published    : ${unavailable}`);
  if (!APPLY && changed > 0) console.log('\nRe-run with --apply to write these corrections.');

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
