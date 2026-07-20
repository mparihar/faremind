import { PrismaClient } from '../src/generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const rules = await prisma.providerFareInventoryRule.findMany({
    where: { isActive: true },
    orderBy: [{ fareType: 'asc' }, { priority: 'asc' }],
    select: {
      fareType: true,
      originAirport: true,
      destinationAirport: true,
      airlineCode: true,
      ruleName: true,
      priority: true,
      target: true,
    },
  });
  console.table(rules);
}
main().catch(console.error).finally(() => prisma.$disconnect());
