'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Search, X, ChevronLeft, ChevronRight } from 'lucide-react';

// ─── Types ────────────────────────────────────────

interface PlatformFeeRule {
  id: string;
  feeType: string;
  feeName: string;
  feeDescription: string | null;
  calculationModel: string;
  fixedAmount: number | null;
  percentageValue: number | null;
  currency: string;
  appliesToAdult: boolean;
  appliesToChild: boolean;
  appliesToInfant: boolean;
  providerScope: string;
  cabinScope: string;
  tripTypeScope: string;
  routeScopeType: string;
  originCountry: string | null;
  destinationCountry: string | null;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  priority: number;
  createdAt: string;
  updatedAt: string;
  createdByAdmin?: { fullName: string; email: string } | null;
  updatedByAdmin?: { fullName: string; email: string } | null;
}

const FEE_TYPES = ['SERVICE_FEE'] as const;
const CALC_MODELS = ['FIXED_PER_BOOKING', 'FIXED_PER_TRAVELER', 'PERCENTAGE_OF_FARE', 'PERCENTAGE_OF_BOOKING_TOTAL', 'HYBRID'] as const;
const PROVIDER_SCOPES = ['ALL', 'DUFFEL', 'MYSTIFLY', 'OTHER'] as const;
const CABIN_SCOPES = ['ALL', 'ECONOMY', 'ECONOMY_BASIC', 'ECONOMY_STANDARD', 'ECONOMY_FLEX', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] as const;
const TRIP_SCOPES = ['ALL', 'ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'] as const;
const ROUTE_SCOPES = ['ALL', 'DOMESTIC', 'INTERNATIONAL', 'CUSTOM'] as const;

const CALC_MODEL_LABELS: Record<string, string> = {
  FIXED_PER_BOOKING: 'Fixed / Booking',
  FIXED_PER_TRAVELER: 'Fixed / Traveler',
  PERCENTAGE_OF_FARE: '% of Fare',
  PERCENTAGE_OF_BOOKING_TOTAL: '% of Total',
  HYBRID: 'Hybrid',
};

const defaultForm = {
  feeType: 'SERVICE_FEE' as string,
  feeName: '',
  feeDescription: '',
  calculationModel: 'FIXED_PER_TRAVELER' as string,
  fixedAmount: '' as string | number,
  percentageValue: '' as string | number,
  currency: 'USD',
  appliesToAdult: true,
  appliesToChild: true,
  appliesToInfant: true,
  providerScope: 'ALL',
  cabinScope: 'ALL',
  tripTypeScope: 'ALL',
  routeScopeType: 'ALL',
  originCountry: '',
  destinationCountry: '',
  active: true,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: '',
  priority: 1,
};

// ─── Component ────────────────────────────────────

export default function PlatformFeesPage() {
  const [rules, setRules] = useState<PlatformFeeRule[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterFeeType, setFilterFeeType] = useState('');
  const [filterActive, setFilterActive] = useState('');

  // Modal
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
      if (filterFeeType) params.set('feeType', filterFeeType);
      if (filterActive) params.set('active', filterActive);

      const res = await adminFetch(`/api/admin/commercial/platform-fees?${params}`);
      const data = await res.json();
      setRules(data.rules ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [page, search, filterFeeType, filterActive]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...defaultForm });
    setError('');
    setShowForm(true);
  }

  function openEdit(rule: PlatformFeeRule) {
    setEditingId(rule.id);
    setForm({
      feeType: rule.feeType,
      feeName: rule.feeName,
      feeDescription: rule.feeDescription ?? '',
      calculationModel: rule.calculationModel,
      fixedAmount: rule.fixedAmount ?? '',
      percentageValue: rule.percentageValue ?? '',
      currency: rule.currency,
      appliesToAdult: rule.appliesToAdult,
      appliesToChild: rule.appliesToChild,
      appliesToInfant: rule.appliesToInfant,
      providerScope: rule.providerScope,
      cabinScope: rule.cabinScope,
      tripTypeScope: rule.tripTypeScope,
      routeScopeType: rule.routeScopeType,
      originCountry: rule.originCountry ?? '',
      destinationCountry: rule.destinationCountry ?? '',
      active: rule.active,
      effectiveFrom: rule.effectiveFrom?.slice(0, 10) ?? '',
      effectiveTo: rule.effectiveTo?.slice(0, 10) ?? '',
      priority: rule.priority,
    });
    setError('');
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        fixedAmount: form.fixedAmount !== '' ? Number(form.fixedAmount) : null,
        percentageValue: form.percentageValue !== '' ? Number(form.percentageValue) : null,
        effectiveTo: form.effectiveTo || null,
        originCountry: form.originCountry || null,
        destinationCountry: form.destinationCountry || null,
      };

      const url = editingId
        ? `/api/admin/commercial/platform-fees/${editingId}`
        : '/api/admin/commercial/platform-fees';

      const res = await adminFetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setShowForm(false);
      fetchRules();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: PlatformFeeRule) {
    try {
      await adminFetch(`/api/admin/commercial/platform-fees/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !rule.active }),
      });
      fetchRules();
    } catch { /* ignore */ }
  }

  async function handleDelete(rule: PlatformFeeRule) {
    if (!confirm(`Soft-delete "${rule.feeName}"? It will be deactivated and hidden.`)) return;
    try {
      await adminFetch(`/api/admin/commercial/platform-fees/${rule.id}`, { method: 'DELETE' });
      fetchRules();
    } catch { /* ignore */ }
  }

  const pages = Math.ceil(total / LIMIT);

  const needsFixed = ['FIXED_PER_BOOKING', 'FIXED_PER_TRAVELER', 'HYBRID'].includes(form.calculationModel);
  const needsPercent = ['PERCENTAGE_OF_FARE', 'PERCENTAGE_OF_BOOKING_TOTAL', 'HYBRID'].includes(form.calculationModel);

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Platform Fees</h1>
          <p className="text-sm text-slate-400">Manage service fee and markup rules</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#1ABC9C] text-white text-sm font-bold rounded-xl hover:bg-[#1ABC9C]/90 transition-all"
        >
          <Plus size={16} /> Add Fee Rule
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search rules..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:border-[#1ABC9C]/50"
          />
        </div>
        <select
          value={filterFeeType}
          onChange={e => { setFilterFeeType(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none"
        >
          <option value="">All Fee Types</option>
          {FEE_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
        </select>
        <select
          value={filterActive}
          onChange={e => { setFilterActive(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none"
        >
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
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Cabin</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/40">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : rules.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No rules found</td></tr>
            ) : rules.map(rule => (
              <tr key={rule.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${rule.feeType === 'SERVICE_FEE' ? 'bg-orange-500/15 text-orange-400' : 'bg-purple-500/15 text-purple-400'}`}>
                    {rule.feeType.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-white font-semibold">{rule.feeName}</td>
                <td className="px-4 py-3 text-slate-400">{CALC_MODEL_LABELS[rule.calculationModel] ?? rule.calculationModel}</td>
                <td className="px-4 py-3 text-white font-mono">
                  {rule.fixedAmount !== null && `$${rule.fixedAmount}`}
                  {rule.fixedAmount !== null && rule.percentageValue !== null && ' + '}
                  {rule.percentageValue !== null && `${rule.percentageValue}%`}
                </td>
                <td className="px-4 py-3 text-slate-400">{rule.providerScope}</td>
                <td className="px-4 py-3 text-slate-400">{rule.cabinScope}</td>
                <td className="px-4 py-3 text-slate-400">{rule.priority}</td>
                <td className="px-4 py-3">
                  <button onClick={() => handleToggle(rule)} className="flex items-center gap-1">
                    {rule.active ? (
                      <><ToggleRight size={18} className="text-[#1ABC9C]" /><span className="text-[10px] text-[#1ABC9C] font-bold">ON</span></>
                    ) : (
                      <><ToggleLeft size={18} className="text-slate-500" /><span className="text-[10px] text-slate-500 font-bold">OFF</span></>
                    )}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => openEdit(rule)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-all" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(rule)} className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-400">
          <span>Showing {(page-1)*LIMIT+1}–{Math.min(page*LIMIT, total)} of {total}</span>
          <div className="flex items-center gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p-1)} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <span className="px-2">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p+1)} className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
        </div>
      )}

      {/* ─── Form Modal ─── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">{editingId ? 'Edit Fee Rule' : 'Add Fee Rule'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>

            {error && <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

            <div className="grid grid-cols-2 gap-4">
              {/* Fee Type */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Fee Type *</label>
                <select value={form.feeType} onChange={e => setForm(f => ({ ...f, feeType: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {FEE_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                </select>
              </div>

              {/* Fee Name */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Fee Name *</label>
                <input type="text" value={form.feeName} onChange={e => setForm(f => ({ ...f, feeName: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="e.g. Default Service Fee" />
              </div>

              {/* Calculation Model */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Calculation Model *</label>
                <select value={form.calculationModel} onChange={e => setForm(f => ({ ...f, calculationModel: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {CALC_MODELS.map(m => <option key={m} value={m}>{CALC_MODEL_LABELS[m]}</option>)}
                </select>
              </div>

              {/* Currency */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Currency</label>
                <input type="text" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              {/* Fixed Amount */}
              {needsFixed && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Fixed Amount ($) *</label>
                  <input type="number" step="0.01" min="0" value={form.fixedAmount} onChange={e => setForm(f => ({ ...f, fixedAmount: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="10.00" />
                </div>
              )}

              {/* Percentage */}
              {needsPercent && (
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">Percentage (%) *</label>
                  <input type="number" step="0.01" min="0" max="100" value={form.percentageValue} onChange={e => setForm(f => ({ ...f, percentageValue: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" placeholder="1.5" />
                </div>
              )}

              {/* Provider Scope */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Provider Scope</label>
                <select value={form.providerScope} onChange={e => setForm(f => ({ ...f, providerScope: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {PROVIDER_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Cabin Scope */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Cabin Scope</label>
                <select value={form.cabinScope} onChange={e => setForm(f => ({ ...f, cabinScope: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {CABIN_SCOPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>

              {/* Trip Type */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Trip Type Scope</label>
                <select value={form.tripTypeScope} onChange={e => setForm(f => ({ ...f, tripTypeScope: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {TRIP_SCOPES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              </div>

              {/* Route Scope */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Route Scope</label>
                <select value={form.routeScopeType} onChange={e => setForm(f => ({ ...f, routeScopeType: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none">
                  {ROUTE_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Priority</label>
                <input type="number" min="1" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 1 }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              {/* Effective From */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Effective From</label>
                <input type="date" value={form.effectiveFrom} onChange={e => setForm(f => ({ ...f, effectiveFrom: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              {/* Effective To */}
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-1">Effective To (optional)</label>
                <input type="date" value={form.effectiveTo} onChange={e => setForm(f => ({ ...f, effectiveTo: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none" />
              </div>

              {/* Passenger Applicability */}
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-400 mb-2">Applies To</label>
                <div className="flex items-center gap-4">
                  {(['appliesToAdult', 'appliesToChild', 'appliesToInfant'] as const).map(key => (
                    <label key={key} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-[#1ABC9C] focus:ring-[#1ABC9C]" />
                      {key.replace('appliesTo', '')}
                    </label>
                  ))}
                </div>
              </div>

              {/* Description */}
              <div className="col-span-2">
                <label className="block text-xs font-bold text-slate-400 mb-1">Description</label>
                <textarea value={form.feeDescription} onChange={e => setForm(f => ({ ...f, feeDescription: e.target.value }))} rows={2} className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white outline-none resize-none" placeholder="Internal description for this rule..." />
              </div>

              {/* Active */}
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 rounded bg-slate-700 border-slate-600 text-[#1ABC9C] focus:ring-[#1ABC9C]" />
                  Active (enabled for new bookings)
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-700/50">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 bg-[#1ABC9C] text-white text-sm font-bold rounded-xl hover:bg-[#1ABC9C]/90 transition-all disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
