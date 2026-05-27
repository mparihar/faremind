'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane,
  LayoutDashboard,
  User,
  Menu,
  X,
  LogIn,
  LogOut,
  Shield,
  Bell,
  TrendingDown,
  XCircle,
  CreditCard,
  Wallet,
  Headphones,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { useAdminStore } from '@/store/useAdminStore';

const NAV_ITEMS = [
  { href: '/', label: 'Search', icon: Plane },
  { href: '/account', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/manage-booking', label: 'Manage Booking', icon: Shield },
];

const HELP_ITEMS = [
  { label: 'Flight Cancellation', icon: XCircle, href: '/manage-booking', auth: false },
  { label: 'Refund & Credit', icon: CreditCard, href: '/account/refunds', auth: true },
  { label: 'Make a Payment', icon: Wallet, href: '/manage-booking', auth: false },
  { label: 'Contact Support', icon: Headphones, href: '/account/support', auth: true },
];

/** Circular avatar component — shows user image or fallback initial */
function UserAvatar({ user, size = 28 }: { user: { name?: string; avatar?: string | null }; size?: number }) {
  const initial = user.name?.charAt(0).toUpperCase() || '?';

  if (user.avatar) {
    return (
      <div
        className="relative rounded-full overflow-hidden border-2 border-[#1ABC9C]/40 shadow-[0_0_8px_rgba(26,188,156,0.25)] flex-shrink-0"
        style={{ width: size, height: size }}
      >
        <img
          src={user.avatar}
          alt={user.name || 'User avatar'}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className="rounded-full bg-[#1ABC9C]/20 border-2 border-[#1ABC9C]/40 flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <span className="font-black text-[#1ABC9C]" style={{ fontSize: size * 0.4 }}>{initial}</span>
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [helpDropdown, setHelpDropdown] = useState(false);
  const { user, loadSession, logout } = useAuthStore();
  const { user: adminUser, clearAuth: clearAdminAuth } = useAdminStore();
  const userRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  // Refresh auth state on mount and route changes (e.g., after login redirect)
  useEffect(() => { loadSession(); }, [loadSession, pathname]);

  function handleLogout() {
    logout();
    router.push('/');
  }

  /** Navigate to href if logged in, otherwise redirect to login with return URL */
  function authGuardedNav(href: string) {
    if (user) {
      router.push(href);
    } else {
      router.push(`/auth/login?redirect=${encodeURIComponent(href)}`);
    }
  }

  async function adminLogout() {
    await fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'include' });
    clearAdminAuth();
  }

  // Load session on mount
  useEffect(() => {
    loadSession();
  }, [loadSession]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userRef.current && !userRef.current.contains(e.target as Node)) setUserDropdown(false);
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpDropdown(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-white/10 shadow-2xl">
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center group h-16 overflow-hidden">
            <img 
              src="/logo.png" 
              alt="FareMind" 
              className="h-[96px] w-auto object-contain"
            />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              // Route logged-in users to dashboard inner page, guests to public portal
              const href = (item.href === '/manage-booking' && user) ? '/account/manage-booking' : item.href;

              // Dashboard (/account/bookings) should be active for ALL /account/* pages
              const isActive = item.href === '/account'
                ? pathname.startsWith('/account')
                : pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
              return (
                <Link
                  key={item.href}
                  href={href}
                  className={cn(
                    'relative flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200',
                    isActive
                      ? 'text-white bg-white/[0.08] border border-white/[0.08]'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.05] border border-transparent'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}

            {/* Help & Support Dropdown */}
            <div ref={helpRef} className="relative">
              <button
                onClick={() => { setHelpDropdown(!helpDropdown); setUserDropdown(false); }}
                className={cn(
                  'relative flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-300',
                  (helpDropdown || ['/account/support', '/account/refunds'].some(p => pathname.startsWith(p)))
                    ? 'text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
                )}
              >
                <Headphones className="w-4 h-4 relative z-10" />
                <span className="relative z-10">Help & Support</span>
                <ChevronDown className={cn('w-3.5 h-3.5 relative z-10 transition-transform duration-200', helpDropdown && 'rotate-180')} />
                {(helpDropdown || ['/account/support', '/account/refunds'].some(p => pathname.startsWith(p))) && (
                  <div className="absolute inset-0 bg-white/[0.08] border border-white/[0.08] rounded-xl transition-all duration-300" />
                )}
              </button>
              <AnimatePresence>
                {helpDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-56 bg-[#0f1525] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                  >
                    <div className="py-1.5">
                      {HELP_ITEMS.map((item) => {
                        const Icon = item.icon;
                        const href = (item.href === '/manage-booking' && user) ? '/account/manage-booking' : item.href;
                        return (
                          <button
                            key={item.label}
                            onClick={() => { setHelpDropdown(false); item.auth ? authGuardedNav(href) : router.push(href); }}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all"
                          >
                            <Icon className="w-4 h-4 text-slate-500" />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right side */}
          <div className="hidden md:flex items-center gap-3">
            {user ? (
              <div ref={userRef} className="relative">
                <button
                  onClick={() => { setUserDropdown(!userDropdown); setHelpDropdown(false); }}
                  className="flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-semibold text-white/70 hover:text-white transition-all hover:bg-white/[0.04]"
                >
                  <UserAvatar user={user} size={28} />
                  {user.name}
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', userDropdown && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {userDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-2 w-52 bg-[#0f1525] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                    >
                      {/* Dropdown header with avatar */}
                      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-3">
                        <UserAvatar user={user} size={36} />
                        <div className="min-w-0">
                          <p className="text-white text-sm font-semibold truncate">{user.name}</p>
                          <p className="text-slate-500 text-xs truncate">{user.email}</p>
                        </div>
                      </div>
                      <div className="py-1.5">
                        <Link href="/account/bookings" onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all">
                          <LayoutDashboard className="w-4 h-4 text-slate-500" />My Trips
                        </Link>
                        <Link href="/account/notifications" onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all">
                          <Bell className="w-4 h-4 text-slate-500" />Notifications
                        </Link>
                        <Link href="/account/alerts" onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all">
                          <TrendingDown className="w-4 h-4 text-slate-500" />Price Alerts
                        </Link>
                        <Link href="/account/profile" onClick={() => setUserDropdown(false)}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all">
                          <User className="w-4 h-4 text-slate-500" />Profile
                        </Link>
                      </div>
                      <div className="border-t border-white/[0.06] py-1.5">
                        <button
                          onClick={() => { setUserDropdown(false); handleLogout(); }}
                          className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] transition-all"
                        >
                          <LogOut className="w-4 h-4" />Sign Out
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : adminUser ? (
              <button
                onClick={adminLogout}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/25 transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            ) : (
              <Link
                href="/auth/login"
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/25 transition-all"
              >
                <LogIn className="w-4 h-4" />
                Sign In
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden relative bg-black backdrop-blur-xl border-b border-white/10 shadow-xl"
          >
            <div className="px-4 py-4 space-y-2">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const href = (item.href === '/manage-booking' && user) ? '/account/manage-booking' : item.href;
                const isActive = pathname === href;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all',
                      isActive
                        ? 'text-white bg-white/[0.08] border border-white/[0.1]'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {item.label}
                  </Link>
                );
              })}

              {/* Mobile Help & Support */}
              <div className="pt-2 border-t border-white/[0.06]">
                <p className="px-4 py-2 text-xs text-slate-600 uppercase font-bold tracking-wider">Help & Support</p>
                {HELP_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const href = (item.href === '/manage-booking' && user) ? '/account/manage-booking' : item.href;
                  return (
                    <button key={item.label} onClick={() => { setMobileOpen(false); item.auth ? authGuardedNav(href) : router.push(href); }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.04] transition-all">
                      <Icon className="w-4 h-4" />{item.label}
                    </button>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                {user ? (
                  <>
                    <div className="flex items-center gap-3 px-4 py-2">
                      <UserAvatar user={user} size={32} />
                      <div>
                        <p className="text-white text-sm font-semibold">{user.name}</p>
                        <p className="text-slate-500 text-xs">{user.email}</p>
                      </div>
                    </div>
                    <Link href="/account/bookings" onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.04]">
                      <LayoutDashboard className="w-4 h-4" />Dashboard
                    </Link>
                    <Link href="/account/notifications" onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.04]">
                      <Bell className="w-4 h-4" />Notifications
                    </Link>
                    <Link href="/account/alerts" onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.04]">
                      <TrendingDown className="w-4 h-4" />Price Alerts
                    </Link>
                    <Link href="/account/profile" onClick={() => setMobileOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/[0.04]">
                      <User className="w-4 h-4" />Profile
                    </Link>
                    <button
                      onClick={() => { setMobileOpen(false); handleLogout(); }}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-red-400 hover:bg-red-500/[0.06] w-full"
                    >
                      <LogOut className="w-4 h-4" />Sign Out
                    </button>
                  </>
                ) : adminUser ? (
                  <button
                    onClick={() => { setMobileOpen(false); adminLogout(); }}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-white w-full"
                  >
                    <LogOut className="w-5 h-5" />
                    Sign Out
                  </button>
                ) : (
                  <Link
                    href="/auth/login"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white bg-[#1ABC9C]"
                  >
                    <LogIn className="w-5 h-5" />
                    Sign In
                  </Link>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
