'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, ArrowLeft, Layers, CheckCircle2, XCircle,
  Shield, Globe, Key, Server, Clock, Zap, AlertTriangle,
  Activity, ExternalLink, Copy, Check,
} from 'lucide-react';

interface MystiflyConfig {
  apiUrl: string;
  username: string;
  accountNumber: string;
  sessionIdPresent: boolean;
  passwordPresent: boolean;
  target: string;
  providerMode: string;
  isConfigured: boolean;
  searchVersion: string;
}

export default function MystiflyProviderPage() {
  const router = useRouter();
  const [config, setConfig] = useState<MystiflyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; responseTimeMs?: number } | null>(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/providers/mystifly');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setConfig(data);
    } catch {}
    setLoading(false);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await adminFetch('/api/admin/providers/mystifly/test', { method: 'POST' });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: 'Connection test failed' });
    }
    setTesting(false);
  }

  useEffect(() => { loadConfig(); }, []);

  const handleCopy = async (key: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  const configFields = [
    { label: 'API URL', value: config?.apiUrl || '—', icon: Globe, sensitive: false, key: 'apiUrl' },
    { label: 'Username', value: config?.username || '—', icon: Key, sensitive: false, key: 'username' },
    { label: 'Account Number', value: config?.accountNumber || '—', icon: Shield, sensitive: false, key: 'accountNumber' },
    { label: 'Password', value: config?.passwordPresent ? '••••••••' : 'Not set', icon: Key, sensitive: true, key: 'password' },
    { label: 'Session ID', value: config?.sessionIdPresent ? '••••••••' : 'Not set (dynamic mode)', icon: Key, sensitive: true, key: 'sessionId' },
    { label: 'Target Environment', value: config?.target || '—', icon: Server, sensitive: false, key: 'target' },
    { label: 'Provider Mode', value: config?.providerMode || '—', icon: Zap, sensitive: false, key: 'providerMode' },
    { label: 'Search Version', value: config?.searchVersion || 'v2.2', icon: Activity, sensitive: false, key: 'searchVersion' },
  ];

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => router.push('/admin/providers')}
          className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-all"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-400/15 flex items-center justify-center">
              <Layers size={20} className="text-violet-400" />
            </div>
            Mystifly Configuration
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            MyFareBox OnePoint API — GDS Aggregator
          </p>
        </div>
      </div>

      {/* Status Banner */}
      <div className={`p-4 rounded-2xl border mb-6 flex items-center justify-between ${
        config?.isConfigured
          ? 'bg-emerald-400/5 border-emerald-400/20'
          : 'bg-red-400/5 border-red-400/20'
      }`}>
        <div className="flex items-center gap-3">
          {config?.isConfigured
            ? <CheckCircle2 size={20} className="text-emerald-400" />
            : <XCircle size={20} className="text-red-400" />
          }
          <div>
            <p className={`text-sm font-bold ${config?.isConfigured ? 'text-emerald-400' : 'text-red-400'}`}>
              {config?.isConfigured ? 'Provider Connected' : 'Provider Not Configured'}
            </p>
            <p className="text-slate-400 text-xs">
              {config?.isConfigured
                ? `Connected to ${config.apiUrl} as ${config.username}`
                : 'Set MYSTIFLY_* environment variables to enable'
              }
            </p>
          </div>
        </div>
        <button
          onClick={testConnection}
          disabled={testing || !config?.isConfigured}
          className="flex items-center gap-2 px-4 py-2 bg-violet-500/15 border border-violet-400/20 rounded-xl text-violet-400 text-sm font-bold hover:bg-violet-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
          Test Connection
        </button>
      </div>

      {/* Test Result */}
      {testResult && (
        <div className={`p-4 rounded-2xl border mb-6 ${
          testResult.success
            ? 'bg-emerald-400/5 border-emerald-400/20'
            : 'bg-red-400/5 border-red-400/20'
        }`}>
          <div className="flex items-center gap-2">
            {testResult.success
              ? <CheckCircle2 size={16} className="text-emerald-400" />
              : <AlertTriangle size={16} className="text-red-400" />
            }
            <p className={`text-sm font-bold ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.message}
            </p>
            {testResult.responseTimeMs != null && (
              <span className="text-slate-400 text-xs ml-auto flex items-center gap-1">
                <Clock size={12} />
                {testResult.responseTimeMs}ms
              </span>
            )}
          </div>
        </div>
      )}

      {/* Configuration Fields */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-slate-700/50">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Environment Configuration</p>
        </div>
        <div className="divide-y divide-slate-700/30">
          {configFields.map(field => {
            const FieldIcon = field.icon;
            return (
              <div key={field.key} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  <FieldIcon size={14} className="text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{field.label}</p>
                  <p className={`text-sm font-semibold mt-0.5 truncate ${
                    field.sensitive ? 'text-slate-500' : 'text-white'
                  }`}>
                    {field.value}
                  </p>
                </div>
                {!field.sensitive && field.value !== '—' && (
                  <button
                    onClick={() => handleCopy(field.key, field.value)}
                    className="p-1.5 rounded-lg bg-white/5 text-slate-400 hover:text-white transition-all"
                  >
                    {copied === field.key ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Target Environment Info */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 mb-6">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">API Endpoints</p>
        <div className="space-y-2">
          {[
            { label: 'Search', path: '/api/v2.2/Search/Flight', method: 'POST' },
            { label: 'Revalidate', path: '/api/v1/Revalidate/Flight', method: 'POST' },
            { label: 'Book', path: '/api/v1/Book/Flight', method: 'POST' },
            { label: 'OrderTicket', path: '/api/v1/OrderTicket', method: 'POST' },
            { label: 'Cancel', path: '/api/v1/Booking/Cancel', method: 'POST' },
            { label: 'TripDetails', path: '/api/v3/TripDetails/{MFRef}', method: 'GET' },
            { label: 'TicketStatus', path: '/api/v1/AirTicketOrderStatus', method: 'POST' },
            { label: 'FareRules', path: '/api/v1/FlightFareRules', method: 'POST' },
            { label: 'SeatMap', path: '/api/v1/SeatMap/Flight', method: 'POST' },
          ].map(ep => (
            <div key={ep.label} className="flex items-center gap-3">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                ep.method === 'GET' ? 'bg-emerald-400/15 text-emerald-400' : 'bg-blue-400/15 text-blue-400'
              }`}>
                {ep.method}
              </span>
              <span className="text-slate-400 text-xs font-semibold">{ep.label}</span>
              <code className="text-[11px] font-mono text-slate-500 ml-auto truncate max-w-[300px]">
                {ep.path}
              </code>
            </div>
          ))}
        </div>
      </div>

      {/* Swagger link */}
      <div className="text-center">
        <a
          href="https://restapidemo.myfarebox.com/api/docs/v1/swagger.json"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-slate-500 text-xs hover:text-slate-300 transition-colors"
        >
          <ExternalLink size={12} />
          View Swagger Documentation
        </a>
      </div>
    </div>
  );
}
