'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import { useAdminStore } from '@/store/useAdminStore';
import { Plus, RefreshCw, X, Shield, Eye, EyeOff, Clock, Save, Check, Zap } from 'lucide-react';

const ROLES = ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT', 'FINANCE', 'READ_ONLY'];
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-400/15 text-red-400',
  OPS_ADMIN:   'bg-orange-400/15 text-orange-400',
  SUPPORT:     'bg-blue-400/15 text-blue-400',
  FINANCE:     'bg-[#1ABC9C]/15 text-[#1ABC9C]',
  READ_ONLY:   'bg-slate-400/15 text-slate-400',
};

// ─── Booking Timer Config Card ────────────────────────────────────────────────

function BookingTimerConfig() {
  const [minutes, setMinutes] = useState(20);
  const [originalMinutes, setOriginalMinutes] = useState(20);
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/system-config');
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      const config = data.configs?.find((c: any) => c.key === 'offer_expiry_minutes');
      if (config) {
        const val = parseInt(config.value, 10);
        setMinutes(isNaN(val) ? 20 : val);
        setOriginalMinutes(isNaN(val) ? 20 : val);
        setUpdatedBy(config.updatedBy ?? null);
        setUpdatedAt(config.updatedAt ?? null);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }

  useEffect(() => { loadConfig(); }, []);

  async function saveConfig() {
    setError('');
    setSaving(true);
    setSaved(false);
    try {
      const res = await adminFetch('/api/admin/system-config', {
        method: 'PUT',
        body: JSON.stringify({
          key: 'offer_expiry_minutes',
          value: String(minutes),
          description: 'Booking checkout timer duration in minutes',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to save');
        setSaving(false);
        return;
      }
      setOriginalMinutes(minutes);
      setUpdatedBy(data.config?.updatedBy ?? null);
      setUpdatedAt(data.config?.updatedAt ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    }
    setSaving(false);
  }

  const hasChanged = minutes !== originalMinutes;

  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex items-center justify-center py-6">
          <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-3">
        <Clock size={16} className="text-amber-400" />
        <h2 className="text-white font-bold text-sm">Booking Timer Configuration</h2>
      </div>

      <div className="px-5 py-5 space-y-5">
        {/* Description */}
        <p className="text-xs text-slate-400 leading-relaxed">
          Configure how long customers have to complete checkout after selecting a fare.
          This timer appears on all checkout pages and the booking expires when it reaches zero.
        </p>

        {/* Timer input */}
        <div className="flex items-end gap-4">
          <div className="flex-1 max-w-xs">
            <label className="block text-xs font-bold text-slate-300 mb-2">
              Offer Expiry Duration
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={5}
                max={60}
                value={minutes}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setMinutes(Math.min(60, Math.max(5, v)));
                }}
                className="w-24 px-3 py-2.5 bg-slate-700 border border-slate-600 rounded-xl text-white text-sm font-bold text-center focus:outline-none focus:border-[#1ABC9C] transition-all tabular-nums"
              />
              <span className="text-slate-400 text-sm font-medium">minutes</span>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5">
              Min: 5 min · Max: 60 min · Default: 20 min
            </p>
          </div>

          {/* Save button */}
          <button
            onClick={saveConfig}
            disabled={saving || !hasChanged}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              saved
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : hasChanged
                  ? 'bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {saved ? (
              <><Check size={14} /> Saved</>
            ) : saving ? (
              <><RefreshCw size={14} className="animate-spin" /> Saving…</>
            ) : (
              <><Save size={14} /> Save</>
            )}
          </button>
        </div>

        {/* Range slider visual */}
        <div className="pt-1">
          <input
            type="range"
            min={5}
            max={60}
            step={1}
            value={minutes}
            onChange={e => setMinutes(parseInt(e.target.value, 10))}
            className="w-full max-w-xs h-1.5 bg-slate-600 rounded-full appearance-none cursor-pointer accent-[#1ABC9C]"
          />
          <div className="flex justify-between max-w-xs text-[10px] text-slate-500 mt-1">
            <span>5 min</span>
            <span>20 min</span>
            <span>40 min</span>
            <span>60 min</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Last updated info */}
        {updatedBy && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
            <span>Last updated by <span className="text-slate-400 font-medium">{updatedBy}</span></span>
            {updatedAt && (
              <span>· {new Date(updatedAt).toLocaleString()}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Rate Limit Config Card ──────────────────────────────────────────────────

/**
 * Rate limit endpoint definitions.
 * Each maps to a SystemConfig key (rate_limit_{key}_per_minute) in the DB.
 */
const RATE_LIMIT_ENDPOINTS = [
  { key: 'login',           label: 'Login / Auth',        defaultVal: 10,  description: 'check-user, verify-otp' },
  { key: 'signup',          label: 'Signup',              defaultVal: 5,   description: 'register' },
  { key: 'otp',             label: 'OTP Send / Resend',   defaultVal: 5,   description: 'send-otp, resend-otp' },
  { key: 'forgot_password', label: 'Forgot Password',     defaultVal: 5,   description: 'password reset' },
  { key: 'flight_search',   label: 'Flight Search',       defaultVal: 60,  description: 'search, flex-search, fares' },
  { key: 'booking',         label: 'Booking / Checkout',  defaultVal: 20,  description: 'book, checkout, cancel' },
  { key: 'payment',         label: 'Payment',             defaultVal: 10,  description: 'payment-intent, confirm' },
  { key: 'contact',         label: 'Contact / Support',   defaultVal: 10,  description: 'contact form' },
];

function RateLimitConfig() {
  const [enabled, setEnabled] = useState(true);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<{ enabled: boolean; limits: Record<string, string> }>({ enabled: true, limits: {} });
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/system-config');
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      const configs: any[] = data.configs ?? [];

      // Read enabled flag
      const enabledConfig = configs.find((c: any) => c.key === 'rate_limit_enabled');
      const isEnabled = enabledConfig ? enabledConfig.value === 'true' : true;
      setEnabled(isEnabled);

      // Read per-endpoint limits
      const loadedLimits: Record<string, string> = {};
      let latestUpdatedBy: string | null = null;
      let latestUpdatedAt: string | null = null;

      for (const ep of RATE_LIMIT_ENDPOINTS) {
        const dbKey = `rate_limit_${ep.key}_per_minute`;
        const config = configs.find((c: any) => c.key === dbKey);
        loadedLimits[ep.key] = config ? config.value : String(ep.defaultVal);

        if (config?.updatedAt) {
          if (!latestUpdatedAt || new Date(config.updatedAt) > new Date(latestUpdatedAt)) {
            latestUpdatedAt = config.updatedAt;
            latestUpdatedBy = config.updatedBy ?? null;
          }
        }
      }

      // Check if enabled config has a more recent update
      if (enabledConfig?.updatedAt) {
        if (!latestUpdatedAt || new Date(enabledConfig.updatedAt) > new Date(latestUpdatedAt)) {
          latestUpdatedAt = enabledConfig.updatedAt;
          latestUpdatedBy = enabledConfig.updatedBy ?? null;
        }
      }

      setLimits(loadedLimits);
      setOriginal({ enabled: isEnabled, limits: { ...loadedLimits } });
      setUpdatedBy(latestUpdatedBy);
      setUpdatedAt(latestUpdatedAt);
    } catch {
      // ignore
    }
    setLoading(false);
  }

  useEffect(() => { loadConfig(); }, []);

  function hasChanges(): boolean {
    if (enabled !== original.enabled) return true;
    for (const ep of RATE_LIMIT_ENDPOINTS) {
      if (limits[ep.key] !== original.limits[ep.key]) return true;
    }
    return false;
  }

  async function saveAll() {
    setError('');
    setSaving(true);
    setSaved(false);

    try {
      // Save enabled flag
      if (enabled !== original.enabled) {
        const res = await adminFetch('/api/admin/system-config', {
          method: 'PUT',
          body: JSON.stringify({
            key: 'rate_limit_enabled',
            value: String(enabled),
            description: 'Global rate limiting toggle',
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? 'Failed to save enabled flag');
          setSaving(false);
          return;
        }
      }

      // Save changed limits
      for (const ep of RATE_LIMIT_ENDPOINTS) {
        if (limits[ep.key] !== original.limits[ep.key]) {
          const res = await adminFetch('/api/admin/system-config', {
            method: 'PUT',
            body: JSON.stringify({
              key: `rate_limit_${ep.key}_per_minute`,
              value: limits[ep.key],
              description: `Rate limit: ${ep.label} (requests per minute)`,
            }),
          });
          if (!res.ok) {
            const data = await res.json();
            setError(data.error ?? `Failed to save ${ep.label}`);
            setSaving(false);
            return;
          }
        }
      }

      // Refresh from DB to get latest updatedBy/updatedAt
      await loadConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
        <div className="flex items-center justify-center py-6">
          <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap size={16} className="text-amber-400" />
          <h2 className="text-white font-bold text-sm">API Rate Limiting</h2>
        </div>
        {/* Global toggle */}
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
            enabled ? 'bg-[#1ABC9C]' : 'bg-slate-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className="px-5 py-5 space-y-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          Configure per-endpoint rate limits (requests per minute per IP).
          Changes take effect within 60 seconds on the backend without restart.
        </p>

        {!enabled && (
          <div className="bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
            <p className="text-amber-400 text-xs font-medium">
              ⚠ Rate limiting is disabled. All API endpoints are unprotected.
            </p>
          </div>
        )}

        {/* Endpoint limits table */}
        <div className={`space-y-0 rounded-xl border border-slate-700/50 overflow-hidden ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
          {RATE_LIMIT_ENDPOINTS.map((ep, i) => (
            <div
              key={ep.key}
              className={`flex items-center justify-between px-4 py-3 ${
                i < RATE_LIMIT_ENDPOINTS.length - 1 ? 'border-b border-slate-700/30' : ''
              } hover:bg-white/[0.02] transition-colors`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-semibold">{ep.label}</p>
                <p className="text-slate-500 text-[10px] mt-0.5">{ep.description}</p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={limits[ep.key] ?? ep.defaultVal}
                  onChange={e => {
                    const v = e.target.value;
                    setLimits(prev => ({ ...prev, [ep.key]: v }));
                  }}
                  className="w-20 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm font-bold text-center focus:outline-none focus:border-[#1ABC9C] transition-all tabular-nums"
                />
                <span className="text-slate-500 text-[10px] font-medium whitespace-nowrap">/min</span>
              </div>
            </div>
          ))}
        </div>

        {/* Save button + defaults hint */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-[10px] text-slate-600">Default values are OTA-standard relaxed limits</p>
          <button
            onClick={saveAll}
            disabled={saving || !hasChanges()}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              saved
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : hasChanges()
                  ? 'bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {saved ? (
              <><Check size={14} /> Saved</>
            ) : saving ? (
              <><RefreshCw size={14} className="animate-spin" /> Saving…</>
            ) : (
              <><Save size={14} /> Save Changes</>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Last updated info */}
        {updatedBy && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1">
            <span>Last updated by <span className="text-slate-400 font-medium">{updatedBy}</span></span>
            {updatedAt && (
              <span>· {new Date(updatedAt).toLocaleString()}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
          <p className="text-slate-400 text-sm mt-0.5">Admin users &amp; system configuration</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white text-sm font-bold rounded-xl transition-all">
            <Plus size={14} />
            Add Admin User
          </button>
        )}
      </div>

      {/* Booking Timer Configuration */}
      <div className="mb-6">
        <BookingTimerConfig />
      </div>

      {/* Rate Limit Configuration */}
      <div className="mb-6">
        <RateLimitConfig />
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
