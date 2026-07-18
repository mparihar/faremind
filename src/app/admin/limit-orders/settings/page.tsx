'use client';

import { useState } from 'react';
import {
  Settings, Clock, Calendar, Shield, Info, AlertTriangle,
  CheckCircle2, XCircle,
} from 'lucide-react';

/**
 * Admin Limit Order Lifecycle Settings
 *
 * Displays and manages lifecycle configuration:
 * - Travel booking window (180 days default)
 * - Order validity (90 days default)
 * - Purge delay (24 hours default)
 * - Min purchase lead time (24 hours default)
 *
 * Currently read-only — values are system-enforced.
 * Admin can view current policy but changes require deployment-level updates.
 */

const POLICY = {
  travelWindowDays: 180,
  validityDays: 90,
  purgeDelayHours: 24,
  minPurchaseLeadTimeHours: 24,
  policyVersion: '1.0.0',
  autoRenewEnabled: false,
  renewalAllowed: false,
};

const StatusBadge = ({ enabled, label }: { enabled: boolean; label: string }) => (
  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold ${
    enabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
    : 'bg-slate-500/10 text-slate-500 border border-slate-500/20'
  }`}>
    {enabled ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
    {label}
  </div>
);

export default function LimitOrderSettingsPage() {
  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1ABC9C]/15 flex items-center justify-center">
            <Settings size={18} className="text-[#1ABC9C]" />
          </div>
          Lifecycle &amp; Travel Window
        </h1>
        <p className="text-slate-500 text-sm mt-2">
          Configure Limit Order lifecycle policies. Changes apply only to newly created orders.
        </p>
      </div>

      {/* Policy Version */}
      <div className="flex items-center gap-3 mb-6">
        <span className="px-3 py-1.5 rounded-full text-[10px] font-bold bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/20">
          Policy v{POLICY.policyVersion}
        </span>
        <span className="text-slate-600 text-[11px]">System-enforced — requires deployment to modify</span>
      </div>

      {/* Settings Grid */}
      <div className="space-y-4">

        {/* Travel Booking Window */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <Calendar size={16} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Maximum Travel Booking Window</h3>
              <p className="text-slate-500 text-[11px]">How far in advance a customer can set a departure date</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <p className="text-white text-2xl font-black">{POLICY.travelWindowDays}</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Calendar Days</p>
            </div>
            <div className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <p className="text-white text-2xl font-black">
                {new Date(Date.now() + POLICY.travelWindowDays * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Max Departure (Today)</p>
            </div>
          </div>
        </div>

        {/* Order Validity */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <Clock size={16} className="text-amber-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Limit Order Validity</h3>
              <p className="text-slate-500 text-[11px]">Maximum active lifetime from creation</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <p className="text-white text-2xl font-black">{POLICY.validityDays}</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Calendar Days</p>
            </div>
            <div className="flex-1 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <p className="text-white text-2xl font-black">
                {new Date(Date.now() + POLICY.validityDays * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Expiration (If Created Today)</p>
            </div>
          </div>
        </div>

        {/* Renewal Policy */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center">
              <Shield size={16} className="text-red-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Renewal Policy</h3>
              <p className="text-slate-500 text-[11px]">Auto-renew and manual renewal configuration</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <StatusBadge enabled={false} label="Auto-Renew: Disabled" />
            <StatusBadge enabled={false} label="Manual Renewal: Disabled" />
            <StatusBadge enabled={false} label="Extend Expiration: Disabled" />
            <StatusBadge enabled={false} label="Reactivate Expired: Disabled" />
          </div>
          <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/10 text-[11px] text-slate-400">
            <p><strong className="text-red-400">Fixed policy:</strong> Expired orders cannot be reactivated. Customers must create a new Limit Order.</p>
          </div>
        </div>

        {/* Data Lifecycle */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
              <Settings size={16} className="text-purple-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm">Data Lifecycle</h3>
              <p className="text-slate-500 text-[11px]">Post-expiration data handling</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <p className="text-white text-xl font-black">{POLICY.purgeDelayHours}h</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Purge Delay After Expiration</p>
            </div>
            <div className="px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <p className="text-white text-xl font-black">{POLICY.minPurchaseLeadTimeHours}h</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-wider">Min Purchase Lead Time</p>
            </div>
          </div>
          <p className="text-slate-600 text-[10px] mt-3">
            Expired orders are purged {POLICY.purgeDelayHours} hours after expiration. Orders are also expired when departure is within {POLICY.minPurchaseLeadTimeHours} hours to prevent unsafe last-minute purchases.
          </p>
        </div>

        {/* Info */}
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-[11px]">
          <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
          <div className="text-slate-500">
            <p>Configuration changes apply only to newly created Limit Orders. Existing orders retain their original policy snapshot.</p>
            <p className="mt-1">To modify these values, update the backend constants in <code className="text-slate-400">limit-order-validator.ts</code> and redeploy.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
