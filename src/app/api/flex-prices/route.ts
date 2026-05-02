import { NextRequest, NextResponse } from 'next/server';
import { searchRoundTripFlights } from '@/lib/providers/orchestrator';

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = searchParams.get('origin')?.toUpperCase();
  const destination = searchParams.get('destination')?.toUpperCase();
  const date = searchParams.get('date');
  const returnDate = searchParams.get('returnDate');
  const adults = parseInt(searchParams.get('adults') || '1');
  const cabin = searchParams.get('cabin') || 'economy';

  if (!origin || !destination || !date || !returnDate) {
    return NextResponse.json({ error: 'Missing required params' }, { status: 400 });
  }

  // 7 combinations: D-3→R, D-2→R, D-1→R, D→R (center), D→R+1, D→R+2, D→R+3
  const pairs = [
    { dep: shiftDate(date, -3), ret: returnDate },
    { dep: shiftDate(date, -2), ret: returnDate },
    { dep: shiftDate(date, -1), ret: returnDate },
    { dep: date,                ret: returnDate },
    { dep: date,                ret: shiftDate(returnDate, 1) },
    { dep: date,                ret: shiftDate(returnDate, 2) },
    { dep: date,                ret: shiftDate(returnDate, 3) },
  ];

  const settled = await Promise.allSettled(
    pairs.map(async (pair) => {
      const res = await searchRoundTripFlights({
        origin: origin!,
        destination: destination!,
        date: pair.dep,
        returnDate: pair.ret,
        adults,
        cabin,
      });
      const minPrice = res.options.length > 0
        ? Math.min(...res.options.map((o) => o.totalPrice))
        : null;
      return {
        dep: pair.dep,
        ret: pair.ret,
        minPrice,
        currency: res.options[0]?.currency ?? 'USD',
      };
    })
  );

  const prices = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { dep: pairs[i].dep, ret: pairs[i].ret, minPrice: null, currency: 'USD' }
  );

  return NextResponse.json({ prices });
}
