'use client';

import { useState, useEffect } from 'react';
import { useAdminStore, adminFetch } from '@/store/useAdminStore';
import {
  Gift, Plus, Trash2, Save, RefreshCw, CheckCircle2, AlertTriangle,
  GripVertical, Eye, EyeOff, CreditCard, Calendar, Clock, Zap, Ticket,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ICON_OPTIONS = [
  { value: 'CreditCard', label: 'Credit Card', icon: CreditCard },
  { value: 'Gift', label: 'Gift', icon: Gift },
  { value: 'Calendar', label: 'Calendar', icon: Calendar },
  { value: 'Clock', label: 'Clock', icon: Clock },
  { value: 'Zap', label: 'Lightning', icon: Zap },
  { value: 'Ticket', label: 'Ticket', icon: Ticket },
];

interface BenefitItem {
  label: string;
  value: string;
  icon: string;
  enabled: boolean;
}

const DEFAULT_BENEFITS: BenefitItem[] = [
  { label: 'Travel Credits', value: '$120 Available', icon: 'CreditCard', enabled: true },
  { label: 'Loyalty Points', value: '1,250 Points', icon: 'Gift', enabled: true },
  { label: 'Member Since', value: '__MEMBER_SINCE__', icon: 'Calendar', enabled: true },
];

export default function BenefitsConfigPage() {
  const { user } = useAdminStore();
  const [benefits, setBenefits] = useState<BenefitItem[]>(DEFAULT_BENEFITS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await adminFetch('/api/admin/system-config');
        if (res.ok) {
          const data = await res.json();
          const cfg = data.configs?.find((c: any) => c.key === 'user_benefits');
          if (cfg?.value) {
            try {
              const parsed = JSON.parse(cfg.value);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setBenefits(parsed);
              }
            } catch { /* use defaults */ }
          }
        }
      } catch { /* use defaults */ }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await adminFetch('/api/admin/system-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'user_benefits',
          value: JSON.stringify(benefits),
          description: 'User dashboard benefits card configuration (JSON array)',
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save.');
      }
    } catch {
      setError('Network error.');
    }
    setSaving(false);
  }

  function addBenefit() {
    setBenefits([...benefits, { label: '', value: '', icon: 'Gift', enabled: true }]);
  }

  function removeBenefit(index: number) {
    setBenefits(benefits.filter((_, i) => i !== index));
  }

  function updateBenefit(index: number, field: keyof BenefitItem, val: any) {
    const updated = [...benefits];
    (updated[index] as any)[field] = val;
    setBenefits(updated);
  }

  function moveBenefit(from: number, to: number) {
    if (to < 0 || to >= benefits.length) return;
    const updated = [...benefits];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    setBenefits(updated);
  }

  const iCls = 'w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all placeholder:text-slate-600';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Gift size={22} className="text-amber-400" /> Benefits Configuration
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Configure the &ldquo;Your Benefits&rdquo; card shown on user dashboards
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1ABC9C] hover:bg-[#16a085] text-white font-bold text-sm disabled:opacity-40 transition-all"
        >
          {saving ? <RefreshCw size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
          {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {saved && (
        <div className="mb-4 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-medium flex items-center gap-2">
          <CheckCircle2 size={14} /> Benefits configuration saved successfully. Changes will be visible to users immediately.
        </div>
      )}

      {/* Benefits list */}
      <div className="space-y-3 mb-5">
        <AnimatePresence>
          {benefits.map((b, i) => {
            const IconComp = ICON_OPTIONS.find(o => o.value === b.icon)?.icon || Gift;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className={`bg-white/[0.04] border ${b.enabled ? 'border-white/[0.08]' : 'border-white/[0.04] opacity-60'} rounded-2xl p-5`}
              >
                <div className="flex items-start gap-4">
                  {/* Drag handle + icon preview */}
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveBenefit(i, i - 1)} disabled={i === 0}
                        className="text-slate-600 hover:text-white disabled:opacity-20 transition-colors text-xs">▲</button>
                      <button onClick={() => moveBenefit(i, i + 1)} disabled={i === benefits.length - 1}
                        className="text-slate-600 hover:text-white disabled:opacity-20 transition-colors text-xs">▼</button>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center">
                      <IconComp size={18} className="text-amber-400" />
                    </div>
                  </div>

                  {/* Fields */}
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block tracking-wide">Label</label>
                        <input value={b.label} onChange={e => updateBenefit(i, 'label', e.target.value)}
                          placeholder="e.g. Travel Credits" className={iCls} />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block tracking-wide">
                          Display Value
                          {b.value === '__MEMBER_SINCE__' && (
                            <span className="text-[#1ABC9C] ml-1">(dynamic)</span>
                          )}
                        </label>
                        <input value={b.value} onChange={e => updateBenefit(i, 'value', e.target.value)}
                          placeholder="e.g. $120 Available" className={iCls} />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block tracking-wide">Icon</label>
                        <select value={b.icon} onChange={e => updateBenefit(i, 'icon', e.target.value)}
                          className={`${iCls} cursor-pointer bg-[#0b0f1a] w-40`}>
                          {ICON_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value} className="bg-white text-slate-900">{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-3 pt-5">
                        <button onClick={() => updateBenefit(i, 'enabled', !b.enabled)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            b.enabled ? 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/20' :
                            'bg-slate-500/10 text-slate-500 border border-slate-500/20'
                          }`}>
                          {b.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                          {b.enabled ? 'Visible' : 'Hidden'}
                        </button>
                        <button onClick={() => removeBenefit(i)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-400/10 text-red-400 border border-red-400/20 hover:bg-red-400/20 transition-all">
                          <Trash2 size={12} /> Remove
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {b.value === '__MEMBER_SINCE__' && (
                  <div className="mt-3 px-3 py-2 bg-[#1ABC9C]/5 border border-[#1ABC9C]/15 rounded-lg">
                    <p className="text-[#1ABC9C] text-[10px] font-bold">
                      💡 Special value: <code className="bg-white/[0.06] px-1 rounded">__MEMBER_SINCE__</code> automatically shows each user&apos;s registration date
                    </p>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Add button */}
      <button onClick={addBenefit}
        className="w-full py-3 rounded-xl border-2 border-dashed border-white/[0.08] text-slate-400 hover:text-white hover:border-[#1ABC9C]/30 transition-all flex items-center justify-center gap-2 text-sm font-semibold">
        <Plus size={16} /> Add Benefit
      </button>

      {/* Preview */}
      <div className="mt-8">
        <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-3">Preview</p>
        <div className="max-w-xs">
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
            <h3 className="text-white text-sm font-bold flex items-center gap-2 mb-3">
              <Gift size={14} className="text-amber-400" /> Your Benefits
            </h3>
            <div className="space-y-0">
              {benefits.filter(b => b.enabled).map((b, i) => {
                const Icon = ICON_OPTIONS.find(o => o.value === b.icon)?.icon || Gift;
                return (
                  <div key={i} className={`flex items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-white/[0.05]' : ''}`}>
                    <div className="w-8 h-8 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
                      <Icon size={14} className="text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-semibold">{b.label || 'Untitled'}</p>
                      <p className="text-[#1ABC9C] text-[10px] font-bold">{b.value === '__MEMBER_SINCE__' ? 'May 2024' : (b.value || '—')}</p>
                    </div>
                  </div>
                );
              })}
              {benefits.filter(b => b.enabled).length === 0 && (
                <p className="text-slate-500 text-xs text-center py-4">No visible benefits</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
