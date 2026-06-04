import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { submitPreferenceFeedback } from '@/lib/services/travel-dna-service';

/**
 * POST /api/travel-dna/feedback
 * Allows user to validate or reject a learned preference.
 * Body: { preferenceId: string, action: 'accurate' | 'not_me' }
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { id: true } } },
    });

    if (!session || !session.user || new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { preferenceId, action } = body;

    if (!preferenceId || !['accurate', 'not_me'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid request. Required: preferenceId and action (accurate | not_me)' },
        { status: 400 },
      );
    }

    const success = await submitPreferenceFeedback(session.user.id, preferenceId, action);
    if (!success) {
      return NextResponse.json({ error: 'Preference not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, action });
  } catch (err: any) {
    console.error('[travel-dna/feedback] error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
