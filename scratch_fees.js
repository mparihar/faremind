const { PrismaClient } = require('./src/generated/prisma');
const p = new PrismaClient();
async function main() {
  const rules = await p.platformFeeRule.findMany({
    where: { feeType: 'SERVICE_FEE', active: true, deletedAt: null },
    orderBy: { priority: 'desc' },
  });
  rules.forEach(x => console.log(JSON.stringify({
    model: x.calculationModel,
    fixed: x.fixedAmount?.toString(),
    pct: x.percentageValue?.toString(),
    provider: x.providerScope,
    cabin: x.cabinScope,
  })));
  await p.$disconnect();
}
main();
