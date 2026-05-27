'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, Plane, TrendingDown, Plus, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface PriceAlert {
  id: string;
  origin: string;
  destination: string;
  targetPrice: number;
  currentPrice: number;
  currency: string;
  active: boolean;
  createdAt: string;
}

const DEMO_ALERTS: PriceAlert[] = [];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>(DEMO_ALERTS);

  function toggleAlert(id: string) {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a));
  }

  function removeAlert(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }

  const fmt = (n: number, c = 'USD') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Price Alerts</h1>
          <p className="text-slate-500 text-sm mt-0.5">Get notified when prices drop on your saved routes</p>
        </div>
        <Link href="/"
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all">
          <Plus size={14} />
          Add Alert
        </Link>
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
            <Bell size={24} className="text-slate-600" />
          </div>
          <p className="text-white font-bold mb-1">No price alerts yet</p>
          <p className="text-slate-500 text-sm mb-5">
            Search for a flight and click "Track Price" to get notified when fares drop.
          </p>
          <Link href="/"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1ABC9C] text-white text-sm font-bold hover:bg-[#16a085] transition-all">
            <Plane size={14} />
            Search Flights
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert, i) => {
            const savings = alert.currentPrice - alert.targetPrice;
            const hasDrop = savings > 0;
            return (
              <motion.div key={alert.id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-white font-black text-lg">{alert.origin}</span>
                      <Plane size={12} className="text-[#1ABC9C] rotate-90" />
                      <span className="text-white font-black text-lg">{alert.destination}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${alert.active ? 'bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/20' : 'bg-white/[0.04] text-slate-500 border border-white/[0.08]'}`}>
                        {alert.active ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Target Price</p>
                        <p className="text-[#1ABC9C] font-bold">{fmt(alert.targetPrice, alert.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold">Current</p>
                        <p className={`font-bold ${hasDrop ? 'text-emerald-400' : 'text-white'}`}>
                          {fmt(alert.currentPrice, alert.currency)}
                        </p>
                      </div>
                      {hasDrop && (
                        <div className="flex items-center gap-1 text-emerald-400 text-xs font-bold">
                          <TrendingDown size={13} />
                          {fmt(savings, alert.currency)} below target
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => toggleAlert(alert.id)}
                      className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white transition-all">
                      {alert.active ? <Bell size={15} /> : <BellOff size={15} />}
                    </button>
                    <button onClick={() => removeAlert(alert.id)}
                      className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-red-400 transition-all">
                      <X size={15} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
