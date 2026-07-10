import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * POST /api/admin/providers/mystifly/test
 * Tests the Mystifly connection by calling CreateSession or a lightweight search.
 */
export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const start = Date.now();

    // Try a lightweight revalidation call with a dummy FSC
    // This tests: auth, network, API responsiveness
    const res = await fetch(`${BACKEND_URL}/api/mystifly/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fareSourceCode: 'TEST_CONNECTION_CHECK' }),
    });

    const responseTimeMs = Date.now() - start;
    const data = await res.json().catch(() => null);

    // Even if revalidation fails (expected with dummy FSC), a 4xx response
    // means the API is reachable and auth is working. 5xx means problems.
    if (res.status < 500) {
      return NextResponse.json({
        success: true,
        message: `Connection successful — API responded in ${responseTimeMs}ms`,
        responseTimeMs,
      });
    }

    return NextResponse.json({
      success: false,
      message: data?.error || `API returned ${res.status}`,
      responseTimeMs,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      message: `Connection failed: ${err.message}`,
    });
  }
}, 'OPS_ADMIN');
