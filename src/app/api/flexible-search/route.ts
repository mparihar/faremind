import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120; // Allow up to 2 minutes for 12-month parallel search

export async function GET(req: NextRequest) {
  let backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  backendUrl = backendUrl.replace(/\/$/, '');
  const { searchParams } = new URL(req.url);
  const url = `${backendUrl}/api/flexible-search?${searchParams.toString()}`;

  // The flex search queries 12 months in parallel (Duffel + Mystifly) —
  // this can take 30-60s. Use a generous timeout to avoid premature close.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // @ts-expect-error -- undici-specific options to prevent socket reuse issues
      dispatcher: undefined,
      keepalive: true,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json({ error: `Backend returned ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    clearTimeout(timeout);
    console.error('[FlexSearch Proxy] Error:', err?.code || err?.name, err?.message);
    if (err?.name === 'AbortError') {
      return NextResponse.json({ error: 'Flexible search timed out' }, { status: 504 });
    }
    // Retry once on socket errors (UND_ERR_SOCKET, premature close, etc.)
    if (err?.code === 'UND_ERR_SOCKET' || err?.message?.includes('premature') || err?.message?.includes('socket')) {
      console.log('[FlexSearch Proxy] Retrying after socket error...');
      try {
        const retryController = new AbortController();
        const retryTimeout = setTimeout(() => retryController.abort(), 120_000);
        const res2 = await fetch(url, { signal: retryController.signal });
        clearTimeout(retryTimeout);
        if (!res2.ok) {
          return NextResponse.json({ error: `Backend returned ${res2.status} on retry` }, { status: 502 });
        }
        const data2 = await res2.json();
        return NextResponse.json(data2);
      } catch (retryErr: any) {
        console.error('[FlexSearch Proxy] Retry also failed:', retryErr?.message);
      }
    }
    return NextResponse.json({ error: 'Failed to fetch flexible prices' }, { status: 502 });
  }
}
