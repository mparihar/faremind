'use client';

import Link from 'next/link';
import { DollarSign, Shield, Heart, ArrowRight } from 'lucide-react';

const SECTIONS = [
  {
    href: '/admin/commercial-settings/platform-fees',
    title: 'Platform Fees',
    description: 'Manage service fees and markup rules. Service fees are displayed to customers; markup is internal only.',
    icon: DollarSign,
    color: 'from-orange-500 to-amber-500',
    border: 'border-orange-500/30',
    badges: ['Service Fee', 'Markup Fee'],
  },
  {
    href: '/admin/commercial-settings/protection-products',
    title: 'Protection Products',
    description: 'Configure price drop protection rules. Set fixed or percentage-based pricing per provider, cabin, or route.',
    icon: Shield,
    color: 'from-[#1ABC9C] to-emerald-500',
    border: 'border-[#1ABC9C]/30',
    badges: ['Price Drop Protection'],
  },
  {
    href: '/admin/commercial-settings/insurance-products',
    title: 'Insurance Products',
    description: 'Manage travel insurance plans from providers. Configure coverage amounts, pricing models, and eligibility.',
    icon: Heart,
    color: 'from-purple-500 to-violet-500',
    border: 'border-purple-500/30',
    badges: ['Travel Insurance'],
  },
];

export default function CommercialSettingsPage() {
  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Commercial Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Manage platform fees, protection products, and travel insurance configuration.
        </p>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {SECTIONS.map(section => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className={`group relative block p-5 rounded-2xl bg-slate-900 border ${section.border} hover:border-opacity-60 transition-all hover:shadow-lg hover:shadow-black/20`}
            >
              {/* Icon */}
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${section.color} flex items-center justify-center mb-4`}>
                <Icon size={18} className="text-white" />
              </div>

              {/* Title */}
              <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
                {section.title}
                <ArrowRight size={14} className="text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
              </h2>

              {/* Description */}
              <p className="text-xs text-slate-400 leading-relaxed mb-3">
                {section.description}
              </p>

              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                {section.badges.map(badge => (
                  <span
                    key={badge}
                    className="px-2 py-0.5 rounded-full bg-white/5 text-[10px] font-bold text-slate-300 border border-white/10"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Info */}
      <div className="mt-8 p-4 rounded-xl bg-slate-800/50 border border-slate-700/50">
        <h3 className="text-sm font-bold text-slate-300 mb-2">💡 How it works</h3>
        <ul className="text-xs text-slate-400 space-y-1.5">
          <li>• <strong className="text-slate-300">Service Fee</strong> is shown as a separate line item to customers.</li>
          <li>• <strong className="text-slate-300">Markup Fee</strong> is internal — it&apos;s added to the displayed fare but never shown separately.</li>
          <li>• <strong className="text-slate-300">Price Protection</strong> & <strong className="text-slate-300">Travel Insurance</strong> are optional products customers can add.</li>
          <li>• Rules are matched by provider, cabin, trip type, and route scope. Highest priority rule wins.</li>
          <li>• All applied fees are snapshotted at booking time for audit compliance.</li>
        </ul>
      </div>
    </div>
  );
}
