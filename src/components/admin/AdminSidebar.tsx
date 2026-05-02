'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminStore } from '@/store/useAdminStore';
import {
  LayoutDashboard, BookOpen, GitMerge, Users2, DollarSign,
  ScrollText, Bell, Settings, LogOut, Shield, ChevronRight,
} from 'lucide-react';
import type { AdminRole } from '@/store/useAdminStore';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  minRole?: AdminRole;
  badge?: string;
}

const NAV: NavItem[] = [
  { href: '/admin/dashboard',    label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/admin/bookings',     label: 'Bookings',      icon: BookOpen },
  { href: '/admin/work-queues',  label: 'Work Queues',   icon: GitMerge },
  { href: '/admin/partners',     label: 'Partners',      icon: Users2, minRole: 'OPS_ADMIN' },
  { href: '/admin/finance',      label: 'Finance',       icon: DollarSign, minRole: 'FINANCE' },
  { href: '/admin/audit-logs',   label: 'Audit Logs',    icon: ScrollText, minRole: 'OPS_ADMIN' },
  { href: '/admin/settings',     label: 'Settings',      icon: Settings, minRole: 'SUPER_ADMIN' },
];

const ROLE_RANK: Record<AdminRole, number> = {
  SUPER_ADMIN: 5, OPS_ADMIN: 4, FINANCE: 3, SUPPORT: 2, READ_ONLY: 1,
};

function canAccess(userRole: AdminRole, minRole?: AdminRole) {
  if (!minRole) return true;
  return ROLE_RANK[userRole] >= ROLE_RANK[minRole];
}

export default function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearAuth } = useAdminStore();

  async function handleLogout() {
    await fetch('/api/admin/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    clearAuth();
    router.replace('/admin/login');
  }

  if (!user) return null;

  return (
    <aside className="w-64 min-h-screen bg-slate-900 border-r border-slate-700/50 flex flex-col">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1ABC9C]/20 border border-[#1ABC9C]/30 flex items-center justify-center">
            <Shield size={16} className="text-[#1ABC9C]" />
          </div>
          <div>
            <p className="text-white font-black text-sm leading-tight">FareMind</p>
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Admin Console</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV.filter(item => canAccess(user.role, item.minRole)).map(item => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group ${
                active
                  ? 'bg-[#1ABC9C]/15 text-[#1ABC9C]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {active && <ChevronRight size={12} className="opacity-60" />}
            </Link>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div className="px-3 py-4 border-t border-slate-700/50">
        <div className="px-3 py-2 mb-1">
          <p className="text-white text-sm font-bold leading-tight truncate">{user.fullName}</p>
          <p className="text-slate-400 text-xs truncate">{user.email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-[#1ABC9C]/10 text-[#1ABC9C] text-[10px] font-bold">
            {user.role.replace('_', ' ')}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:text-red-400 hover:bg-red-400/5 transition-all"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
