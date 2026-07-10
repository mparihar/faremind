import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';

/**
 * GET /api/admin/providers/duffel
 * Returns the Duffel provider configuration (token masked).
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const token = process.env.DUFFEL_API_TOKEN || '';
    const isConfigured = token.length > 0 && !token.includes('your_token');
    const providerMode = process.env.FLIGHT_PROVIDER_MODE || 'BOTH';
    // Detect if using test or live token
    const apiMode = token.startsWith('duffel_test_') ? 'Test' : token.startsWith('duffel_live_') ? 'Production' : 'Unknown';

    return NextResponse.json({
      isConfigured,
      apiMode,
      providerMode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}, 'OPS_ADMIN');
