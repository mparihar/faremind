'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { ToggleLeft, ToggleRight, RefreshCw, Plus, Save, Trash2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Admin System — Feature Flags
 * Manages SystemConfig entries used as feature flags.
 * NEW page — does not modify any existing admin pages.
 * DB-driven via the existing SystemConfig table.
 */

export default function FeatureFlagsPage() {
  const router = useRouter();
  const [configs, setConfigs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Add new
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/system/feature-flags');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setConfigs(data.configs || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSave(id: string) {
    setSaving(true);
    try {
      await adminFetch('/api/admin/system/feature-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, value: editValue }),
      });
      setEditingId(null);
      load();
    } catch {}
    setSaving(false);
  }

  async function handleAdd() {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    try {
      await adminFetch('/api/admin/system/feature-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim(), value: newValue.trim(), description: newDesc.trim() }),
      });
      setShowAdd(false);
      setNewKey('');
      setNewValue('');
      setNewDesc('');
      load();
    } catch {}
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this config entry?')) return;
    try {
      await adminFetch('/api/admin/system/feature-flags', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      load();
    } catch {}
  }

  const filtered = configs.filter(c =>
    !search || c.key.toLowerCase().includes(search.toLowerCase()) || c.description?.toLowerCase().includes(search.toLowerCase())
  );

  const isBoolFlag = (v: string) => v === 'true' || v === 'false';

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/15 flex items-center justify-center">
              <ToggleRight size={20} className="text-amber-400" />
            </div>
            Feature Flags & System Config
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">Database-driven configuration via SystemConfig</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] rounded-xl text-white text-sm font-bold hover:bg-[#16a085]">
            <Plus size={14} /> Add Config
          </button>
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search configs..."
            className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C]" />
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-slate-800/50 border border-[#1ABC9C]/20 rounded-xl p-4 mb-4 space-y-3">
          <p className="text-white font-bold text-sm">New Config Entry</p>
          <input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="Key (e.g. mystifly_ptr_enabled)"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value (e.g. true, 60, production)"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm font-mono focus:outline-none focus:border-[#1ABC9C]" />
          <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-[#1ABC9C]" />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !newKey.trim() || !newValue.trim()}
              className="px-4 py-2 bg-[#1ABC9C] rounded-lg text-white text-sm font-bold disabled:opacity-50">
              {saving ? 'Saving...' : 'Create'}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-slate-700 rounded-lg text-slate-300 text-sm font-bold">Cancel</button>
          </div>
        </div>
      )}

      {/* Config List */}
      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw size={24} className="animate-spin text-slate-500" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 hover:bg-slate-800/50 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-mono font-bold text-white">{c.key}</span>
                    {isBoolFlag(c.value) && (
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border',
                        c.value === 'true' ? 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20' : 'bg-red-400/15 text-red-400 border-red-400/20'
                      )}>
                        {c.value === 'true' ? 'ON' : 'OFF'}
                      </span>
                    )}
                  </div>
                  {c.description && <p className="text-xs text-slate-500">{c.description}</p>}
                  {editingId === c.id ? (
                    <div className="flex gap-2 mt-2">
                      <input value={editValue} onChange={e => setEditValue(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-slate-800 border border-[#1ABC9C]/30 rounded-lg text-white text-sm font-mono focus:outline-none" />
                      <button onClick={() => handleSave(c.id)} disabled={saving}
                        className="px-3 py-1.5 bg-[#1ABC9C] rounded-lg text-white text-xs font-bold disabled:opacity-50"><Save size={12} /></button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-slate-700 rounded-lg text-slate-300 text-xs font-bold">Cancel</button>
                    </div>
                  ) : (
                    <p className="text-xs text-[#1ABC9C] font-mono mt-0.5">{c.value}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {editingId !== c.id && (
                    <button onClick={() => { setEditingId(c.id); setEditValue(c.value); }}
                      className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white text-xs font-bold">Edit</button>
                  )}
                  {isBoolFlag(c.value) && editingId !== c.id && (
                    <button onClick={() => { setEditValue(c.value === 'true' ? 'false' : 'true'); setEditingId(c.id); setTimeout(() => handleSave(c.id), 100); }}
                      className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white">
                      {c.value === 'true' ? <ToggleRight size={16} className="text-emerald-400" /> : <ToggleLeft size={16} className="text-slate-400" />}
                    </button>
                  )}
                  <button onClick={() => handleDelete(c.id)} className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-600">
                {c.updatedBy && <span>Last updated by: {c.updatedBy}</span>}
                <span>Updated: {new Date(c.updatedAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">No configs found</div>
          )}
        </div>
      )}
    </div>
  );
}
