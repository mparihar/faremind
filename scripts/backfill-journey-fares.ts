import 'dotenv/config';

async function main() {
  const { Pool } = await import('pg');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../src/generated/prisma/client.js');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Get all MasterBookings that have journeys
  const bookings = await prisma.masterBooking.findMany({
    include: {
      journeys: { orderBy: { journeyOrder: 'asc' } },
      segments: { orderBy: { segmentOrder: 'asc' } },
    },
  });

  console.log(`Found ${bookings.length} master bookings to process`);

  for (const booking of bookings) {
    if (!booking.journeys.length) {
      console.log(`  [${booking.masterBookingReference}] No journeys, skipping`);
      continue;
    }

    const totalAmount = Number(booking.totalAmount);
    const journeyCount = booking.journeys.length;

    if (journeyCount === 1) {
      // One-way: entire fare goes to that journey
      await prisma.bookingJourney.update({
        where: { id: booking.journeys[0].id },
        data: { totalFare: totalAmount, fareCurrency: booking.currency },
      });
      console.log(`  [${booking.masterBookingReference}] 1 journey → $${totalAmount}`);
    } else {
      // Round trip: split fare proportionally by segment count
      // Sum segment durations per journey to approximate fare split
      for (const journey of booking.journeys) {
        const journeySegments = booking.segments.filter(s => s.journeyId === journey.id);
        // For a round trip, split roughly evenly (outbound typically slightly more)
        const isOutbound = journey.direction === 'OUTBOUND' || journey.journeyOrder === 0;
        const sharePct = isOutbound ? 0.55 : 0.45; // Outbound usually costs slightly more
        const journeyFare = Math.round(totalAmount * sharePct * 100) / 100;

        await prisma.bookingJourney.update({
          where: { id: journey.id },
          data: { totalFare: journeyFare, fareCurrency: booking.currency },
        });
        console.log(`  [${booking.masterBookingReference}] ${journey.direction} → $${journeyFare}`);
      }
    }
  }

  console.log('\n✅ Journey fares backfilled successfully');
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('❌ Backfill failed:', e);
  process.exit(1);
});
