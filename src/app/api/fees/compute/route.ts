import { NextRequest, NextResponse } from 'next/server';
import { calculateCommercialFees, calculateFallbackFees, type BookingContext } from '@/lib/fee-engine';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as BookingContext;
    if (!body.passengers?.length || !body.currency) {
      return NextResponse.json({ error: 'passengers and currency required' }, { status: 400 });
    }
    let result;
    try {
      result = await calculateCommercialFees(body);
    } catch {
      result = calculateFallbackFees(body);
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to compute fees' }, { status: 500 });
  }
}
