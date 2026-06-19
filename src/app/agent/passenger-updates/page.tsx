'use client';

import { UserCog, Info } from 'lucide-react';

export default function AgentPassengerUpdatesPage() {
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-black text-white mb-2">Passenger Updates</h1>
      <p className="text-sm text-slate-400 mb-6">View and manage passenger update requests for your bookings</p>

      <div className="flex items-start gap-2.5 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-6">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-400">
          To update passenger details, go to <strong>My Bookings → View Booking → Passengers tab</strong> and click Edit on any passenger.
          Identity fields (Name, DOB, Gender) require Admin approval.
        </p>
      </div>

      <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-12 text-center">
        <UserCog className="w-10 h-10 text-slate-700 mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">No pending passenger updates</p>
        <p className="text-xs text-slate-600 mt-1">Updates made through booking detail pages will appear here</p>
      </div>
    </div>
  );
}
