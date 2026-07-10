'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/store/useAdminStore';
import {
  RefreshCw, AlertTriangle, ChevronDown, ChevronRight,
  ArrowRight, Clock, Code2, Copy, Check,
} from 'lucide-react';
import { format } from 'date-fns';

interface ProviderError {
  id: string;
  bookingId: string | null;
  provider: string;
  payloadType: string;
  providerReference: string | null;
  payloadJson: any;
  createdAt: string;
  booking?: {
    masterBookingReference: string;
    customerEmail: string;
  } | null;
}

export default function ProviderErrorsPage() {
  const router = useRouter();
  const [errors, setErrors] = useState<ProviderError[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function loadErrors() {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/operations/provider-errors');
      if (res.status === 401) { router.replace('/admin/login'); return; }
      const data = await res.json();
      setErrors(data.errors || []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadErrors(); }, []);

  const handleCopy = async (id: string, json: any) => {
    await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-400/15 flex items-center justify-center">
              <AlertTriangle size={20} className="text-orange-400" />
            </div>
            Provider Errors
          </h1>
          <p className="text-slate-400 text-sm mt-1 ml-[52px]">
            Recent API failures from flight providers (last 24h)
          </p>
        </div>
        <button
          onClick={loadErrors}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && errors.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
        </div>
      ) : errors.length === 0 ? (
        <div className="text-center py-20">
          <Check size={40} className="text-emerald-400 mx-auto mb-3 opacity-50" />
          <p className="text-slate-400 font-semibold">No provider errors in the last 24 hours</p>
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map(err => (
            <div
              key={err.id}
              className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => setExpanded(expanded === err.id ? null : err.id)}
                className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-white/[0.02] transition-all"
              >
                {expanded === err.id ? (
                  <ChevronDown size={14} className="text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-slate-400 shrink-0" />
                )}

                <span className="px-2 py-0.5 rounded bg-orange-400/15 text-orange-400 text-[10px] font-bold uppercase">
                  {err.provider}
                </span>
                <span className="px-2 py-0.5 rounded bg-slate-700/50 text-slate-300 text-[10px] font-bold uppercase">
                  {err.payloadType}
                </span>

                {err.providerReference && (
                  <code className="text-[11px] font-mono text-[#1ABC9C] bg-[#1ABC9C]/10 px-2 py-0.5 rounded">
                    {err.providerReference}
                  </code>
                )}

                <span className="text-slate-500 text-xs ml-auto flex items-center gap-1.5">
                  <Clock size={12} />
                  {format(new Date(err.createdAt), 'HH:mm:ss')}
                </span>

                {err.payloadJson?.error && (
                  <span className="text-red-400 text-xs font-semibold truncate max-w-[300px]">
                    {typeof err.payloadJson.error === 'string' ? err.payloadJson.error : 'Error'}
                  </span>
                )}
              </button>

              {expanded === err.id && (
                <div className="px-5 pb-4 border-t border-slate-700/30">
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      {err.booking && (
                        <button
                          onClick={() => router.push(`/admin/bookings/${err.bookingId}`)}
                          className="text-blue-400 hover:text-blue-300 text-xs font-semibold transition-colors"
                        >
                          {err.booking.masterBookingReference} →
                        </button>
                      )}
                      <span className="text-slate-500 text-xs">
                        {format(new Date(err.createdAt), 'dd MMM yyyy, HH:mm:ss')}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopy(err.id, err.payloadJson)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 rounded-lg text-xs text-slate-300 hover:text-white transition-all"
                    >
                      {copied === err.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      {copied === err.id ? 'Copied' : 'Copy JSON'}
                    </button>
                  </div>
                  <pre className="bg-slate-900/80 rounded-xl p-4 text-xs text-slate-300 font-mono overflow-x-auto max-h-[400px] overflow-y-auto">
                    {JSON.stringify(err.payloadJson, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
