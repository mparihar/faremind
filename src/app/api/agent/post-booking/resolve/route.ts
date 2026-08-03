// FILE: src/app/api/agent/post-booking/resolve/route.ts
// Find the booking an agent wants to service, from the FareMind reference or the
// airline PNR. Returns a display-safe summary — never the Mystifly reference,
// which the console no longer handles at all.
//
// Behind agent auth because an airline PNR is six characters: an open endpoint
// here would let anyone walk the space and read back passenger counts, routes
// and travel dates.
import { NextRequest, NextResponse } from 'next/server';
import { withAgentServicing } from '@/lib/agent-auth';
import { resolveServicingTarget } from '@/lib/resolve-booking';

export const POST = withAgentServicing(async (req: NextRequest) => {
  try {
    const { reference, airlinePnr } = await req.json().catch(() => ({}));
    const result = await resolveServicingTarget({ reference, airlinePnr });
    if (!result.found) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ booking: result.target });
  } catch (err: any) {
    console.error('[Agent][PostBooking][Resolve]', err);
    return NextResponse.json({ error: err?.message ?? 'Lookup failed' }, { status: 500 });
  }
});
