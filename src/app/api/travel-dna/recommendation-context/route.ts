import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getTravelDnaForRecommendation } from '@/lib/services/travel-dna-service';

/**
 * GET /api/travel-dna/recommendation-context?tripCategory=INTERNATIONAL
 * Returns Travel DNA preferences formatted for AI scoring integration.
 * Used internally by the search/ranking pipeline.
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '') || req.cookies.get('faremind_session')?.value;

    if (!token) {
      return NextResponse.json({ active: false, preferences: {} });
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: { select: { id: true } } },
    });

    if (!session || !session.user || new Date(session.expiresAt) < new Date()) {
      return NextResponse.json({ active: false, preferences: {} });
    }

    const tripCategory = (req.nextUrl.searchParams.get('tripCategory') || 'INTERNATIONAL') as 'DOMESTIC' | 'INTERNATIONAL';
    const context = await getTravelDnaForRecommendation(session.user.id, tripCategory);

    return NextResponse.json(context);
  } catch (err: any) {
    console.error('[travel-dna/recommendation-context] error:', err);
    return NextResponse.json({ active: false, preferences: {} });
  }
}
