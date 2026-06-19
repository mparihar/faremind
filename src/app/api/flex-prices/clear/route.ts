import { NextResponse } from 'next/server';
import { flexCacheClearAll } from '@/lib/flex-search-cache';

/**
 * POST /api/flex-prices/clear
 * Clears all flex-date cached prices.
 * Called when the user navigates back to the home page (hero)
 * so that the next search gets fresh prices.
 */
export async function POST() {
  flexCacheClearAll();
  return NextResponse.json({ cleared: true });
}
