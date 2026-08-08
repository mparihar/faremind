/**
 * The agent commission split, read and set by an admin.
 *
 * Changing these affects NEW bookings only. Every booking already made carries
 * the rate it was booked at, both on the booking row and on its ledger entry —
 * so moving the split from 50% to 40% does not restate what agents have already
 * earned, and a payout statement from last quarter still reconciles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { prisma } from '@/lib/db';
import { auditLog } from '@/lib/admin-auth';
import {
  AGENT_SERVICE_FEE_RATE_KEY, AGENT_ANCILLARY_RATE_KEY,
  DEFAULT_COMMISSION_RATES, getCommissionRates, invalidateCommissionRates,
} from '@/lib/finance/commission-config';

export const GET = withAdmin(async () => {
  const rates = await getCommissionRates();
  return NextResponse.json({
    ...rates,
    defaults: DEFAULT_COMMISSION_RATES,
    appliesTo: 'New bookings only — existing bookings keep the rate they were booked at.',
  });
}, 'FINANCE');

export const PUT = withAdmin(async (req: NextRequest, { admin }) => {
  const body = await req.json().catch(() => ({}));

  const parse = (v: unknown, name: string): number | { error: string } => {
    const n = Number(v);
    // Rejected rather than clamped: silently turning 150 into 100 hides a typo
    // that would otherwise be caught the moment it is entered.
    if (!Number.isFinite(n)) return { error: `${name} must be a number.` };
    if (n < 0 || n > 100) return { error: `${name} must be between 0 and 100.` };
    return Math.round(n * 100) / 100;
  };

  const serviceFeeRate = parse(body.serviceFeeRate, 'Service fee commission');
  if (typeof serviceFeeRate === 'object') return NextResponse.json(serviceFeeRate, { status: 400 });
  const ancillaryRate = parse(body.ancillaryRate, 'Ancillary commission');
  if (typeof ancillaryRate === 'object') return NextResponse.json(ancillaryRate, { status: 400 });

  const write = (key: string, value: number, description: string) =>
    prisma.systemConfig.upsert({
      where: { key },
      create: { key, value: String(value), description, updatedBy: admin?.email ?? null },
      update: { value: String(value), updatedBy: admin?.email ?? null },
    });

  await Promise.all([
    write(AGENT_SERVICE_FEE_RATE_KEY, serviceFeeRate,
      'Percent of the FareMind service/platform fee shared with the booking agent. New bookings only.'),
    write(AGENT_ANCILLARY_RATE_KEY, ancillaryRate,
      'Percent of FareMind ancillary/upsell commission shared with the booking agent. New bookings only.'),
  ]);

  // The reader caches for a minute; an admin who just saved should not have to
  // wait to see it take effect.
  invalidateCommissionRates();

  await auditLog({
    adminUserId: admin?.sub, action: 'UPDATE', entityType: 'SystemConfig',
    entityId: 'agent_commission_rates',
    after: { serviceFeeRate, ancillaryRate },
    metadata: { note: 'Applies to new bookings only; existing bookings keep their booked rate.' },
  }).catch(() => {});

  return NextResponse.json({ serviceFeeRate, ancillaryRate });
}, 'FINANCE');
