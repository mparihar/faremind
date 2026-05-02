import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const { searchParams } = new URL(req.url);
  const res = await fetch(`${backendUrl}/api/flexible-search?${searchParams.toString()}`);
  if (!res.ok) return NextResponse.json({ error: 'Failed to fetch flexible prices' }, { status: 502 });
  const data = await res.json();
  return NextResponse.json(data);
}
