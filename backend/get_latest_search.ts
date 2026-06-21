import { prisma } from './src/lib/db';

async function main() {
  const latestSearch = await prisma.searchHistory.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  console.log("Latest Search:", latestSearch);
  
  const latestBooking = await prisma.booking.findFirst({
    orderBy: { createdAt: 'desc' }
  });
  console.log("Latest Booking:", latestBooking);
}

main().catch(console.error).finally(() => prisma.$disconnect());
