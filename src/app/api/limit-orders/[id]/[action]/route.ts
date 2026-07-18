/**
 * Limit Orders [id]/[action] API proxy — handles activate, pause, resume, cancel, authorize-payment
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const { id, action } = await params;
    const validActions = ['activate', 'pause', 'resume', 'cancel', 'authorize-payment'];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    let body = {};
    try { body = await request.json(); } catch { body = {}; }

    const res = await fetch(`${BACKEND}/api/limit-orders/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
