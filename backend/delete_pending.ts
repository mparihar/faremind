import { PrismaClient } from '../src/generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({
  connectionString: 'postgresql://postgres:bvlZtqcimfEoxvnUVKLkXuyLWyXUdcCK@metro.proxy.rlwy.net:21302/railway',
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const now = new Date();

  const auditFixed = await prisma.changeRequest.updateMany({
    where: { type: { not: 'DATE_CHANGE' }, status: 'NEW' },
    data: { status: 'CONFIRMED', confirmedAt: now },
  });
  console.log(`✅ ${auditFixed.count} audit-trail records → CONFIRMED`);

  const changesFixed = await prisma.changeRequest.updateMany({
    where: { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } },
    data: { status: 'CANCELLED' },
  });
  console.log(`✅ ${changesFixed.count} stale change requests → CANCELLED`);

  const cancelsFixed = await prisma.cancellationRecord.updateMany({
    where: { status: { in: ['CANCEL_REQUESTED', 'IN_PROGRESS'] } },
    data: { status: 'CANCELLED', cancelledAt: now },
  });
  console.log(`✅ ${cancelsFixed.count} stale cancellations → CANCELLED`);

  const rc = await prisma.changeRequest.count({ where: { status: { in: ['NEW', 'QUOTED', 'CUSTOMER_PAYMENT_PENDING'] } } });
  const rn = await prisma.cancellationRecord.count({ where: { status: { in: ['CANCEL_REQUESTED', 'IN_PROGRESS'] } } });
  console.log(`\n📊 Pending Work now: ${rc + rn} (${rc} changes + ${rn} cancellations)`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
