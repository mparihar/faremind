import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateTravelDnaProfile } from '@/lib/services/travel-dna-service';

/**
 * GET /api/travel-dna/me
 * Returns current user's Travel DNA profile.
 * Requires authentication via session token.
 */
export async function GET(req: NextRequest) {
  try {
    // Extract session token from Authorization header or cookie
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;

    if (!token) {
      return NextResponse.json({
        status: 'NOT_LOGGED_IN',
        message: 'Sign in to unlock your Travel DNA.',
      }, { status: 401 });
    }

    // Look up session
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (!session || !session.user || new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({
        status: 'NOT_LOGGED_IN',
        message: 'Sign in to unlock your Travel DNA.',
      }, { status: 401 });
    }

    const profile = await generateTravelDnaProfile(session.user.id);
    return NextResponse.json(profile);
  } catch (err: any) {
    console.error('[travel-dna/me] error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
