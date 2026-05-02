import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken } from '@/lib/admin-auth';
import { prisma } from '@/lib/db';

const COOKIE_NAME = 'admin_token';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
    ?? req.headers.get('authorization')?.replace('Bearer ', '');

  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await verifyAdminToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

  const admin = await prisma.adminUser.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, fullName: true, role: true, isActive: true, lastLoginAt: true },
  });

  if (!admin || !admin.isActive) {
    return NextResponse.json({ error: 'Account inactive' }, { status: 401 });
  }

  return NextResponse.json({ user: admin });
}
