import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createOtp } from '@/lib/admin-auth';
import { sendAdminOtp } from '@/lib/email';
import { verifyTurnstile, isTurnstileEnabled, TURNSTILE_FAILED_RESPONSE } from '@/lib/turnstile';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = (body?.email ?? '').trim().toLowerCase();
    const captchaToken = body?.captchaToken;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // Verify Cloudflare Turnstile before proceeding (skipped when TURNSTILE_ENABLED !== "true")
    if (isTurnstileEnabled()) {
      const turnstileValid = await verifyTurnstile(captchaToken);
      if (!turnstileValid) {
        return NextResponse.json(TURNSTILE_FAILED_RESPONSE, { status: 400 });
      }
    }

    // Step 1 – find admin
    let admin;
    try {
      admin = await prisma.adminUser.findUnique({ where: { email } });
    } catch (dbErr) {
      const m = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.error('[send-otp] DB findUnique failed:', m);
      return NextResponse.json({ error: `DB error: ${m}` }, { status: 500 });
    }

    // Always return success to avoid email enumeration
    if (!admin || !admin.isActive) {
      return NextResponse.json({ success: true, message: 'If this email is registered, an OTP has been sent.' });
    }

    // Step 2 – rate limit
    let recentCount = 0;
    try {
      recentCount = await prisma.adminOtp.count({
        where: {
          adminUserId: admin.id,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
    } catch (rcErr) {
      const m = rcErr instanceof Error ? rcErr.message : String(rcErr);
      console.error('[send-otp] adminOtp.count failed:', m);
      return NextResponse.json({ error: `OTP count error: ${m}` }, { status: 500 });
    }

    if (recentCount >= 3) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a minute before retrying.' },
        { status: 429 }
      );
    }

    // Step 3 – create OTP
    let otp: string;
    try {
      otp = await createOtp(admin.id);
    } catch (otpErr) {
      const m = otpErr instanceof Error ? otpErr.message : String(otpErr);
      console.error('[send-otp] createOtp failed:', m);
      return NextResponse.json({ error: `OTP create error: ${m}` }, { status: 500 });
    }

    // Step 4 – send email (non-blocking failure)
    try {
      await sendAdminOtp(admin.email, admin.fullName, otp);
    } catch (emailErr) {
      const m = emailErr instanceof Error ? emailErr.message : String(emailErr);
      console.error('[send-otp] Email delivery failed:', m);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`\n[DEV OTP] ✉️  ${admin.email} → ${otp}\n`);
      }
    }

    return NextResponse.json({ success: true, message: 'OTP sent successfully' });

  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    console.error('[send-otp] Unhandled error:', m);
    return NextResponse.json({ error: `Unexpected error: ${m}` }, { status: 500 });
  }
}
