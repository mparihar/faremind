'use client';

import { useAuthStore } from '@/store/useAuthStore';
import { User, Mail, Phone, Shield, Briefcase, Calendar } from 'lucide-react';

export default function AgentProfilePage() {
  const { user } = useAuthStore();

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-black text-white mb-8">Agent Profile</h1>

      <div className="bg-slate-900/80 border border-white/[0.06] rounded-2xl p-8">
        {/* Avatar */}
        <div className="flex items-center gap-5 mb-8 pb-6 border-b border-white/[0.06]">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#1ABC9C] to-[#009CA6] flex items-center justify-center shadow-lg shadow-[#1ABC9C]/20">
            <span className="text-3xl font-black text-white">
              {user?.name?.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">{user?.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#1ABC9C]/15 text-[#1ABC9C] text-xs font-bold border border-[#1ABC9C]/25">
                <Briefcase className="w-3 h-3" /> FareMind Agent
              </span>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold">Email</p>
              <p className="text-sm text-white">{user?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold">Full Name</p>
              <p className="text-sm text-white">{user?.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold">Role</p>
              <p className="text-sm text-white">FAREMIND_AGENT</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center shrink-0">
              <Calendar className="w-4 h-4 text-slate-500" />
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-bold">Agent ID</p>
              <p className="text-sm text-white font-mono">{user?.id}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
