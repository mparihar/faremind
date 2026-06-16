require('dotenv').config();
const { PrismaClient } = require('./src/generated/prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const bookings = await prisma.booking.findMany({
    include: { passengers: true }
  });
  console.log(JSON.stringify(bookings.map(x => ({
    id: x.id,
    pnr: x.pnr,
    email: x.passengers[0]?.email,
    status: x.status
  })), null, 2));
}

main().finally(() => prisma.$disconnect());
