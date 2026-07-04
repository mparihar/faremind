'use client';

import { XCircle, Info } from 'lucide-react';

export default function AgentCancellationsPage() {
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-black text-white mb-2">Cancellation Requests</h1>
      <p className="text-sm text-slate-400 mb-6">View cancellation requests submitted for your bookings</p>

      <div className="flex items-start gap-2.5 p-4 rounded-xl bg-teal-500/10 border border-teal-500/20 mb-6">
        <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
        <p className="text-xs text-teal-400">
          To cancel a booking, go to <strong>My Bookings → View Booking</strong> and click "Cancel Booking".
          Cancellations are processed directly with the airline and refunds are applied automatically.
        </p>
      </div>

      <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-12 text-center">
        <XCircle className="w-10 h-10 text-slate-700 mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">No cancellation requests</p>
        <p className="text-xs text-slate-600 mt-1">Cancelled bookings will appear in your bookings list</p>
      </div>
    </div>
  );
}
