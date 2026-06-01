/**
 * Seed default commercial fee rules
 * Run: npx tsx prisma/seed-commercial.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding commercial fee rules...');

  // 1. Default Service Fee: $10 per traveler
  const existingServiceFee = await prisma.platformFeeRule.findFirst({
    where: { feeType: 'SERVICE_FEE', deletedAt: null },
  });

  if (!existingServiceFee) {
    await prisma.platformFeeRule.create({
      data: {
        feeType: 'SERVICE_FEE',
        feeName: 'Default Service Fee',
        feeDescription: 'Standard service fee applied to all bookings',
        calculationModel: 'FIXED_PER_TRAVELER',
        fixedAmount: 10.00,
        currency: 'USD',
        appliesToAdult: true,
        appliesToChild: true,
        appliesToInfant: true,
        providerScope: 'ALL',
        cabinScope: 'ALL',
        tripTypeScope: 'ALL',
        routeScopeType: 'ALL',
        active: true,
        priority: 1,
        createdByAdminEmail: 'system@faremind.com',
      },
    });
    console.log('  ✓ Created default SERVICE_FEE rule ($10/traveler)');
  } else {
    console.log('  → SERVICE_FEE rule already exists, skipping');
  }

  // 2. Default Price Drop Protection: 6% of fare, $49-$399 bounds
  const existingProtection = await prisma.protectionProductRule.findFirst({
    where: { productType: 'PRICE_DROP_PROTECTION', deletedAt: null },
  });

  if (!existingProtection) {
    await prisma.protectionProductRule.create({
      data: {
        productType: 'PRICE_DROP_PROTECTION',
        productName: 'Price Drop Protection',
        productDescription: 'Get up to 80% refund if the price drops within 24 hours of booking',
        pricingModel: 'PERCENTAGE_OF_FARE',
        percentageValue: 6.0000,
        currency: 'USD',
        cabinScope: 'ALL',
        tripTypeScope: 'ALL',
        routeScopeType: 'ALL',
        appliesToAdult: true,
        appliesToChild: true,
        appliesToInfant: true,
        coverageSummary: '80% refund of price difference if fare drops within 24h. Minimum protection fee $49, maximum $399.',
        active: true,
        priority: 1,
        createdByAdminEmail: 'system@faremind.com',
      },
    });
    console.log('  ✓ Created default PRICE_DROP_PROTECTION rule (6% of fare)');
  } else {
    console.log('  → PRICE_DROP_PROTECTION rule already exists, skipping');
  }

  // 3. Default Travel Insurance: 4% of booking total
  const existingInsurance = await prisma.travelInsuranceRule.findFirst({
    where: { deletedAt: null },
  });

  if (!existingInsurance) {
    await prisma.travelInsuranceRule.create({
      data: {
        insuranceProviderName: 'FareMind Travel Cover',
        planName: 'Basic Travel Insurance',
        planDescription: 'Comprehensive travel insurance covering medical, cancellation, and baggage',
        pricingModel: 'PERCENTAGE_OF_BOOKING_TOTAL',
        percentageValue: 4.0000,
        currency: 'USD',
        cabinScope: 'ALL',
        tripTypeScope: 'ALL',
        routeScopeType: 'ALL',
        medicalCoverageAmount: 50000,
        cancellationCoverageAmount: 5000,
        baggageCoverageAmount: 2000,
        coverageSummary: 'Medical: $50,000 | Cancellation: $5,000 | Baggage: $2,000',
        active: true,
        priority: 1,
        createdByAdminEmail: 'system@faremind.com',
      },
    });
    console.log('  ✓ Created default TRAVEL_INSURANCE rule (4% of total)');
  } else {
    console.log('  → TRAVEL_INSURANCE rule already exists, skipping');
  }

  console.log('Done!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
