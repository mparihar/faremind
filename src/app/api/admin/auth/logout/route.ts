import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, revokeAdminSession } from '@/lib/admin-auth';

const COOKIE_NAME = 'admin_token';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
    ?? req.headers.get('authorization')?.replace('Bearer ', '');

  if (token) {
    const payload = await verifyAdminToken(token);
    if (payload?.sessionId) {
      await revokeAdminSession(payload.sessionId);
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
  return res;
}
