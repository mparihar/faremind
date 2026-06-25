// FILE: src/components/agent/AgentTopNavbar.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  PlaneTakeoff,
  Briefcase,
  UserCog,
  XCircle,
  Bell,
  User,
  LogOut,
  ChevronDown,
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

// ── Primary nav links (visible in navbar) ────────────────────────────────────
const PRIMARY_NAV = [
  { href: '/agent/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agent/new-booking', label: 'New Booking', icon: PlaneTakeoff },
  { href: '/agent/bookings', label: 'My Bookings', icon: Briefcase },
];

// ── Dropdown nav links (inside profile menu) ─────────────────────────────────
const DROPDOWN_NAV = [
  { href: '/agent/passenger-updates', label: 'Passenger Updates', icon: UserCog },
  { href: '/agent/cancellations', label: 'Cancellation Requests', icon: XCircle },
  { href: '/agent/notifications', label: 'Notifications', icon: Bell },
  { href: '/agent/profile', label: 'Profile', icon: User },
];

export default function AgentTopNavbar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logoutWithServerRevoke } = useAuthStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
    setDropdownOpen(false);
  }, [pathname]);

  async function handleLogout() {
    try { sessionStorage.removeItem('agentBookingContext'); } catch {}
    await logoutWithServerRevoke();
    router.push('/agent/login');
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-white/10 shadow-2xl">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center h-16 gap-4">

          {/* ── Left: Logo + Brand ──────────────────────────────────────── */}
          <Link href="/agent/dashboard" className="flex items-center group h-16 w-fit shrink-0">
            <div className="flex items-end">
              <img
                src="/FM_IMG_LOGO_TEAL.png"
                alt=""
                className="max-h-[54px] w-auto object-contain mb-[-8px]"
              />
              <div className="flex flex-col items-center -ml-2">
                <img
                  src="/FM_TXT_LOGO.png"
                  alt="FareMind"
                  className="h-[42px] w-auto object-contain flex-shrink-0"
                />
                <div className="flex flex-col items-center w-full -mt-[8px]">
                  <div className="relative w-full h-[1px] mb-[1px]">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent"></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent blur-[1px]"></div>
                  </div>
                  <span className="text-[7px] sm:text-[8px] font-bold uppercase tracking-[0.7em] text-[#009CA6] pl-[0.7em]">
                    Agent Portal
                  </span>
                  <div className="relative w-full h-[1px] mt-[1px]">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent"></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent blur-[1px]"></div>
                  </div>
                </div>
              </div>
            </div>
          </Link>

          {/* ── Center/Right: Primary Nav (Desktop) ─────────────────────── */}
          <div className="hidden md:flex items-center gap-1 ml-10">
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200',
                    active
                      ? 'text-[#1ABC9C] bg-[#1ABC9C]/10 border border-[#1ABC9C]/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                  )}
                >
                  <Icon className={cn('w-4 h-4', active && 'text-[#1ABC9C]')} />
                  {item.label}
                  {active && (
                    <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[#1ABC9C] rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>

          {/* ── Right: Agent Profile (Desktop) ──────────────────────────── */}
          <div className="hidden md:flex items-center gap-3 ml-auto">
            {user && (
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all',
                    dropdownOpen
                      ? 'bg-white/[0.06] text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  )}
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-[#1ABC9C]/20 border-2 border-[#1ABC9C]/40 flex items-center justify-center shrink-0">
                    <span className="text-xs font-black text-[#1ABC9C]">
                      {user.name?.charAt(0).toUpperCase() || '?'}
                    </span>
                  </div>
                  {/* Name + Email */}
                  <div className="text-left min-w-0 hidden lg:block">
                    <p className="text-sm font-semibold text-white truncate leading-tight">
                      {user.name?.split(' ')[0]}
                    </p>
                    <p className="text-xs text-slate-500 truncate leading-tight">
                      {user.email}
                    </p>
                  </div>
                  <ChevronDown className={cn(
                    'w-3.5 h-3.5 text-slate-500 transition-transform duration-200',
                    dropdownOpen && 'rotate-180'
                  )} />
                </button>

                {/* ── Profile Dropdown ─────────────────────────────────────── */}
                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-60 bg-[#0f1525] border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                    {/* Dropdown header */}
                    <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#1ABC9C]/20 border-2 border-[#1ABC9C]/40 flex items-center justify-center shrink-0">
                        <span className="text-sm font-black text-[#1ABC9C]">
                          {user.name?.charAt(0).toUpperCase() || '?'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{user.name?.split(' ')[0]}</p>
                        <p className="text-xs text-slate-500 truncate">{user.email}</p>
                      </div>
                    </div>

                    {/* Nav links */}
                    <div className="py-1.5">
                      {DROPDOWN_NAV.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setDropdownOpen(false)}
                            className={cn(
                              'flex items-center gap-3 px-4 py-2.5 text-sm transition-all',
                              active
                                ? 'text-[#1ABC9C] bg-[#1ABC9C]/[0.06]'
                                : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                            )}
                          >
                            <Icon className={cn('w-4 h-4', active ? 'text-[#1ABC9C]' : 'text-slate-500')} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>

                    {/* Sign Out */}
                    <div className="border-t border-white/[0.06] py-1.5">
                      <button
                        onClick={() => { setDropdownOpen(false); handleLogout(); }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] transition-all"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Mobile: Hamburger ────────────────────────────────────────── */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden ml-auto p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* ── Mobile Menu ─────────────────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden bg-slate-900/98 backdrop-blur-xl border-t border-white/[0.06] shadow-xl">
          <div className="px-4 py-4 space-y-1">
            {/* Primary nav */}
            {PRIMARY_NAV.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                    active
                      ? 'text-[#1ABC9C] bg-[#1ABC9C]/10 border border-[#1ABC9C]/20'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}

            {/* Divider */}
            <div className="pt-2 border-t border-white/[0.06]">
              <p className="px-4 py-2 text-xs text-slate-600 uppercase font-bold tracking-wider">More</p>
              {DROPDOWN_NAV.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all',
                      active
                        ? 'text-[#1ABC9C] bg-[#1ABC9C]/[0.06]'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {/* User info + Sign Out */}
            <div className="pt-2 border-t border-white/[0.06]">
              {user && (
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-full bg-[#1ABC9C]/20 border-2 border-[#1ABC9C]/40 flex items-center justify-center shrink-0">
                    <span className="text-sm font-black text-[#1ABC9C]">
                      {user.name?.charAt(0).toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{user.name?.split(' ')[0]}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/[0.06] transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
