'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { useAdminStore } from '@/store/useAdminStore';
import { Plus, RefreshCw, X, Shield, Eye, EyeOff } from 'lucide-react';

const ROLES = ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT', 'FINANCE', 'READ_ONLY'];
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-400/15 text-red-400',
  OPS_ADMIN:   'bg-orange-400/15 text-orange-400',
  SUPPORT:     'bg-blue-400/15 text-blue-400',
  FINANCE:     'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  READ_ONLY:   'bg-slate-400/15 text-slate-400',
};

export default function SettingsPage() {
  const router = useRouter();
  const { user } = useAdminStore();
  const [users, setUsers]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm]       = useState({ email: '', fullName: '', role: 'SUPPORT', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  async function load() {
    setLoading(true);
    const res = await adminFetch('/api/admin/users');
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (res.status === 403) { setLoading(false); return; }
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createUser() {
    setError('');
    setSaving(true);
    const res = await adminFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? 'Failed'); setSaving(false); return; }
    setShowNew(false);
    setForm({ email: '', fullName: '', role: 'SUPPORT', password: '' });
    load();
    setSaving(false);
  }

  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Settings</h1>
          <p className="text-slate-400 text-sm mt-0.5">Admin users & system configuration</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white text-sm font-bold rounded-xl transition-all">
            <Plus size={14} />
            Add Admin User
          </button>
        )}
      </div>

      {/* New user modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-black text-lg">New Admin User</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Full Name *</label>
                <input value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Email *</label>
                <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Role *</label>
                <select value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                  className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all">
                  {ROLES.map(r => <option key={r} value={r} className="bg-slate-700">{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1.5">Password (optional — OTP used if blank)</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    className="w-full px-3 py-2.5 pr-10 bg-slate-700 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all" />
                  <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {error && <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{error}</p>}
              <button onClick={createUser} disabled={!form.email || !form.fullName || saving}
                className="w-full py-2.5 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl disabled:opacity-50 transition-all">
                {saving ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin users list */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-3">
          <Shield size={16} className="text-[#1ABC9C]" />
          <h2 className="text-white font-bold text-sm">Admin Users ({users.length})</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><RefreshCw size={20} className="text-[#1ABC9C] animate-spin" /></div>
        ) : !isSuperAdmin ? (
          <p className="px-5 py-8 text-slate-500 text-sm text-center">Super Admin access required to view user list.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Name', 'Email', 'Role', 'Status', 'Last Login'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {users.map((u: any) => (
                <tr key={u.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-5 py-3.5 text-white font-semibold text-sm">{u.fullName}</td>
                  <td className="px-5 py-3.5 text-slate-400 text-sm">{u.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${ROLE_COLORS[u.role] ?? 'bg-slate-400/15 text-slate-400'}`}>
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${u.isActive ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-500 text-sm">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
