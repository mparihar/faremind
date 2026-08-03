// FILE: src/app/api/admin/post-booking/resolve/route.ts
// Admin twin of the agent post-booking resolver: find a booking from the
// FareMind reference or the airline PNR and return a display-safe summary.
// The Mystifly reference is deliberately not part of the response — servicing
// maps to it internally.
import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin-rbac';
import { resolveServicingTarget } from '@/lib/resolve-booking';

export const POST = withAdmin(async (req: NextRequest) => {
  try {
    const { reference, airlinePnr } = await req.json().catch(() => ({}));
    const result = await resolveServicingTarget({ reference, airlinePnr });
    if (!result.found) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ booking: result.target });
  } catch (err: any) {
    console.error('[Admin][PostBooking][Resolve]', err);
    return NextResponse.json({ error: err?.message ?? 'Lookup failed' }, { status: 500 });
  }
}, 'SUPPORT');
