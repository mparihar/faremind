'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Bell, Smartphone, Mail, Check, X, Loader2, Shield,
  AlertTriangle, Settings, ToggleLeft, ToggleRight, Globe, Lock,
} from 'lucide-react';

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const SMS_PROVIDERS = [
  { value: 'twilio', label: 'Twilio' },
  { value: 'vonage', label: 'Vonage' },
  { value: 'aws_sns', label: 'AWS SNS' },
];

const NOTIFICATION_EVENTS = [
  { value: 'LIMIT_ORDER_MATCHED', label: 'Limit Order Matched' },
  { value: 'LIMIT_ORDER_BOOKED', label: 'Limit Order Auto-Booked' },
  { value: 'LIMIT_ORDER_EXPIRED', label: 'Limit Order Expired' },
  { value: 'LIMIT_ORDER_FAILED', label: 'Limit Order Failed' },
  { value: 'BOOKING_CONFIRMED', label: 'Booking Confirmed' },
  { value: 'PRICE_DROP_ALERT', label: 'Price Drop Alert' },
];

interface SmsConfig {
  enabled: boolean;
  provider: string;
  accountSid: string;
  authToken: string;
  fromNumber: string;
  allowedEvents: string[];
  allowedCountries: string[];
  requireConsent: boolean;
}

const DEFAULT_CONFIG: SmsConfig = {
  enabled: false, provider: 'twilio',
  accountSid: '', authToken: '', fromNumber: '',
  allowedEvents: ['LIMIT_ORDER_MATCHED', 'LIMIT_ORDER_BOOKED'],
  allowedCountries: ['US', 'CA'],
  requireConsent: true,
};

export default function NotificationConfigPage() {
  const [config, setConfig] = useState<SmsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${BACKEND}/api/limit-orders/admin/notification-config`);
        if (res.ok) {
          const data = await res.json();
          if (data.value) {
            setConfig({ ...DEFAULT_CONFIG, ...JSON.parse(data.value) });
          }
        }
      } catch { /* Use defaults */ }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`${BACKEND}/api/limit-orders/admin/notification-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(config), description: 'SMS notification configuration' }),
      });
      if (res.ok) {
        setMessage({ type: 'success', text: 'Configuration saved successfully.' });
      } else {
        setMessage({ type: 'error', text: 'Failed to save configuration.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error.' });
    }
    setSaving(false);
  };

  const toggleEvent = (event: string) => {
    setConfig(c => ({
      ...c,
      allowedEvents: c.allowedEvents.includes(event)
        ? c.allowedEvents.filter(e => e !== event)
        : [...c.allowedEvents, event],
    }));
  };

  const Input = ({ label, value, onChange, type = 'text', placeholder }: any) => (
    <div>
      <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all" />
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-[#1ABC9C]" size={24} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white mb-1 flex items-center gap-2">
          <Settings size={20} className="text-[#1ABC9C]" /> Notification Configuration
        </h1>
        <p className="text-slate-500 text-sm">Configure notification channels for Limit Orders.</p>
      </div>

      {message && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${
            message.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}>
          {message.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
          {message.text}
        </motion.div>
      )}

      {/* Channel Status */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 text-center">
          <Mail size={20} className="mx-auto mb-2 text-emerald-400" />
          <p className="text-white font-bold text-sm">Email</p>
          <p className="text-emerald-400 text-[10px] uppercase font-bold mt-1">Always Enabled</p>
        </div>
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 text-center">
          <Bell size={20} className="mx-auto mb-2 text-emerald-400" />
          <p className="text-white font-bold text-sm">In-App</p>
          <p className="text-emerald-400 text-[10px] uppercase font-bold mt-1">Always Enabled</p>
        </div>
        <div className={`border rounded-2xl p-4 text-center transition-all ${
          config.enabled ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white/[0.03] border-white/[0.08]'
        }`}>
          <Smartphone size={20} className={`mx-auto mb-2 ${config.enabled ? 'text-emerald-400' : 'text-slate-500'}`} />
          <p className="text-white font-bold text-sm">SMS</p>
          <p className={`text-[10px] uppercase font-bold mt-1 ${config.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
            {config.enabled ? 'Enabled' : 'Disabled'}
          </p>
        </div>
      </div>

      {/* SMS Configuration */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-sm flex items-center gap-2">
            <Smartphone size={14} className="text-[#1ABC9C]" /> SMS Configuration
          </h2>
          <button onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
            className="flex items-center gap-2 text-sm transition-all">
            {config.enabled ? (
              <><ToggleRight size={24} className="text-emerald-400" /><span className="text-emerald-400 font-bold text-xs">Enabled</span></>
            ) : (
              <><ToggleLeft size={24} className="text-slate-500" /><span className="text-slate-500 font-bold text-xs">Disabled</span></>
            )}
          </button>
        </div>

        {!config.enabled && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">
            <Shield size={12} />
            SMS is disabled. Email and In-App notifications continue normally.
          </div>
        )}

        {config.enabled && (
          <>
            {/* Provider */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">SMS Provider</label>
              <div className="flex gap-2">
                {SMS_PROVIDERS.map(p => (
                  <button key={p.value} onClick={() => setConfig(c => ({ ...c, provider: p.value }))}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                      config.provider === p.value
                        ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/25'
                        : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:text-white'
                    }`}>{p.label}</button>
                ))}
              </div>
            </div>

            {/* Credentials */}
            <div className="grid grid-cols-2 gap-4">
              <Input label="Account SID" value={config.accountSid}
                onChange={(v: string) => setConfig(c => ({ ...c, accountSid: v }))} placeholder="ACxxxxxxxxxxxxxxxx" />
              <div>
                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  <Lock size={8} className="inline mr-1" />Auth Token
                </label>
                <input type="password" value={config.authToken}
                  onChange={e => setConfig(c => ({ ...c, authToken: e.target.value }))}
                  placeholder="••••••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all" />
              </div>
            </div>

            <Input label="From Number" value={config.fromNumber}
              onChange={(v: string) => setConfig(c => ({ ...c, fromNumber: v }))} placeholder="+1234567890" />

            {/* Allowed Events */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Allowed Notification Events</label>
              <div className="space-y-1.5">
                {NOTIFICATION_EVENTS.map(ev => (
                  <label key={ev.value} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={config.allowedEvents.includes(ev.value)}
                      onChange={() => toggleEvent(ev.value)}
                      className="rounded border-white/20 bg-white/[0.06] text-[#1ABC9C] focus:ring-[#1ABC9C]/30 w-3.5 h-3.5" />
                    <span className="text-white text-xs">{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Country Restrictions */}
            <div>
              <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                <Globe size={10} className="inline mr-1" />Country Restrictions (ISO codes, comma-separated)
              </label>
              <input type="text" value={config.allowedCountries.join(', ')}
                onChange={e => setConfig(c => ({ ...c, allowedCountries: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) }))}
                placeholder="US, CA, GB"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white text-sm placeholder-slate-600 focus:border-[#1ABC9C]/40 focus:outline-none transition-all" />
            </div>

            {/* Consent Toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={config.requireConsent}
                onChange={e => setConfig(c => ({ ...c, requireConsent: e.target.checked }))}
                className="rounded border-white/20 bg-white/[0.06] text-[#1ABC9C] focus:ring-[#1ABC9C]/30 w-4 h-4" />
              <div>
                <p className="text-white text-xs font-bold">Require Customer Consent</p>
                <p className="text-slate-500 text-[10px]">Customers must opt-in to SMS notifications before receiving them.</p>
              </div>
            </label>
          </>
        )}

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] disabled:opacity-40 transition-all shadow-lg shadow-[#1ABC9C]/20">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
