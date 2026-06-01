import prisma from './src/lib/db';
import * as duffelClient from './src/services/duffel';



async function main() {
  const b = await prisma.masterBooking.findFirst({
    where: { masterBookingReference: 'FMDWNR4S' },
    include: { pnrs: true }
  });
  
  if (!b) {
    console.log("Booking not found");
    return;
  }
  
  const providerPnr = b.pnrs.find(p => p.providerOrderId);
  console.log("Provider Order ID:", providerPnr?.providerOrderId);
  
  if (providerPnr?.providerOrderId) {
    const order = await duffelClient.getOrder(providerPnr.providerOrderId);
    console.log("--- Duffel Order ---");
    console.log(JSON.stringify(order, null, 2));
  }
}

main().finally(() => prisma.$disconnect());
