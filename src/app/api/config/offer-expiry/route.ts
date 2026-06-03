import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const DEFAULT_OFFER_EXPIRY_MINUTES = 20;

/**
 * GET /api/config/offer-expiry
 * Returns the configured offer expiry duration in minutes.
 * This is a public endpoint — no authentication required.
 * The frontend uses this to set the fallback timer for the checkout countdown.
 */
export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'offer_expiry_minutes' },
    });

    const minutes = config ? parseInt(config.value, 10) : DEFAULT_OFFER_EXPIRY_MINUTES;
    const validMinutes = isNaN(minutes) || minutes < 5 || minutes > 60
      ? DEFAULT_OFFER_EXPIRY_MINUTES
      : minutes;

    return NextResponse.json({ minutes: validMinutes });
  } catch (err: any) {
    console.error('[config/offer-expiry] Error reading config:', err.message);
    // Fallback to default if DB is unavailable
    return NextResponse.json({ minutes: DEFAULT_OFFER_EXPIRY_MINUTES });
  }
}
