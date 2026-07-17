import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createOtp } from '@/lib/admin-auth';
import { sendAdminOtp } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body?.email ?? '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const admin = await prisma.adminUser.findUnique({ where: { email } });

    if (!admin || !admin.isActive) {
      return NextResponse.json({ success: true, message: 'If this email is registered, a new OTP has been sent.' });
    }

    // Rate limit: max 3 per minute
    const recentCount = await prisma.adminOtp.count({
      where: {
        adminUserId: admin.id,
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
    });

    if (recentCount >= 3) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before resending.' },
        { status: 429 }
      );
    }

    const otp = await createOtp(admin.id);

    try {
      await sendAdminOtp(admin.email, admin.fullName, otp);
    } catch (emailErr) {
      console.error('[resend-otp] Email delivery failed:', emailErr);
      if (process.env.NODE_ENV !== 'production') {
      }
    }

    return NextResponse.json({ success: true, message: 'New OTP sent' });

  } catch (err) {
    console.error('[resend-otp] Unexpected error:', err);
    return NextResponse.json({ error: 'An error occurred. Please try again.' }, { status: 500 });
  }
}
