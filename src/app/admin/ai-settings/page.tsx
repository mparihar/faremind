'use client';

import { useEffect, useState } from 'react';
import { adminFetch } from '@/store/useAdminStore';
import {
  Brain, Dna, RefreshCw, Save, Check, ToggleLeft, ToggleRight,
  Globe, Plane, Eye, BarChart3, Sparkles,
} from 'lucide-react';

interface TravelDnaConfigData {
  id: string;
  travelDnaEnabled: boolean;
  minConfirmedBookingsRequired: number;
  domesticRequiredBookings: number;
  internationalRequiredBookings: number;
  domesticProfileEnabled: boolean;
  internationalProfileEnabled: boolean;
  dnaSearchTopN: number;
  showLearningState: boolean;
  showConfidenceScore: boolean;
  updatedByAdminEmail: string | null;
  updatedAt: string | null;
}

function Toggle({
  enabled,
  onChange,
  label,
  description,
  icon: Icon,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex items-start justify-between py-3">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 w-7 h-7 rounded-lg bg-[#1ABC9C]/10 flex items-center justify-center shrink-0">
            <Icon size={14} className="text-[#1ABC9C]" />
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-white">{label}</p>
          {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
        </div>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className="shrink-0 mt-0.5"
      >
        {enabled ? (
          <ToggleRight size={28} className="text-[#1ABC9C]" />
        ) : (
          <ToggleLeft size={28} className="text-slate-600" />
        )}
      </button>
    </div>
  );
}

function ThresholdInput({
  value,
  onChange,
  label,
  description,
  icon: Icon,
  unit = 'bookings',
  max = 50,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  description: string;
  icon: React.ElementType;
  unit?: string;
  max?: number;
}) {
  return (
    <div className="flex items-start justify-between py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 w-7 h-7 rounded-lg bg-[#1ABC9C]/10 flex items-center justify-center shrink-0">
          <Icon size={14} className="text-[#1ABC9C]" />
        </div>
        <div>
          <p className="text-sm font-bold text-white">{label}</p>
          <p className="text-xs text-slate-400 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={1}
          max={max}
          value={value}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v)) onChange(Math.min(max, Math.max(1, v)));
          }}
          className="w-20 px-3 py-2 bg-slate-700 border border-slate-600 rounded-xl text-white text-sm font-bold text-center focus:outline-none focus:border-[#1ABC9C] transition-all tabular-nums"
        />
        <span className="text-slate-500 text-xs">{unit}</span>
      </div>
    </div>
  );
}

export default function AISettingsPage() {
  const [config, setConfig] = useState<TravelDnaConfigData | null>(null);
  const [original, setOriginal] = useState<TravelDnaConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/travel-dna/config');
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      if (data.config) {
        // Backfill defaults for new fields
        const c = {
          ...data.config,
          domesticRequiredBookings: data.config.domesticRequiredBookings ?? data.config.minConfirmedBookingsRequired ?? 5,
          internationalRequiredBookings: data.config.internationalRequiredBookings ?? data.config.minConfirmedBookingsRequired ?? 5,
          dnaSearchTopN: data.config.dnaSearchTopN ?? 30,
        };
        setConfig(c);
        setOriginal(c);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }

  useEffect(() => { loadConfig(); }, []);

  async function saveConfig() {
    if (!config) return;
    setError('');
    setSaving(true);
    setSaved(false);
    try {
      const res = await adminFetch('/api/admin/travel-dna/config', {
        method: 'PUT',
        body: JSON.stringify({
          travelDnaEnabled: config.travelDnaEnabled,
          domesticRequiredBookings: config.domesticRequiredBookings,
          internationalRequiredBookings: config.internationalRequiredBookings,
          domesticProfileEnabled: config.domesticProfileEnabled,
          internationalProfileEnabled: config.internationalProfileEnabled,
          dnaSearchTopN: config.dnaSearchTopN,
          showLearningState: config.showLearningState,
          showConfidenceScore: config.showConfidenceScore,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to save');
        setSaving(false);
        return;
      }
      const c = {
        ...data.config,
        domesticRequiredBookings: data.config.domesticRequiredBookings ?? 5,
        internationalRequiredBookings: data.config.internationalRequiredBookings ?? 5,
        dnaSearchTopN: data.config.dnaSearchTopN ?? 30,
      };
      setConfig(c);
      setOriginal(c);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    }
    setSaving(false);
  }

  const hasChanged = config && original && JSON.stringify(config) !== JSON.stringify(original);

  if (loading) {
    return (
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={20} className="text-[#1ABC9C] animate-spin" />
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-8 max-w-4xl">
        <p className="text-slate-400 text-sm">Failed to load FAREMIND DNA™ configuration.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#1ABC9C]/20 to-[#1ABC9C]/5 border border-[#1ABC9C]/20 flex items-center justify-center">
            <Brain size={22} className="text-[#1ABC9C]" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">AI Settings</h1>
            <p className="text-slate-400 text-sm mt-0.5">My <span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span> DNA™ Configuration</p>
          </div>
        </div>
        <button
          onClick={saveConfig}
          disabled={saving || !hasChanged}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
            saved
              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
              : hasChanged
                ? 'bg-[#1ABC9C] hover:bg-[#1ABC9C]/90 text-white shadow-lg shadow-[#1ABC9C]/20'
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

      {/* DNA Configuration */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#1ABC9C]/10 flex items-center justify-center">
            <Dna size={14} className="text-[#1ABC9C]" />
          </div>
          <div>
            <h2 className="text-white font-bold text-sm">My <span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span> DNA™ Configuration</h2>
            <p className="text-[11px] text-slate-500">Personalized travel intelligence built from confirmed bookings</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-1 divide-y divide-slate-700/30">
          {/* Master Toggle */}
          <Toggle
            enabled={config.travelDnaEnabled}
            onChange={(v) => setConfig({ ...config, travelDnaEnabled: v })}
            label="FAREMIND DNA™ Enabled"
            description="Enable or disable FAREMIND DNA™ for all users"
            icon={Sparkles}
          />

          {/* Domestic Required Bookings */}
          <ThresholdInput
            value={config.domesticRequiredBookings}
            onChange={(v) => setConfig({ ...config, domesticRequiredBookings: v })}
            label="Domestic Required Confirmed Bookings"
            description="Bookings required before Domestic DNA activates (default: 5)"
            icon={Globe}
          />

          {/* International Required Bookings */}
          <ThresholdInput
            value={config.internationalRequiredBookings}
            onChange={(v) => setConfig({ ...config, internationalRequiredBookings: v })}
            label="International Required Confirmed Bookings"
            description="Bookings required before International DNA activates (default: 5)"
            icon={Plane}
          />

          {/* Domestic Profile */}
          <Toggle
            enabled={config.domesticProfileEnabled}
            onChange={(v) => setConfig({ ...config, domesticProfileEnabled: v })}
            label="Domestic Profile"
            description="Enable domestic travel DNA profile (same-country flights)"
            icon={Globe}
          />

          {/* International Profile */}
          <Toggle
            enabled={config.internationalProfileEnabled}
            onChange={(v) => setConfig({ ...config, internationalProfileEnabled: v })}
            label="International Profile"
            description="Enable international travel DNA profile (cross-border flights)"
            icon={Plane}
          />

          {/* DNA Search Top N Cards */}
          <ThresholdInput
            value={config.dnaSearchTopN}
            onChange={(v) => setConfig({ ...config, dnaSearchTopN: v })}
            label="DNA Search Top N Cards"
            description="Number of top AI-scored flight cards eligible for DNA Match scoring"
            icon={Dna}
            unit="cards"
            max={100}
          />

          {/* Show Learning State */}
          <Toggle
            enabled={config.showLearningState}
            onChange={(v) => setConfig({ ...config, showLearningState: v })}
            label="Show Learning State"
            description="Show progress indicator when user hasn't reached minimum bookings"
            icon={Eye}
          />

          {/* Show Confidence Score */}
          <Toggle
            enabled={config.showConfidenceScore}
            onChange={(v) => setConfig({ ...config, showConfidenceScore: v })}
            label="Show Confidence Score"
            description="Display confidence percentage on the FAREMIND DNA™ page"
            icon={BarChart3}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="px-5 pb-4">
            <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          </div>
        )}

        {/* Last updated */}
        {config.updatedByAdminEmail && (
          <div className="px-5 pb-4">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>
                Last updated by{' '}
                <span className="text-slate-400 font-medium">{config.updatedByAdminEmail}</span>
              </span>
              {config.updatedAt && (
                <span>· {new Date(config.updatedAt).toLocaleString()}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Privacy Notice */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-2xl px-5 py-4">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          <strong className="text-slate-400">Privacy:</strong> FAREMIND DNA™ is built from confirmed bookings only.
          Phase 1 does not use searches, clicks, abandoned carts, or browsing behavior.
          Users see a transparency notice on the FAREMIND DNA™ page.
        </p>
      </div>
    </div>
  );
}
