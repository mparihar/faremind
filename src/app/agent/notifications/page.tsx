'use client';

import { Bell } from 'lucide-react';

export default function AgentNotificationsPage() {
  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-black text-white mb-2">Notifications</h1>
      <p className="text-sm text-slate-400 mb-6">Agent notifications and alerts</p>

      <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-12 text-center">
        <Bell className="w-10 h-10 text-slate-700 mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">No notifications</p>
        <p className="text-xs text-slate-600 mt-1">Booking updates and alerts will appear here</p>
      </div>
    </div>
  );
}
