import { NextRequest, NextResponse } from 'next/server';
import { getSearchHistory } from '@/lib/db-queries';

/**
 * GET /api/search-history?userId=xxx
 *
 * Returns recent search history for a user.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const limit = parseInt(searchParams.get('limit') || '20');

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const history = await getSearchHistory(userId, Math.min(limit, 50));
    return NextResponse.json({ history });
  } catch (error) {
    console.error('[SearchHistory] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch search history' },
      { status: 500 }
    );
  }
}
