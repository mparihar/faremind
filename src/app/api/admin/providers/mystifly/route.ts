import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';

/**
 * GET /api/admin/providers/mystifly
 * Returns the Mystifly configuration (sensitive values masked).
 */
export const GET = withAdmin(async (req: NextRequest) => {
  try {
    const apiUrl = process.env.MYSTIFLY_API_URL || 'https://restapidemo.myfarebox.com';
    const username = process.env.MYSTIFLY_USERNAME || '';
    const accountNumber = process.env.MYSTIFLY_ACCOUNT_NUMBER || '';
    const sessionId = process.env.MYSTIFLY_SESSION_ID || '';
    const password = process.env.MYSTIFLY_PASSWORD || '';
    const target = process.env.MYSTIFLY_TARGET || 'Test';
    const providerMode = process.env.FLIGHT_PROVIDER_MODE || 'BOTH';

    const isConfigured =
      sessionId.length > 0 ||
      (username.length > 0 && password.length > 0 && accountNumber.length > 0);

    return NextResponse.json({
      apiUrl,
      username: username || '(not set)',
      accountNumber: accountNumber || '(not set)',
      sessionIdPresent: sessionId.length > 0,
      passwordPresent: password.length > 0,
      target,
      providerMode,
      isConfigured,
      searchVersion: 'v2.2 (default, configurable per-route)',
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}, 'OPS_ADMIN');
