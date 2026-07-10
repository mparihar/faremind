'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, Plug2, CheckCircle2, XCircle, ArrowRight,
  Globe, Zap, Layers, Settings2, Clock,
} from 'lucide-react';

interface ProviderStatus {
  configured: boolean;
  type: string;
  description: string;
}

interface ProviderHealth {
  duffel: ProviderStatus;
  amadeus: ProviderStatus;
  mystifly: ProviderStatus;
}

const PROVIDER_CONFIG = [
  {
    key: 'mystifly',
    name: 'Mystifly (MyFareBox)',
    subtitle: 'GDS Aggregator — OnePoint API',
    icon: Layers,
    color: { bg: 'bg-violet-400/5', border: 'border-violet-400/20', text: 'text-violet-400', iconBg: 'bg-violet-400/15' },
    href: '/admin/providers/mystifly',
    features: ['Search v2.2', 'Revalidation', 'BookFlight', 'OrderTicket', 'Cancellation', 'Fare Rules', 'Seat Map'],
  },
  {
    key: 'duffel',
    name: 'Duffel',
    subtitle: 'NDC Direct — Airline APIs',
    icon: Zap,
    color: { bg: 'bg-blue-400/5', border: 'border-blue-400/20', text: 'text-blue-400', iconBg: 'bg-blue-400/15' },
    href: '/admin/providers/duffel',
    features: ['Offer Search', 'Create Order', 'Pay Order', 'Cancellation', 'Order Changes'],
  },
  {
    key: 'amadeus',
    name: 'Amadeus',
    subtitle: 'GDS — Future Integration',
    icon: Globe,
    color: { bg: 'bg-amber-400/5', border: 'border-amber-400/20', text: 'text-amber-400', iconBg: 'bg-amber-400/15' },
    href: null,
    features: ['Flight Offers Search', 'Flight Price', 'Create Order', 'Seat Maps'],
  },
];

export default function ProvidersPage() {
  const router = useRouter();
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadHealth() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/providers/health');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setHealth(data);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadHealth(); }, []);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-400/15 flex items-center justify-center">
              <Plug2 size={20} className="text-violet-400" />
            </div>
            Provider Management
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            Flight data providers, API credentials, and configuration
          </p>
        </div>
        <button
          onClick={loadHealth}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {PROVIDER_CONFIG.map(provider => {
          const Icon = provider.icon;
          const c = provider.color;
          const status = health?.[provider.key as keyof ProviderHealth];
          const isConfigured = status?.configured ?? false;

          return (
            <div
              key={provider.key}
              className={`${c.bg} border ${c.border} rounded-2xl p-6 relative overflow-hidden`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl ${c.iconBg} flex items-center justify-center`}>
                    <Icon size={24} className={c.text} />
                  </div>
                  <div>
                    <h3 className="text-white font-black text-sm">{provider.name}</h3>
                    <p className="text-slate-400 text-xs">{provider.subtitle}</p>
                  </div>
                </div>
                {/* Status badge */}
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                  isConfigured
                    ? 'bg-emerald-400/15 text-emerald-400 border-emerald-400/20'
                    : 'bg-slate-700/50 text-slate-400 border-slate-600/30'
                }`}>
                  {isConfigured ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {isConfigured ? 'Connected' : 'Not Configured'}
                </span>
              </div>

              {/* Type badge */}
              <div className="mb-4">
                <span className={`px-2.5 py-1 rounded-lg ${c.iconBg} ${c.text} text-[10px] font-black uppercase tracking-wider`}>
                  {status?.type || provider.subtitle.split('—')[0].trim()}
                </span>
              </div>

              {/* Features */}
              <div className="mb-5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Supported Operations</p>
                <div className="flex flex-wrap gap-1.5">
                  {provider.features.map(f => (
                    <span key={f} className="px-2 py-0.5 bg-white/5 border border-slate-700/50 rounded text-[10px] text-slate-400 font-medium">
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              {/* Action */}
              {provider.href ? (
                <button
                  onClick={() => router.push(provider.href!)}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 ${c.iconBg} rounded-xl ${c.text} text-sm font-bold hover:opacity-80 transition-all`}
                >
                  <Settings2 size={14} />
                  Configure
                  <ArrowRight size={14} />
                </button>
              ) : (
                <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-700/30 rounded-xl text-slate-500 text-sm font-bold cursor-not-allowed">
                  <Clock size={14} />
                  Coming Soon
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
