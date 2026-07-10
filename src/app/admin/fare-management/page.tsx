'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, Plus, Edit2, Trash2, CheckCircle2, XCircle,
  Plane, Route, Tag, ArrowRight, Save, X, ChevronDown,
} from 'lucide-react';

interface FareRule {
  id: string;
  provider: string;
  ruleName: string;
  fareType: string;
  originAirport: string | null;
  destinationAirport: string | null;
  airlineCode: string | null;
  airlineName: string | null;
  searchVersion: string;
  target: string;
  isActive: boolean;
  priority: number;
  holdAllowed: boolean;
  holdDurationMinutes: number | null;
  notes: string | null;
  createdAt: string;
}

const FARE_TYPES = ['Public', 'Private', 'Web', 'All'];
const SEARCH_VERSIONS = ['v1', 'v2', 'v2.2'];
const TARGETS = ['Test', 'Production'];

const emptyRule: Partial<FareRule> = {
  provider: 'MYSTIFLY',
  ruleName: '',
  fareType: 'Public',
  originAirport: '',
  destinationAirport: '',
  airlineCode: '',
  airlineName: '',
  searchVersion: 'v2.2',
  target: 'Test',
  isActive: true,
  priority: 1,
  holdAllowed: false,
  holdDurationMinutes: null,
  notes: '',
};

export default function FareManagementPage() {
  const router = useRouter();
  const [rules, setRules] = useState<FareRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Partial<FareRule> | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/fare-management');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setRules(data.rules || []);
    } catch {}
    setLoading(false);
  }, [router]);

  useEffect(() => { loadRules(); }, [loadRules]);

  const handleSave = async () => {
    if (!editingRule?.ruleName) return;
    setSaving(true);
    try {
      const method = editingRule.id ? 'PUT' : 'POST';
      const url = editingRule.id
        ? `/api/admin/fare-management/${editingRule.id}`
        : '/api/admin/fare-management';
      
      await adminFetch(url, {
        method,
        body: JSON.stringify({
          ...editingRule,
          originAirport: editingRule.originAirport || null,
          destinationAirport: editingRule.destinationAirport || null,
          airlineCode: editingRule.airlineCode || null,
          airlineName: editingRule.airlineName || null,
          notes: editingRule.notes || null,
        }),
      });
      setShowForm(false);
      setEditingRule(null);
      await loadRules();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this fare rule?')) return;
    setDeleting(id);
    try {
      await adminFetch(`/api/admin/fare-management/${id}`, { method: 'DELETE' });
      await loadRules();
    } catch {}
    setDeleting(null);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await adminFetch(`/api/admin/fare-management/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !isActive }),
      });
      await loadRules();
    } catch {}
  };

  const openCreate = () => {
    setEditingRule({ ...emptyRule });
    setShowForm(true);
  };

  const openEdit = (rule: FareRule) => {
    setEditingRule({ ...rule });
    setShowForm(true);
  };

  // Stats
  const activeCount = rules.filter(r => r.isActive).length;
  const routeRules = rules.filter(r => r.originAirport && r.destinationAirport);
  const airlineRules = rules.filter(r => r.airlineCode && !r.originAirport);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-400/15 flex items-center justify-center">
              <Tag size={20} className="text-teal-400" />
            </div>
            Fare Management
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            Configure fare types, search versions, and route-specific rules
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] transition-all"
        >
          <Plus size={14} />
          Add Rule
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Rules', value: rules.length, icon: Tag, color: 'text-slate-400' },
          { label: 'Active', value: activeCount, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Route-Specific', value: routeRules.length, icon: Route, color: 'text-blue-400' },
          { label: 'Airline-Specific', value: airlineRules.length, icon: Plane, color: 'text-violet-400' },
        ].map(stat => {
          const StatIcon = stat.icon;
          return (
            <div key={stat.label} className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <StatIcon size={14} className={stat.color} />
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{stat.label}</p>
              </div>
              <p className="text-2xl font-black text-white">{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Form Modal */}
      {showForm && editingRule && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700/50 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
              <h3 className="text-white font-black text-lg">
                {editingRule.id ? 'Edit Fare Rule' : 'Create Fare Rule'}
              </h3>
              <button onClick={() => { setShowForm(false); setEditingRule(null); }} className="p-1.5 text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Rule Name */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Rule Name *</label>
                <input
                  value={editingRule.ruleName || ''}
                  onChange={e => setEditingRule({ ...editingRule, ruleName: e.target.value })}
                  placeholder="e.g. US-India Private Fares"
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-colors"
                />
              </div>

              {/* Fare Type + Search Version */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Fare Type</label>
                  <select
                    value={editingRule.fareType || 'Public'}
                    onChange={e => setEditingRule({ ...editingRule, fareType: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  >
                    {FARE_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Search Version</label>
                  <select
                    value={editingRule.searchVersion || 'v2.2'}
                    onChange={e => setEditingRule({ ...editingRule, searchVersion: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  >
                    {SEARCH_VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Route */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Origin Airport (optional)</label>
                  <input
                    value={editingRule.originAirport || ''}
                    onChange={e => setEditingRule({ ...editingRule, originAirport: e.target.value.toUpperCase() })}
                    placeholder="e.g. JFK"
                    maxLength={3}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Destination Airport (optional)</label>
                  <input
                    value={editingRule.destinationAirport || ''}
                    onChange={e => setEditingRule({ ...editingRule, destinationAirport: e.target.value.toUpperCase() })}
                    placeholder="e.g. DEL"
                    maxLength={3}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] uppercase"
                  />
                </div>
              </div>

              {/* Airline */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Airline Code (optional)</label>
                  <input
                    value={editingRule.airlineCode || ''}
                    onChange={e => setEditingRule({ ...editingRule, airlineCode: e.target.value.toUpperCase() })}
                    placeholder="e.g. AI"
                    maxLength={2}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] uppercase"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Airline Name (optional)</label>
                  <input
                    value={editingRule.airlineName || ''}
                    onChange={e => setEditingRule({ ...editingRule, airlineName: e.target.value })}
                    placeholder="e.g. Air India"
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  />
                </div>
              </div>

              {/* Target + Priority */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Target Environment</label>
                  <select
                    value={editingRule.target || 'Test'}
                    onChange={e => setEditingRule({ ...editingRule, target: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  >
                    {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Priority (higher = first match)</label>
                  <input
                    type="number"
                    value={editingRule.priority || 1}
                    onChange={e => setEditingRule({ ...editingRule, priority: parseInt(e.target.value) || 1 })}
                    min={1}
                    max={100}
                    className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  />
                </div>
              </div>

              {/* Hold Booking */}
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingRule.holdAllowed ?? false}
                    onChange={e => setEditingRule({ ...editingRule, holdAllowed: e.target.checked })}
                    className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-[#1ABC9C] focus:ring-[#1ABC9C]"
                  />
                  <span className="text-slate-300 text-sm font-semibold">Allow Hold Booking</span>
                </label>
                {editingRule.holdAllowed && (
                  <input
                    type="number"
                    value={editingRule.holdDurationMinutes || 60}
                    onChange={e => setEditingRule({ ...editingRule, holdDurationMinutes: parseInt(e.target.value) || 60 })}
                    placeholder="Duration (min)"
                    className="w-32 px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]"
                  />
                )}
              </div>

              {/* Active Toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingRule.isActive ?? true}
                  onChange={e => setEditingRule({ ...editingRule, isActive: e.target.checked })}
                  className="w-4 h-4 rounded bg-slate-800 border-slate-700 text-[#1ABC9C] focus:ring-[#1ABC9C]"
                />
                <span className="text-slate-300 text-sm font-semibold">Active</span>
              </label>

              {/* Notes */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Notes (optional)</label>
                <textarea
                  value={editingRule.notes || ''}
                  onChange={e => setEditingRule({ ...editingRule, notes: e.target.value })}
                  placeholder="Internal notes about this rule..."
                  rows={2}
                  className="w-full px-3.5 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-700/50 flex justify-end gap-3">
              <button
                onClick={() => { setShowForm(false); setEditingRule(null); }}
                className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 text-sm font-semibold hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editingRule.ruleName}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] transition-all disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Saving...' : editingRule.id ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
        </div>
      ) : rules.length === 0 ? (
        <div className="text-center py-20 bg-slate-800/30 border border-slate-700/50 rounded-2xl">
          <Tag size={40} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-semibold">No fare rules configured</p>
          <p className="text-slate-500 text-sm mt-1 mb-4">Create rules to control search versions and fare types per route</p>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085] transition-all"
          >
            <Plus size={14} />
            Create First Rule
          </button>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                {['Status', 'Rule Name', 'Fare Type', 'Route / Airline', 'Version', 'Target', 'Priority', 'Hold', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id} className="border-b border-slate-700/30 hover:bg-white/[0.02] transition-all">
                  <td className="px-4 py-3">
                    <button onClick={() => handleToggle(rule.id, rule.isActive)}>
                      {rule.isActive
                        ? <CheckCircle2 size={16} className="text-emerald-400" />
                        : <XCircle size={16} className="text-slate-500" />
                      }
                    </button>
                  </td>
                  <td className="px-4 py-3 text-white font-semibold">{rule.ruleName}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      rule.fareType === 'Private' ? 'bg-violet-400/15 text-violet-400' :
                      rule.fareType === 'Web' ? 'bg-amber-400/15 text-amber-400' :
                      'bg-blue-400/15 text-blue-400'
                    }`}>
                      {rule.fareType}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {rule.originAirport && rule.destinationAirport ? (
                      <span className="flex items-center gap-1 text-[#1ABC9C] font-mono text-xs font-bold">
                        {rule.originAirport} <ArrowRight size={10} /> {rule.destinationAirport}
                      </span>
                    ) : rule.airlineCode ? (
                      <span className="text-violet-400 text-xs font-bold">{rule.airlineCode} {rule.airlineName ? `(${rule.airlineName})` : ''}</span>
                    ) : (
                      <span className="text-slate-500 text-xs">All routes</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs font-mono text-slate-300 bg-slate-700/50 px-2 py-0.5 rounded">{rule.searchVersion}</code>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold ${rule.target === 'Production' ? 'text-red-400' : 'text-amber-400'}`}>
                      {rule.target}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white text-xs font-bold">{rule.priority}</td>
                  <td className="px-4 py-3">
                    {rule.holdAllowed ? (
                      <span className="text-emerald-400 text-xs">{rule.holdDurationMinutes}m</span>
                    ) : (
                      <span className="text-slate-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openEdit(rule)}
                        className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        disabled={deleting === rule.id}
                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
