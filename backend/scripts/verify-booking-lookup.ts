/**
 * FareMind — booking-lookup sweep (read-only QA tool)
 *
 * Usage:  DATABASE_URL="postgres://…" npx tsx backend/scripts/verify-booking-lookup.ts
 *
 * A customer or agent quotes one of two codes: our FareMind reference, or the
 * AIRLINE's PNR off the boarding pass. They never hold Mystifly's MF reference.
 * So every booking-search surface must resolve both — and must still accept the
 * MF reference, because support pastes it out of provider tooling.
 *
 * This replays the exact `where` shapes each route uses against real rows and
 * asserts all three inputs land on the same booking. Exits non-zero on any miss.
 */
import { prisma } from '../src/lib/db';
import { resolveBookingByAnyReference } from '../src/lib/booking-lookup';

const ins = (v: string) => ({ equals: v, mode: 'insensitive' as const });
const has = (v: string) => ({ contains: v, mode: 'insensitive' as const });

/** One entry per independent booking-search query in the platform. */
const PATHS: Record<string, (q: string) => Promise<string | null>> = {
  // backend/src/lib/booking-lookup.ts — servicing (cancel / refund / reissue / void)
  'lib/booking-lookup (servicing)': async (q) => (await resolveBookingByAnyReference(q))?.bookingId ?? null,

  // src/app/api/agent/booking-workspace/lookup/route.ts
  'agent/booking-workspace/lookup': async (q) => {
    let b = await prisma.masterBooking.findFirst({ where: { masterBookingReference: ins(q) }, select: { id: true } });
    if (!b) b = await prisma.masterBooking.findFirst({ where: { airlinePnr: ins(q) }, select: { id: true } });
    if (!b) {
      const p = await prisma.bookingPnr.findFirst({ where: { OR: [{ airlinePnr: ins(q) }, { pnrCode: ins(q) }] }, select: { bookingId: true } });
      if (p) b = { id: p.bookingId };
    }
    return b?.id ?? null;
  },

  // src/app/api/agent/bookings/route.ts — list search box
  'agent/bookings (list search)': async (q) => {
    const r = await prisma.masterBooking.findFirst({
      where: { OR: [
        { masterBookingReference: has(q) }, { airlinePnr: has(q) },
        { masterPnr: has(q) }, { mystiflyMfRef: has(q) },
        { customerName: has(q) }, { customerEmail: has(q) },
      ] }, select: { id: true },
    });
    return r?.id ?? null;
  },

  // src/app/api/admin/bookings/route.ts — list search box
  'admin/bookings (list search)': async (q) => {
    const pnrs = await prisma.bookingPnr.findMany({ where: { OR: [{ airlinePnr: has(q) }, { pnrCode: has(q) }] }, select: { bookingId: true } });
    const r = await prisma.masterBooking.findFirst({
      where: { OR: [
        { masterBookingReference: has(q) }, { airlinePnr: has(q) },
        { masterPnr: has(q) }, { mystiflyMfRef: has(q) },
        { customerEmail: has(q) }, { customerName: has(q) },
        ...(pnrs.length ? [{ id: { in: pnrs.map((p) => p.bookingId) } }] : []),
      ] }, select: { id: true },
    });
    return r?.id ?? null;
  },

  // backend/src/lib/manage-booking-queries.ts — guest + AI assistant lookup
  'manage-booking/lookup (guest+AI)': async (q) => {
    let b = await prisma.masterBooking.findFirst({
      where: { OR: [{ masterBookingReference: ins(q) }, { airlinePnr: ins(q) }, { masterPnr: ins(q) }, { mystiflyMfRef: ins(q) }] },
      select: { id: true },
    });
    if (!b) {
      const p = await prisma.bookingPnr.findFirst({ where: { OR: [{ airlinePnr: ins(q) }, { pnrCode: ins(q) }] }, select: { bookingId: true } });
      if (p) b = { id: p.bookingId };
    }
    return b?.id ?? null;
  },
};

async function main() {
  const bookings = await prisma.masterBooking.findMany({
    select: {
      id: true, masterBookingReference: true, airlinePnr: true,
      mystiflyMfRef: true, masterPnr: true, primaryProvider: true,
      pnrs: { select: { airlinePnr: true, pnrCode: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`${bookings.length} bookings in the database\n`);
  let pass = 0, fail = 0, noPnr = 0;

  for (const b of bookings) {
    // Duffel has its own order flow and identifiers — out of scope here.
    if ((b.primaryProvider || '').toLowerCase() === 'duffel') continue;

    const pnr = b.airlinePnr || b.pnrs.find((p) => p.airlinePnr)?.airlinePnr;
    const mf = b.mystiflyMfRef || b.masterPnr;
    console.log(`── ${b.masterBookingReference}   airline PNR: ${pnr ?? '(none)'}   Mystifly: ${mf ?? '(none)'}`);
    if (!pnr) { console.log('   skipped — the airline has published no locator for this booking\n'); noPnr++; continue; }

    for (const [name, run] of Object.entries(PATHS)) {
      const byRef = await run(b.masterBookingReference);
      const byPnr = await run(pnr);
      const byMf = mf ? await run(mf) : b.id;   // ops fallback must keep working
      const ok = byRef === b.id && byPnr === b.id && byMf === b.id;
      const mark = (v: string | null) => (v === b.id ? 'ok' : 'MISS');
      console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ref=${mark(byRef)}  airlinePnr=${mark(byPnr)}  mystiflyRef=${mark(byMf)}`);
      ok ? pass++ : fail++;
    }
    console.log('');
  }

  console.log(`${pass} passed, ${fail} failed, ${noPnr} bookings had no airline PNR to test`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main();
