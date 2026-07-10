import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';

/**
 * GET /api/admin/providers/health
 * Returns the configuration/health status of all flight providers.
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    // Check Duffel
    const duffelToken = process.env.DUFFEL_API_TOKEN || '';
    const duffelConfigured = duffelToken.length > 0 && !duffelToken.includes('your_token');

    // Check Amadeus
    const amadeusId = process.env.AMADEUS_CLIENT_ID || '';
    const amadeusSecret = process.env.AMADEUS_CLIENT_SECRET || '';
    const amadeusConfigured = amadeusId.length > 0 && !amadeusId.includes('your_') && amadeusSecret.length > 0;

    // Check Mystifly
    const mystiflySession = process.env.MYSTIFLY_SESSION_ID || '';
    const mystiflyUser = process.env.MYSTIFLY_USERNAME || '';
    const mystiflyPass = process.env.MYSTIFLY_PASSWORD || '';
    const mystiflyAcct = process.env.MYSTIFLY_ACCOUNT_NUMBER || '';
    const mystiflyConfigured = mystiflySession.length > 0 || (mystiflyUser.length > 0 && mystiflyPass.length > 0 && mystiflyAcct.length > 0);

    return NextResponse.json({
      duffel: {
        configured: duffelConfigured,
        type: 'NDC',
        description: 'Direct airline connections via Duffel API',
      },
      amadeus: {
        configured: amadeusConfigured,
        type: 'GDS',
        description: 'Global Distribution System — Future',
      },
      mystifly: {
        configured: mystiflyConfigured,
        type: 'GDS_AGGREGATOR',
        description: 'GDS Aggregator via MyFareBox OnePoint API',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to check provider health' }, { status: 500 });
  }
}, 'SUPPORT');
