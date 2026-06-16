import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const DEFAULT_AI_RECOMMENDATION_LIMIT = 25;

/**
 * GET /api/config/ai-recommendation-limit
 * Returns the configured number of flight cards that show
 * the "Why FAREMIND AI recommends this" section.
 * Public endpoint — no authentication required.
 */
export async function GET() {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'ai_recommendation_card_limit' },
    });

    const limit = config ? parseInt(config.value, 10) : DEFAULT_AI_RECOMMENDATION_LIMIT;
    const validLimit = isNaN(limit) || limit < 0 || limit > 500
      ? DEFAULT_AI_RECOMMENDATION_LIMIT
      : limit;

    return NextResponse.json({ limit: validLimit });
  } catch (err: any) {
    console.error('[config/ai-recommendation-limit] Error reading config:', err.message);
    return NextResponse.json({ limit: DEFAULT_AI_RECOMMENDATION_LIMIT });
  }
}
