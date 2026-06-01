'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Search, X, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';

interface InsuranceRule {
  id: string; insuranceProviderName: string; planName: string; planDescription: string | null;
  pricingModel: string; fixedAmount: number | null; percentageValue: number | null;
  currency: string; cabinScope: string; tripTypeScope: string;
  minBookingAmount: number | null; maxBookingAmount: number | null;
  medicalCoverageAmount: number | null; cancellationCoverageAmount: number | null; baggageCoverageAmount: number | null;
  coverageSummary: string | null; termsUrl: string | null;
  active: boolean; priority: number; effectiveFrom: string; effectiveTo: string | null;
  createdAt: string; createdByAdmin?: { fullName: string } | null;
}

const PRICING_MODELS = ['FIXED_PER_TRAVELER', 'FIXED_PER_BOOKING', 'PERCENTAGE_OF_BOOKING_TOTAL', 'PROVIDER_QUOTED'] as const;
const CABIN_SCOPES = ['ALL', 'ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;

const MODEL_LABELS: Record<string, string> = {
  FIXED_PER_TRAVELER: 'Fixed / Traveler', FIXED_PER_BOOKING: 'Fixed / Booking',
  PERCENTAGE_OF_BOOKING_TOTAL: '% of Total', PROVIDER_QUOTED: 'Provider Quoted',
};

const defaultForm = {
  insuranceProviderName: '', providerProductCode: '', planName: '', planDescription: '',
  pricingModel: 'FIXED_PER_TRAVELER' as string, fixedAmount: '' as string | number, percentageValue: '' as string | number,
  currency: 'USD', cabinScope: 'ALL', fareClassScope: '', tripTypeScope: 'ALL',
  routeScopeType: 'ALL', minBookingAmount: '' as string | number, maxBookingAmount: '' as string | number,
  passengerTypeScope: '', coverageSummary: '',
  medicalCoverageAmount: '' as string | number, cancellationCoverageAmount: '' as string | number,
  baggageCoverageAmount: '' as string | number, termsUrl: '',
  active: true, effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: '', priority: 1,
};

export default function InsuranceProductsPage() {
  const [rules, setRules] = useState<InsuranceRule[]>([]);
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
      const res = await adminFetch(`/api/admin/commercial/insurance-products?${params}`);
      const data = await res.json();
      setRules(data.rules ?? []); setTotal(data.total ?? 0);
    } catch { setRules([]); } finally { setLoading(false); }
  }, [page, search, filterActive]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  function openCreate() { setEditingId(null); setForm({ ...defaultForm }); setError(''); setShowForm(true); }

  function openEdit(r: InsuranceRule) {
    setEditingId(r.id);
    setForm({
      insuranceProviderName: r.insuranceProviderName, providerProductCode: '', planName: r.planName,
      planDescription: r.planDescription ?? '', pricingModel: r.pricingModel,
      fixedAmount: r.fixedAmount ?? '', percentageValue: r.percentageValue ?? '',
      currency: r.currency, cabinScope: r.cabinScope, fareClassScope: '', tripTypeScope: r.tripTypeScope,
      routeScopeType: 'ALL', minBookingAmount: r.minBookingAmount ?? '', maxBookingAmount: r.maxBookingAmount ?? '',
      passengerTypeScope: '', coverageSummary: r.coverageSummary ?? '',
      medicalCoverageAmount: r.medicalCoverageAmount ?? '',
      cancellationCoverageAmount: r.cancellationCoverageAmount ?? '',
      baggageCoverageAmount: r.baggageCoverageAmount ?? '',
      termsUrl: r.termsUrl ?? '',
      active: r.active, effectiveFrom: r.effectiveFrom?.slice(0, 10) ?? '', effectiveTo: r.effectiveTo?.slice(0, 10) ?? '', priority: r.priority,
    });
    setError(''); setShowForm(true);
  }

  async function handleSave() {
    setSaving(true); setError('');
    try {
      const toNum = (v: string | number) => v !== '' ? Number(v) : null;
      const payload = {
        ...form, fixedAmount: toNum(form.fixedAmount), percentageValue: toNum(form.percentageValue),
        minBookingAmount: toNum(form.minBookingAmount), maxBookingAmount: toNum(form.maxBookingAmount),
        medicalCoverageAmount: toNum(form.medicalCoverageAmount),
        cancellationCoverageAmount: toNum(form.cancellationCoverageAmount),
        baggageCoverageAmount: toNum(form.baggageCoverageAmount),
        effectiveTo: form.effectiveTo || null,
        providerProductCode: form.providerProductCode || null,
        coverageSummary: form.coverageSummary || null, termsUrl: form.termsUrl || null,
      };
      const url = editingId ? `/api/admin/commercial/insurance-products/${editingId}` : '/api/admin/commercial/insurance-products';
      const res = await adminFetch(url, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setShowForm(false); fetchRules();
    } catch (err: any) { setError(err.message); } finally { setSaving(false); }
  }

  async function handleToggle(r: InsuranceRule) {
    try { await adminFetch(`/api/admin/commercial/insurance-products/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !r.active }) }); fetchRules(); } catch { /* */ }
  }

  async function handleDelete(r: InsuranceRule) {
    if (!confirm(`Soft-delete "${r.planName}"?`)) return;
    try { await adminFetch(`/api/admin/commercial/insurance-products/${r.id}`, { method: 'DELETE' }); fetchRules(); } catch { /* */ }
  }

  const pages = Math.ceil(total / LIMIT);
  const isProviderQuoted = form.pricingModel === 'PROVIDER_QUOTED';
  const needsFixed = ['FIXED_PER_TRAVELER', 'FIXED_PER_BOOKING'].includes(form.pricingModel);
  const needsPct = form.pricingModel === 'PERCENTAGE_OF_BOOKING_TOTAL';

  const fmtCov = (v: number | null) => v ? `$${v.toLocaleString()}` : '—';

  return (
    <div className="p-6 max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Insurance Products</h1>
          <p className="text-sm text-slate-400">Manage travel insurance plans and providers</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-[#1ABC9C] text-white text-sm font-bold rounded-xl hover:bg-[#1ABC9C]/90 transition-all">
          <Plus size={16} /> Add Insurance Rule
        </button>
      </div>

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

      <div className="rounded-2xl border border-slate-700/50 overflow-hidden bg-slate-900">
        <table className="w-full text-sm">
          <thead className="bg-slate-800/70">
            <tr className="text-left text-xs font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Plan Name</th>
              <th className="px-4 py-3">Pricing</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Medical</th>
              <th className="px-4 py-3">Cancel</th>
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
                <td className="px-4 py-3 text-white font-semibold">{r.insuranceProviderName}</td>
                <td className="px-4 py-3 text-slate-300">{r.planName}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.pricingModel === 'PROVIDER_QUOTED' ? 'bg-amber-500/15 text-amber-400' : 'bg-purple-500/15 text-purple-400'}`}>
                    {MODEL_LABELS[r.pricingModel]}
                  </span>
                </td>
                <td className="px-4 py-3 text-white font-mono">
                  {r.fixedAmount !== null ? `$${r.fixedAmount}` : r.percentageValue !== null ? `${r.percentageValue}%` : '—'}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{fmtCov(r.medicalCoverageAmount)}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">{fmtCov(r.cancellationCoverageAmount)}</td>
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
              <h2 className="text-lg font-bold text-white">{editingId ? 'Edit Insurance Rule' : 'Add Insurance Rule'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}
            {isProviderQuoted && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-300">Provider API will return the insurance premium at booking time.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Insurance Provider *</label>
                <input type="text" value={form.insuranceProviderName} onChange={e => setForm(f => ({ ...f, insuranceProviderName: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="e.g. Allianz" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Plan Name *</label>
                <input type="text" value={form.planName} onChange={e => setForm(f => ({ ...f, planName: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="Basic Travel Cover" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Pricing Model *</label>
                <select value={form.pricingModel} onChange={e => setForm(f => ({ ...f, pricingModel: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {PRICING_MODELS.map(m => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Currency</label>
                <input type="text" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              {needsFixed && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Fixed Amount ($)</label>
                  <input type="number" step="0.01" min="0" value={form.fixedAmount} onChange={e => setForm(f => ({ ...f, fixedAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
                </div>
              )}
              {needsPct && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Percentage (%)</label>
                  <input type="number" step="0.01" min="0" max="100" value={form.percentageValue} onChange={e => setForm(f => ({ ...f, percentageValue: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
                </div>
              )}

              {/* Coverage amounts */}
              <div className="col-span-2 pt-2 border-t border-slate-700/50">
                <p className="text-xs font-bold text-slate-400 mb-3">Coverage Amounts</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Medical ($)</label>
                    <input type="number" step="1" min="0" value={form.medicalCoverageAmount} onChange={e => setForm(f => ({ ...f, medicalCoverageAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="50000" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Cancellation ($)</label>
                    <input type="number" step="1" min="0" value={form.cancellationCoverageAmount} onChange={e => setForm(f => ({ ...f, cancellationCoverageAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="5000" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Baggage ($)</label>
                    <input type="number" step="1" min="0" value={form.baggageCoverageAmount} onChange={e => setForm(f => ({ ...f, baggageCoverageAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="2000" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Cabin Scope</label>
                <select value={form.cabinScope} onChange={e => setForm(f => ({ ...f, cabinScope: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {CABIN_SCOPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Priority</label>
                <input type="number" min="1" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
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
                <label className="block text-xs font-bold text-slate-400 mb-1">Coverage Summary</label>
                <textarea value={form.coverageSummary} onChange={e => setForm(f => ({ ...f, coverageSummary: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none resize-none" />
              </div>

              <div className="col-span-2">
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
