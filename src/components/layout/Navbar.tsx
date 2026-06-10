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
  Dna,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';
import { useAdminStore } from '@/store/useAdminStore';
import FareMindTravelAssistantButton from '@/components/voice/FareMindTravelAssistantButton';

const NAV_ITEMS = [
  { href: '/', label: 'Search', icon: Plane },
  { href: '/manage-booking', label: 'Manage Booking', icon: Shield },
  { href: '/account/travel-dna', label: 'Travel DNA', icon: Dna },
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

export default function Navbar({ hideNav = false }: { hideNav?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const [helpDropdown, setHelpDropdown] = useState(false);
  const { user, loadSession, logout } = useAuthStore();
  const { user: adminUser, clearAuth: clearAdminAuth } = useAdminStore();
  const userRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const isAdminLogin = pathname === '/admin/login';

  // Refresh auth state on mount and route changes (e.g., after login redirect)
  useEffect(() => { loadSession(); }, [loadSession, pathname]);

  // Clear stale persisted admin auth when on the login page
  useEffect(() => {
    if (isAdminLogin && adminUser) clearAdminAuth();
  }, [isAdminLogin]);

  // Clear stale user session when redirected to login page (session expired)
  const isUserLogin = pathname === '/auth/login';
  useEffect(() => {
    if (isUserLogin && user) logout();
  }, [isUserLogin]);

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
    router.push('/admin/login');
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
        <div className="flex items-center h-16 gap-4">
          {/* Logo */}
          <Link href="/" className="relative flex items-center justify-center group h-16 overflow-hidden w-fit">
            <img
              src="/logo.png"
              alt="FareMind"
              className="h-[90px] w-auto object-contain flex-shrink-0"
            />
            <div className="absolute bottom-[2px] flex flex-col items-center w-full px-1">
              <div className="relative w-full h-[1px] mb-[1px]">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent blur-[1px]"></div>
              </div>
              <span className="text-[8px] sm:text-[9px] font-medium uppercase tracking-[0.7em] text-white/90 pl-[0.7em] translate-x-4">
                FREE YOUR <span className="text-[#009CA6] font-bold">MIND</span>
              </span>
              <div className="relative w-full h-[1px] mt-[1px]">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#009CA6] to-transparent blur-[1px]"></div>
              </div>
            </div>
          </Link>

          {/* Admin navbar right — Sign Out when authenticated, Sign In on login page */}
          {hideNav && adminUser && !isAdminLogin && (
            <div className="ml-auto">
              <button
                onClick={adminLogout}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/25 transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          )}
          {hideNav && !adminUser && isAdminLogin && (
            <div className="ml-auto">
              <span className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1ABC9C] shadow-lg shadow-[#1ABC9C]/25">
                <LogIn className="w-4 h-4" />
                Sign In
              </span>
            </div>
          )}

          {/* Desktop Nav */}
          {!hideNav && (
            <div className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                // Route logged-in users to dashboard inner page, guests to public portal
                const href = item.href;
                // Dynamic label: "Travel DNA" → "My FareMind DNA™" when logged in
                const label = (item.label === 'Travel DNA' && user)
                  ? <>My <span><span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span></span> DNA™</>
                  : item.label;

                // Dashboard (/account/bookings) should be active for ALL /account/* pages
                const isActive = item.href === '/account'
                  ? pathname.startsWith('/account')
                  : pathname === href || (href !== '/' && pathname.startsWith(href + '/'));

                // "Search" (/) — force full page reload so the hero form is always clean
                if (item.href === '/') {
                  return (
                    <button
                      key={item.href}
                      onClick={() => { window.location.href = '/'; }}
                      className={cn(
                        'relative flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-200',
                        isActive
                          ? 'text-white bg-white/[0.08] border border-white/[0.08]'
                          : 'text-white/60 hover:text-white hover:bg-white/[0.05] border border-transparent'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  );
                }

                if (item.label === 'Travel DNA') {
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      className={cn(
                        'relative flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all duration-300 group overflow-visible',
                        isActive
                          ? 'text-white bg-[#1ABC9C]/20 border border-[#1ABC9C]/50 shadow-[0_0_15px_rgba(26,188,156,0.15)]'
                          : 'text-[#1ABC9C] hover:text-white border border-[#1ABC9C]/30 hover:border-[#1ABC9C]/80 bg-[#1ABC9C]/10 hover:bg-[#1ABC9C]/20 hover:shadow-[0_0_20px_rgba(26,188,156,0.4)]'
                      )}
                    >
                      <Icon className="w-4 h-4 transition-transform duration-500 group-hover:rotate-180 group-hover:scale-110" />
                      <span className="relative z-10">{label}</span>
                      
                      {!isActive && (
                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#009CA6] opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#009CA6]"></span>
                        </span>
                      )}
                    </Link>
                  );
                }

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
                    {label}
                  </Link>
                );
              })}

              {/* Support Dropdown */}
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
                  <span className="relative z-10">Support</span>
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
                          const href = item.href;
                          return (
                            <button
                              key={item.label}
                              onClick={() => { setHelpDropdown(false); item.auth ? authGuardedNav(href) : router.push(href); }}
                              className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all"
                            >
                              <Icon className="w-4 h-4" />
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
          )}

          {/* Right side */}
          {!hideNav && (
            <div className="hidden md:flex items-center gap-3 ml-auto">
              {/* FareMind Voice Assistant — only on Hero and Passenger Form pages */}
              {(pathname === '/' || pathname === '/checkout/passengers') && (
                <FareMindTravelAssistantButton />
              )}
              {user ? (
                <div ref={userRef} className="relative">
                  <button
                    onClick={() => { setUserDropdown(!userDropdown); setHelpDropdown(false); }}
                    className="flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-semibold text-white/70 hover:text-white transition-all hover:bg-white/[0.04]"
                  >
                    <UserAvatar user={user} size={28} />
                    {user.name?.split(' ')[0]}
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
                            <p className="text-white text-sm font-semibold truncate">{user.name?.split(' ')[0]}</p>
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
          )}

          {/* Mobile menu button */}
          {!hideNav && (
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile menu */}
      {!hideNav && (
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
                  const href = item.href;
                  const label = (item.label === 'Travel DNA' && user)
                    ? <>My <span><span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span></span> DNA™</>
                    : item.label;
                  const isActive = pathname === href;

                  // "Search" (/) — force full page reload so hero form is clean
                  if (item.href === '/') {
                    return (
                      <button
                        key={item.href}
                        onClick={() => { setMobileOpen(false); window.location.href = '/'; }}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all w-full',
                          isActive
                            ? 'text-white bg-white/[0.08] border border-white/[0.1]'
                            : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        {label}
                      </button>
                    );
                  }

                  if (item.label === 'Travel DNA') {
                    return (
                      <Link
                        key={item.href}
                        href={href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          'relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all group overflow-visible',
                          isActive
                            ? 'text-white bg-[#1ABC9C]/20 border border-[#1ABC9C]/50 shadow-[0_0_15px_rgba(26,188,156,0.15)]'
                            : 'text-[#1ABC9C] bg-[#1ABC9C]/10 hover:bg-[#1ABC9C]/20 border border-transparent'
                        )}
                      >
                        <Icon className="w-5 h-5 transition-transform duration-500 group-hover:rotate-180 group-hover:scale-110" />
                        {label}
                        
                        {!isActive && (
                          <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#009CA6] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#009CA6]"></span>
                          </span>
                        )}
                      </Link>
                    );
                  }

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
                      {label}
                    </Link>
                  );
                })}

                {/* Mobile Voice Assistant — only on Hero and Passenger Form pages */}
                {(pathname === '/' || pathname === '/checkout/passengers') && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <div className="px-4 py-2">
                      <FareMindTravelAssistantButton />
                    </div>
                  </div>
                )}

                {/* Mobile Support */}
                <div className="pt-2 border-t border-white/[0.06]">
                  <p className="px-4 py-2 text-xs text-slate-600 uppercase font-bold tracking-wider">Support</p>
                  {HELP_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const href = item.href;
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
                          <p className="text-white text-sm font-semibold">{user.name?.split(' ')[0]}</p>
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
      )}
    </nav>
  );
}
