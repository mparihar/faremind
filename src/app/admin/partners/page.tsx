'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { Users2, Plus, RefreshCw, Search, CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';
import { format } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE:    'bg-emerald-400/15 text-emerald-400',
  SUSPENDED: 'bg-amber-400/15 text-amber-400',
  INACTIVE:  'bg-slate-400/15 text-slate-400',
};

export default function PartnersPage() {
  const router = useRouter();
  const [partners, setPartners] = useState<any[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [showNew, setShowNew]   = useState(false);
  const [form, setForm]         = useState({ name: '', email: '', phone: '', country: '', creditLimit: '' });
  const [saving, setSaving]     = useState(false);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    const res = await adminFetch(`/api/admin/partners?${params}`);
    if (res.status === 401) { router.replace('/admin/login'); return; }
    const data = await res.json();
    setPartners(data.partners ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }

  useEffect(() => { load(); }, [search]);

  async function createPartner() {
    setSaving(true);
    const res = await adminFetch('/api/admin/partners', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowNew(false);
      setForm({ name: '', email: '', phone: '', country: '', creditLimit: '' });
      load();
    }
    setSaving(false);
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Partners</h1>
          <p className="text-slate-400 text-sm mt-0.5">{total} registered partners</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white text-sm font-bold rounded-xl transition-all">
            <Plus size={14} />
            New Partner
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search partners…"
          className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
        />
      </div>

      {/* New partner modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-white font-black text-lg">New Partner</h2>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-4">
              {[
                { key: 'name', label: 'Partner Name', placeholder: 'Acme Travel Agency', required: true },
                { key: 'email', label: 'Email', placeholder: 'billing@acme.com', required: true },
                { key: 'phone', label: 'Phone', placeholder: '+1 555 0100' },
                { key: 'country', label: 'Country', placeholder: 'US' },
                { key: 'creditLimit', label: 'Credit Limit (USD)', placeholder: '50000' },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">{f.label}{f.required && ' *'}</label>
                  <input
                    value={(form as any)[f.key]}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
                  />
                </div>
              ))}
              <button
                onClick={createPartner}
                disabled={!form.name || !form.email || saving}
                className="w-full py-2.5 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white font-bold rounded-xl disabled:opacity-50 transition-all"
              >
                {saving ? 'Creating…' : 'Create Partner'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Partners list */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw size={24} className="text-[#1ABC9C] animate-spin" /></div>
      ) : partners.length === 0 ? (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-10 text-center">
          <Users2 size={32} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No partners yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {partners.map((p: any) => (
            <div key={p.id} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 hover:border-[#1ABC9C]/30 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-bold text-sm">{p.name}</h3>
                  <p className="text-slate-400 text-xs">{p.email}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[p.status] ?? 'bg-slate-400/15 text-slate-400'}`}>
                  {p.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-700/30 rounded-xl p-3">
                  <p className="text-slate-500 mb-0.5">API Key</p>
                  <p className="text-slate-300 font-mono text-[10px] truncate">{p.apiKey?.slice(0, 20)}…</p>
                </div>
                <div className="bg-slate-700/30 rounded-xl p-3">
                  <p className="text-slate-500 mb-0.5">Credit Balance</p>
                  <p className="text-white font-bold">
                    ${Number(p.creditBalance ?? 0).toLocaleString()}
                    {p.creditLimit && <span className="text-slate-500"> / ${Number(p.creditLimit).toLocaleString()}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-700/30">
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span>{p.users?.length ?? 0} users</span>
                  <span>{p._count?.commissionRules ?? 0} rules</span>
                </div>
                <span className="text-slate-600 text-[10px]">Since {format(new Date(p.createdAt), 'MMM yyyy')}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
