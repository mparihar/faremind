import { NextResponse } from 'next/server';

export async function GET() {
  const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const res = await fetch(`${backendUrl}/api/popular-routes`, { next: { revalidate: 3600 } });
  if (!res.ok) return NextResponse.json({ error: 'Failed to fetch popular routes' }, { status: 502 });
  const data = await res.json();
  return NextResponse.json(data);
}
