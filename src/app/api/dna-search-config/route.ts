import { NextResponse } from 'next/server';
import { getTravelDnaConfig } from '@/lib/services/travel-dna-service';

/**
 * GET /api/dna-search-config
 * Public endpoint that returns the DNA search topN config value.
 * Used by the frontend to display the correct flight count in the progress banner.
 */
export async function GET() {
  try {
    const config = await getTravelDnaConfig();
    return NextResponse.json({ dnaSearchTopN: config.dnaSearchTopN ?? 30 });
  } catch {
    return NextResponse.json({ dnaSearchTopN: 30 });
  }
}
