import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/db';

const COOKIE_NAME = 'admin_token';
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
    ?? req.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyAdminToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  // ── Server-side inactivity check ─────────────────────────────────────────
  const session = await prisma.adminSession.findUnique({
    where: { id: payload.sessionId },
  });

  if (!session || session.expiresAt < new Date()) {
    // Session expired or doesn't exist — clear cookie
    const res = NextResponse.json({ error: 'Session expired' }, { status: 401 });
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return res;
  }

  const lastActivity = session.lastActivityAt?.getTime() ?? session.createdAt.getTime();
  if (Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
    // Inactive too long — revoke session + clear cookie
    await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => {});
    const res = NextResponse.json(
      { error: 'Session expired due to inactivity', reason: 'inactivity' },
      { status: 401 },
    );
    res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' });
    return res;
  }

  // ── Sliding window: touch lastActivityAt ─────────────────────────────────
  await prisma.adminSession.update({
    where: { id: session.id },
    data: { lastActivityAt: new Date() },
  });

  // ── Return admin user ────────────────────────────────────────────────────
  const admin = await prisma.adminUser.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true },
  });

  if (!admin || !admin.isActive) {
    return NextResponse.json({ error: 'Account inactive' }, { status: 401 });
  }

  return NextResponse.json({ user: admin });
}
