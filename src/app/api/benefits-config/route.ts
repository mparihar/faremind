import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * GET /api/benefits-config
 * Returns the user-facing benefits configuration.
 * Public endpoint — reads from SystemConfig key "user_benefits".
 *
 * Default benefits (if not configured):
 *  - Travel Credits: $120 Available
 *  - Loyalty Points: 1,250 Points
 *  - Member Since: (dynamic, from user profile)
 */
const DEFAULT_BENEFITS = [
  { label: 'Travel Credits', value: '$120 Available', icon: 'CreditCard', enabled: true },
  { label: 'Loyalty Points', value: '1,250 Points', icon: 'Gift', enabled: true },
  { label: 'Member Since', value: '__MEMBER_SINCE__', icon: 'Calendar', enabled: true },
];

export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'user_benefits' },
    });

    if (config?.value) {
      try {
        const parsed = JSON.parse(config.value);
        return NextResponse.json({ benefits: parsed });
      } catch {
        // malformed JSON, return defaults
      }
    }

    return NextResponse.json({ benefits: DEFAULT_BENEFITS });
  } catch (err: any) {
    console.error('[GET /api/benefits-config]', err);
    return NextResponse.json({ benefits: DEFAULT_BENEFITS });
  }
}
