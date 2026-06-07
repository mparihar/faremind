const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const pnr = await prisma.bookingPnr.findFirst({
    where: { pnrCode: '4QQNMZ' }
  });
  console.log(JSON.stringify(pnr, null, 2));
}
main().finally(() => prisma.$disconnect());
