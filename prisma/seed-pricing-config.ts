/**
 * Seed script: Populate FareTierTemplate + SystemConfig entries
 * Run with: npx tsx prisma/seed-pricing-config.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const FARE_TIERS = [
  { name: 'Economy Basic',           cabin: 'economy',          priceMultiplier: 1.0,   displayOrder: 1,  carryOn: true, carryOnPieces: 1, carryOnWeightKg: 7,    checkedBags: 0, checkedWeightKg: null, extraBagFeeUsd: 35,   refundable: false, refundFeeUsd: null, changeable: false, changeFeeUsd: null, seatSelection: 'fee', seatSelectionFeeUsd: 15, upgradeable: false, loungeAccess: false, priorityBoarding: false, milesEarning: 'reduced' },
  { name: 'Economy Standard',        cabin: 'economy',          priceMultiplier: 1.18,  displayOrder: 2,  carryOn: true, carryOnPieces: 1, carryOnWeightKg: 10,   checkedBags: 1, checkedWeightKg: 23,   extraBagFeeUsd: 35,   refundable: false, refundFeeUsd: null, changeable: true,  changeFeeUsd: 50,   seatSelection: 'fee', seatSelectionFeeUsd: 10, upgradeable: true,  loungeAccess: false, priorityBoarding: false, milesEarning: 'full' },
  { name: 'Economy Flex',            cabin: 'economy',          priceMultiplier: 1.38,  displayOrder: 3,  carryOn: true, carryOnPieces: 1, carryOnWeightKg: 10,   checkedBags: 1, checkedWeightKg: 23,   extraBagFeeUsd: 35,   refundable: true,  refundFeeUsd: 0,    changeable: true,  changeFeeUsd: 0,    seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true,  loungeAccess: false, priorityBoarding: true,  milesEarning: 'full' },
  { name: 'Premium Economy Classic', cabin: 'premium_economy',  priceMultiplier: 2.1,   displayOrder: 4,  carryOn: true, carryOnPieces: 2, carryOnWeightKg: 12,   checkedBags: 2, checkedWeightKg: 23,   extraBagFeeUsd: 50,   refundable: false, refundFeeUsd: null, changeable: true,  changeFeeUsd: 75,   seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true,  loungeAccess: false, priorityBoarding: true,  milesEarning: 'full' },
  { name: 'Premium Economy Flex',    cabin: 'premium_economy',  priceMultiplier: 2.55,  displayOrder: 5,  carryOn: true, carryOnPieces: 2, carryOnWeightKg: 12,   checkedBags: 2, checkedWeightKg: 32,   extraBagFeeUsd: 50,   refundable: true,  refundFeeUsd: 0,    changeable: true,  changeFeeUsd: 0,    seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true,  loungeAccess: true,  priorityBoarding: true,  milesEarning: 'full' },
  { name: 'Business Classic',        cabin: 'business',         priceMultiplier: 4.2,   displayOrder: 6,  carryOn: true, carryOnPieces: 2, carryOnWeightKg: 18,   checkedBags: 2, checkedWeightKg: 32,   extraBagFeeUsd: null, refundable: true,  refundFeeUsd: 0,    changeable: true,  changeFeeUsd: 0,    seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true,  loungeAccess: true,  priorityBoarding: true,  milesEarning: 'full' },
  { name: 'Business Extra',          cabin: 'business',         priceMultiplier: 5.0,   displayOrder: 7,  carryOn: true, carryOnPieces: 2, carryOnWeightKg: 18,   checkedBags: 3, checkedWeightKg: 32,   extraBagFeeUsd: null, refundable: true,  refundFeeUsd: 0,    changeable: true,  changeFeeUsd: 0,    seatSelection: 'free', seatSelectionFeeUsd: null, upgradeable: true,  loungeAccess: true,  priorityBoarding: true,  milesEarning: 'full' },
];

const SYSTEM_CONFIGS = [
  { key: 'tax_rate',           value: '0.156',  description: 'Tax rate applied to base fare (15.6% = 0.156)' },
  // extra_bag_fee_usd removed — live pricing from provider only
];

async function main() {
  console.log('🌱 Seeding fare tier templates...');

  // Check if any fare tiers already exist
  const existingTiers = await prisma.fareTierTemplate.count();
  if (existingTiers > 0) {
    console.log(`   ⏭ ${existingTiers} fare tier templates already exist — skipping.`);
  } else {
    for (const tier of FARE_TIERS) {
      await prisma.fareTierTemplate.create({ data: tier });
      console.log(`   ✅ Created: ${tier.name} (${tier.cabin} × ${tier.priceMultiplier})`);
    }
  }

  console.log('\n🌱 Seeding system configs...');
  for (const config of SYSTEM_CONFIGS) {
    const existing = await prisma.systemConfig.findUnique({ where: { key: config.key } });
    if (existing) {
      console.log(`   ⏭ "${config.key}" already exists (value: ${existing.value}) — skipping.`);
    } else {
      await prisma.systemConfig.create({ data: config });
      console.log(`   ✅ Created: "${config.key}" = ${config.value}`);
    }
  }

  console.log('\n✅ Done!');
}

main()
  .catch(e => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
