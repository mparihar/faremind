'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, ArrowLeft, Zap, CheckCircle2, XCircle,
  Key, Globe, Server, ExternalLink,
} from 'lucide-react';

interface DuffelConfig {
  isConfigured: boolean;
  apiMode: string;
  providerMode: string;
}

export default function DuffelProviderPage() {
  const router = useRouter();
  const [config, setConfig] = useState<DuffelConfig | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/providers/duffel');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setConfig(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadConfig(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

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
            <div className="w-10 h-10 rounded-xl bg-blue-400/15 flex items-center justify-center">
              <Zap size={20} className="text-blue-400" />
            </div>
            Duffel Configuration
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            NDC Direct — Airline APIs
          </p>
        </div>
      </div>

      {/* Status */}
      <div className={`p-4 rounded-2xl border mb-6 flex items-center gap-3 ${
        config?.isConfigured
          ? 'bg-emerald-400/5 border-emerald-400/20'
          : 'bg-slate-800/50 border-slate-700/50'
      }`}>
        {config?.isConfigured
          ? <CheckCircle2 size={20} className="text-emerald-400" />
          : <XCircle size={20} className="text-slate-500" />
        }
        <div>
          <p className={`text-sm font-bold ${config?.isConfigured ? 'text-emerald-400' : 'text-slate-400'}`}>
            {config?.isConfigured ? 'Duffel Connected' : 'Not Configured'}
          </p>
          <p className="text-slate-500 text-xs">
            {config?.isConfigured
              ? `Mode: ${config.apiMode} — Provider: ${config.providerMode}`
              : 'Set DUFFEL_API_TOKEN environment variable to enable'
            }
          </p>
        </div>
      </div>

      {/* Configuration */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-slate-700/50">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Configuration</p>
        </div>
        <div className="divide-y divide-slate-700/30">
          {[
            { label: 'API Token', value: config?.isConfigured ? '••••••••' : 'Not set', icon: Key },
            { label: 'API Mode', value: config?.apiMode || 'Production', icon: Server },
            { label: 'Provider Mode', value: config?.providerMode || 'BOTH', icon: Globe },
          ].map(field => {
            const Icon = field.icon;
            return (
              <div key={field.label} className="px-5 py-3.5 flex items-center gap-4">
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  <Icon size={14} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{field.label}</p>
                  <p className="text-sm font-semibold text-white mt-0.5">{field.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Endpoints */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-5 mb-6">
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-3">Supported Operations</p>
        <div className="flex flex-wrap gap-2">
          {['Offer Search', 'Create Order', 'Pay Order', 'Order Cancellation', 'Order Changes', 'Seat Maps', 'Airline Info'].map(op => (
            <span key={op} className="px-3 py-1 bg-blue-400/10 border border-blue-400/20 rounded-lg text-blue-400 text-xs font-semibold">
              {op}
            </span>
          ))}
        </div>
      </div>

      <div className="text-center">
        <a
          href="https://duffel.com/docs/api"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-slate-500 text-xs hover:text-slate-300 transition-colors"
        >
          <ExternalLink size={12} />
          View Duffel API Documentation
        </a>
      </div>
    </div>
  );
}
