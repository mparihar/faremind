import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyOtp, createAdminSession, auditLog } from '@/lib/admin-auth';

const COOKIE_NAME = 'admin_token';
const COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds

export async function POST(req: NextRequest) {
  const { email, otp } = await req.json();

  if (!email || !otp) {
    return NextResponse.json({ error: 'Email and OTP are required' }, { status: 400 });
  }

  const admin = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  if (!admin || !admin.isActive) {
    return NextResponse.json({ error: 'Invalid OTP' }, { status: 401 });
  }

  const valid = await verifyOtp(admin.id, otp);
  if (!valid) {
    // Check remaining attempts
    const latest = await prisma.adminOtp.findFirst({
      where: { adminUserId: admin.id, used: false, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (latest && latest.attempts >= 5) {
      return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new OTP.' }, { status: 401 });
    }

    return NextResponse.json({ error: 'Invalid or expired OTP' }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for') ?? undefined;
  const ua = req.headers.get('user-agent') ?? undefined;
  const token = await createAdminSession(admin.id, ip, ua);

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
  });

  await auditLog({
    adminUserId: admin.id,
    action: 'LOGIN_OTP',
    entityType: 'AdminUser',
    entityId: admin.id,
    ipAddress: ip,
    userAgent: ua,
  });

  const user = { id: admin.id, email: admin.email, fullName: admin.fullName, role: admin.role };
  const res = NextResponse.json({ success: true, user });

  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });

  return res;
}
