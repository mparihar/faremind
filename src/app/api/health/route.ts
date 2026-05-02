import { NextResponse } from 'next/server';
import { getProviderStatus } from '@/lib/providers/orchestrator';
import prisma from '@/lib/db';

/**
 * GET /api/health
 *
 * Platform health check:
 * - Database connectivity
 * - Provider configuration status
 * - Record counts
 */
export async function GET() {
  const providerStatus = getProviderStatus();
  let dbConnected = false;
  let dbCounts: Record<string, number> = {};

  try {
    // Test DB connectivity
    const userCount = await prisma.user.count();
    const bookingCount = await prisma.booking.count();
    const airlineCount = await prisma.airline.count();
    const airportCount = await prisma.airport.count();
    const alertCount = await prisma.priceAlert.count();

    dbConnected = true;
    dbCounts = {
      users: userCount,
      bookings: bookingCount,
      airlines: airlineCount,
      airports: airportCount,
      priceAlerts: alertCount,
    };
  } catch (error) {
    console.error('[Health] Database check failed:', error);
  }

  return NextResponse.json({
    status: dbConnected ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    database: {
      connected: dbConnected,
      provider: 'Railway PostgreSQL',
      counts: dbCounts,
    },
    providers: {
      duffel: {
        type: 'NDC',
        status: providerStatus.duffel.configured ? 'connected' : 'not_configured',
        description: providerStatus.duffel.description,
      },
      amadeus: {
        type: 'GDS',
        status: providerStatus.amadeus.configured ? 'connected' : 'not_configured',
        description: providerStatus.amadeus.description,
      },
    },
    features: {
      flightSearch: true,
      booking: true,
      priceTracking: true,
      cancellation: true,
      notifications: true,
      rebooking: false, // Phase 2
    },
  });
}
