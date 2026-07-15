import { NextRequest, NextResponse } from 'next/server';

/**
 * Catch-all proxy for /api/booking-session/* routes.
 *
 * Forwards all requests to the backend Fastify service.
 * Handles: offer-session/start, offer-session/:id/status,
 *          offer-session/:id/expire, offer-session/:id/booked, recalculate
 */
const BACKEND_URL = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const subPath = path.join('/');
  const url = `${BACKEND_URL}/api/booking-session/${subPath}`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let body: string | undefined;

    if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
      body = await request.text();
    }

    const res = await fetch(url, {
      method: request.method,
      headers,
      body,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error(`[Proxy] booking-session/${subPath} error:`, err.message);
    return NextResponse.json({ error: 'Proxy error' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
