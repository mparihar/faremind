import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

/**
 * Check if a user email has admin access.
 * Returns { isAdmin: true/false, role: 'super_admin'|'admin'|null }
 */
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');
    if (!email) {
      return NextResponse.json({ isAdmin: false, role: null }, { status: 200 });
    }

    const res = await fetch(`${BACKEND_URL}/api/admin/notification-recipients`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    const recipients = data.recipients || [];

    const match = recipients.find(
      (r: any) => r.email.toLowerCase() === email.toLowerCase() && r.isActive
    );

    if (match && (match.role === 'super_admin' || match.role === 'admin')) {
      return NextResponse.json({ isAdmin: true, role: match.role });
    }

    return NextResponse.json({ isAdmin: false, role: null });
  } catch (err) {
    console.error('[api/admin/check-access] Failed:', err);
    return NextResponse.json({ isAdmin: false, role: null });
  }
}
