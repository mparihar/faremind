'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Search, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

interface ProtectionRule {
  id: string; productName: string; productDescription: string | null;
  pricingModel: string; fixedAmount: number | null; percentageValue: number | null;
  currency: string; cabinScope: string; tripTypeScope: string;
  providerName: string | null; minBookingAmount: number | null; maxBookingAmount: number | null;
  appliesToAdult: boolean; appliesToChild: boolean; appliesToInfant: boolean;
  coverageSummary: string | null; termsUrl: string | null;
  active: boolean; priority: number; effectiveFrom: string; effectiveTo: string | null;
  createdAt: string; createdByAdmin?: { fullName: string } | null;
}

const PRICING_MODELS = ['FIXED_PER_TRAVELER', 'FIXED_PER_BOOKING', 'PERCENTAGE_OF_FARE', 'PROVIDER_QUOTED'] as const;
const CABIN_SCOPES = ['ALL', 'ECONOMY', 'ECONOMY_BASIC', 'ECONOMY_STANDARD', 'ECONOMY_FLEX', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
const TRIP_SCOPES = ['ALL', 'ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'] as const;

const MODEL_LABELS: Record<string, string> = {
  FIXED_PER_TRAVELER: 'Fixed / Traveler',
  FIXED_PER_BOOKING: 'Fixed / Booking',
  PERCENTAGE_OF_FARE: '% of Fare',
  PROVIDER_QUOTED: 'Provider Quoted',
};

const defaultForm = {
  productName: '', productDescription: '', pricingModel: 'FIXED_PER_TRAVELER' as string,
  fixedAmount: '' as string | number, percentageValue: '' as string | number, currency: 'USD',
  cabinScope: 'ALL', fareClassScope: '', tripTypeScope: 'ALL',
  routeScopeType: 'ALL', originCountry: '', destinationCountry: '',
  providerName: '', providerProductCode: '',
  minBookingAmount: '' as string | number, maxBookingAmount: '' as string | number,
  appliesToAdult: true, appliesToChild: true, appliesToInfant: true,
  coverageSummary: '', termsUrl: '',
  active: true, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '', priority: 1,
};

export default function ProtectionProductsPage() {
  const [rules, setRules] = useState<ProtectionRule[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...defaultForm });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const LIMIT = 20;

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search) params.set('q', search);
      if (filterActive) params.set('active', filterActive);
      const res = await adminFetch(`/api/admin/commercial/protection-products?${params}`);
      const data = await res.json();
      setRules(data.rules ?? []); setTotal(data.total ?? 0);
    } catch { setRules([]); } finally { setLoading(false); }
  }, [page, search, filterActive]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  function openCreate() { setEditingId(null); setForm({ ...defaultForm }); setError(''); setShowForm(true); }

  function openEdit(r: ProtectionRule) {
    setEditingId(r.id);
    setForm({
      productName: r.productName, productDescription: r.productDescription ?? '',
      pricingModel: r.pricingModel, fixedAmount: r.fixedAmount ?? '', percentageValue: r.percentageValue ?? '',
      currency: r.currency, cabinScope: r.cabinScope, fareClassScope: '', tripTypeScope: r.tripTypeScope,
      routeScopeType: 'ALL', originCountry: '', destinationCountry: '',
      providerName: r.providerName ?? '', providerProductCode: '',
      minBookingAmount: r.minBookingAmount ?? '', maxBookingAmount: r.maxBookingAmount ?? '',
      appliesToAdult: r.appliesToAdult, appliesToChild: r.appliesToChild, appliesToInfant: r.appliesToInfant,
      coverageSummary: r.coverageSummary ?? '', termsUrl: r.termsUrl ?? '',
      active: r.active, effectiveFrom: r.effectiveFrom?.slice(0, 10) ?? '', effectiveTo: r.effectiveTo?.slice(0, 10) ?? '', priority: r.priority,
    });
    setError(''); setShowForm(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        fixedAmount: form.fixedAmount !== '' ? Number(form.fixedAmount) : null,
        percentageValue: form.percentageValue !== '' ? Number(form.percentageValue) : null,
        minBookingAmount: form.minBookingAmount !== '' ? Number(form.minBookingAmount) : null,
        maxBookingAmount: form.maxBookingAmount !== '' ? Number(form.maxBookingAmount) : null,
        effectiveTo: form.effectiveTo || null,
        providerName: form.providerName || null,
        providerProductCode: form.providerProductCode || null,
        originCountry: form.originCountry || null,
        destinationCountry: form.destinationCountry || null,
        coverageSummary: form.coverageSummary || null,
        termsUrl: form.termsUrl || null,
      };
      const url = editingId ? `/api/admin/commercial/protection-products/${editingId}` : '/api/admin/commercial/protection-products';
      const res = await adminFetch(url, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setShowForm(false); fetchRules();
    } catch (err: any) { setError(err.message); } finally { setSaving(false); }
  }

  async function handleToggle(r: ProtectionRule) {
    try { await adminFetch(`/api/admin/commercial/protection-products/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !r.active }) }); fetchRules(); } catch { /* */ }
  }

  async function handleDelete(r: ProtectionRule) {
    if (!confirm(`Soft-delete "${r.productName}"?`)) return;
    try { await adminFetch(`/api/admin/commercial/protection-products/${r.id}`, { method: 'DELETE' }); fetchRules(); } catch { /* */ }
  }

  const pages = Math.ceil(total / LIMIT);
  const isProviderQuoted = form.pricingModel === 'PROVIDER_QUOTED';
  const needsFixed = ['FIXED_PER_TRAVELER', 'FIXED_PER_BOOKING'].includes(form.pricingModel);
  const needsPct = form.pricingModel === 'PERCENTAGE_OF_FARE';

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Protection Products</h1>
          <p className="text-sm text-slate-400">Manage price drop protection rules</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-[#1ABC9C] text-white text-sm font-bold rounded-xl hover:bg-[#1ABC9C]/90 transition-all">
          <Plus size={16} /> Add Rule
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" placeholder="Search..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-[#1ABC9C]/50" />
        </div>
        <select value={filterActive} onChange={e => { setFilterActive(e.target.value); setPage(1); }} className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/70">
            <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-3">Product Name</th>
              <th className="px-4 py-3">Pricing Model</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Cabin</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : rules.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No rules found</td></tr>
            ) : rules.map(r => (
              <tr key={r.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 text-white font-semibold">{r.productName}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.pricingModel === 'PROVIDER_QUOTED' ? 'bg-amber-500/15 text-amber-400' : 'bg-[#1ABC9C]/15 text-[#1ABC9C]'}`}>
                    {MODEL_LABELS[r.pricingModel]}
                  </span>
                </td>
                <td className="px-4 py-3 text-white font-mono">
                  {r.fixedAmount !== null ? `$${r.fixedAmount}` : r.percentageValue !== null ? `${r.percentageValue}%` : '—'}
                </td>
                <td className="px-4 py-3 text-slate-400">{r.cabinScope}</td>
                <td className="px-4 py-3 text-slate-400">{r.providerName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-400">{r.priority}</td>
                <td className="px-4 py-3">
                  <button onClick={() => handleToggle(r)}>
                    {r.active ? <><ToggleRight size={18} className="text-[#1ABC9C] inline" /> <span className="text-[10px] text-[#1ABC9C] font-bold">ON</span></> : <><ToggleLeft size={18} className="text-slate-500 inline" /> <span className="text-[10px] text-slate-500 font-bold">OFF</span></>}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(r)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-400">
          <span>{(page-1)*LIMIT+1}–{Math.min(page*LIMIT, total)} of {total}</span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p-1)} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="px-2">{page}/{pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p+1)} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">{editingId ? 'Edit Protection Rule' : 'Add Protection Rule'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>

            {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

            {isProviderQuoted && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-300">Provider-quoted pricing will use the provider&apos;s returned price at booking time instead of admin-configured amounts.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Product Name *</label>
                <input type="text" value={form.productName} onChange={e => setForm(f => ({ ...f, productName: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="Price Drop Protection" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Pricing Model *</label>
                <select value={form.pricingModel} onChange={e => setForm(f => ({ ...f, pricingModel: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {PRICING_MODELS.map(m => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
                </select>
              </div>

              {needsFixed && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Fixed Amount ($)</label>
                  <input type="number" step="0.01" min="0" value={form.fixedAmount} onChange={e => setForm(f => ({ ...f, fixedAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="57.00" />
                </div>
              )}
              {needsPct && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Percentage (%)</label>
                  <input type="number" step="0.01" min="0" max="100" value={form.percentageValue} onChange={e => setForm(f => ({ ...f, percentageValue: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="6" />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Cabin Scope</label>
                <select value={form.cabinScope} onChange={e => setForm(f => ({ ...f, cabinScope: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {CABIN_SCOPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Trip Type</label>
                <select value={form.tripTypeScope} onChange={e => setForm(f => ({ ...f, tripTypeScope: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {TRIP_SCOPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Provider Name</label>
                <input type="text" value={form.providerName} onChange={e => setForm(f => ({ ...f, providerName: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="e.g. FAREMIND" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Currency</label>
                <input type="text" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Min Booking Amount</label>
                <input type="number" step="1" min="0" value={form.minBookingAmount} onChange={e => setForm(f => ({ ...f, minBookingAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Max Booking Amount</label>
                <input type="number" step="1" min="0" value={form.maxBookingAmount} onChange={e => setForm(f => ({ ...f, maxBookingAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Effective From</label>
                <input type="date" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Effective To</label>
                <input type="date" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-400 mb-2">Applies To</label>
                <div className="flex items-center gap-4">
                  {(['appliesToAdult', 'appliesToChild', 'appliesToInfant'] as const).map(key => (
                    <label key={key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-[#1ABC9C]" />
                      {key.replace('appliesTo', '')}
                    </label>
                  ))}
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-400 mb-1">Coverage Summary</label>
                <textarea value={form.coverageSummary} onChange={e => setForm(f => ({ ...f, coverageSummary: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none resize-none" placeholder="80% refund if price drops within 24h..." />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Priority</label>
                <input type="number" min="1" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-[#1ABC9C]" />
                  Active
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-700/50">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 bg-[#1ABC9C] text-white text-sm font-bold rounded-xl hover:bg-[#1ABC9C]/90 disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
