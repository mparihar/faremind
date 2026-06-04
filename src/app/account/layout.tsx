'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Ticket, ClipboardList, Bell, TrendingDown,
  CreditCard, User, Headphones, LogOut, ChevronRight, Menu, X,
  Search, HelpCircle, ChevronDown, Gift, Shield, Dna, Wallet,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { useInactivityLogout } from '@/hooks/useInactivityLogout';

const SIDEBAR_NAV = [
  { href: '/account', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/account/bookings', label: 'My Trips', icon: Ticket },
  { href: '/account/manage-booking', label: 'Manage Booking', icon: ClipboardList },
  { href: '/account/travel-dna', label: 'My FareMind DNA\u2122', icon: Dna },
  { href: '/account/alerts', label: 'Price Alerts', icon: TrendingDown },
  { href: '/account/payment-methods', label: 'Payment Methods', icon: Wallet },
  { href: '/account/refunds', label: 'Refunds & Credits', icon: CreditCard },
  { href: '/account/notifications', label: 'Notifications', icon: Bell },
  { href: '/account/profile', label: 'Profile', icon: User },
  { href: '/account/support', label: 'Support', icon: Headphones },
];

const ADMIN_NAV = [
  { href: '/account/admin/notifications', label: 'Email Recipients', icon: Shield },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

/** Sidebar avatar */
function SidebarAvatar({ user }: { user: { name?: string; avatar?: string | null; email?: string } }) {
  const initial = user.name?.charAt(0).toUpperCase() || '?';
  return (
    <div className="flex items-center gap-3 px-3 py-3 mb-2 rounded-xl bg-white/[0.03] border border-white/[0.06]">
      {user.avatar ? (
        <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-[#1ABC9C]/30 flex-shrink-0">
          <img src={user.avatar} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-9 h-9 rounded-full bg-[#1ABC9C]/15 border-2 border-[#1ABC9C]/30 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-black text-[#1ABC9C]">{initial}</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-white text-sm font-semibold truncate">{user.name}</p>
        <p className="text-slate-500 text-[10px] truncate">{user.email}</p>
      </div>
    </div>
  );
}

/** Top header for the dashboard area */
function DashboardHeader({ user, onMenuToggle }: { user: any; onMenuToggle: () => void }) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const router = useRouter();
  const { logout } = useAuthStore();

  const initial = user?.name?.charAt(0).toUpperCase() || '?';

  return (
    <header className="h-14 flex items-center justify-between gap-4 px-5 border-b border-white/[0.06] bg-[#0a0f1e]/80 backdrop-blur-xl sticky top-16 z-40">
      {/* Mobile menu toggle */}
      <button onClick={onMenuToggle} className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all">
        <Menu size={18} />
      </button>

      {/* Search */}
      <div className={`relative flex-1 max-w-md transition-all ${searchFocused ? 'max-w-lg' : ''}`}>
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search flights, destinations…"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          className="w-full pl-9 pr-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm placeholder:text-slate-500 focus:outline-none focus:border-[#1ABC9C]/30 focus:bg-white/[0.06] transition-all"
        />
      </div>

      {/* Right icons */}
      <div className="flex items-center gap-2">
        <Link href="/account/notifications"
          className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all">
          <Bell size={17} />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#1ABC9C] border border-[#0a0f1e]" />
        </Link>
        <Link href="/account/support"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all">
          <HelpCircle size={17} />
        </Link>
        {/* User dropdown */}
        <div className="relative">
          <button onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-white/[0.04] transition-all">
            {user?.avatar ? (
              <div className="w-7 h-7 rounded-full overflow-hidden border border-[#1ABC9C]/30">
                <img src={user.avatar} alt="" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-full bg-[#1ABC9C]/15 border border-[#1ABC9C]/30 flex items-center justify-center">
                <span className="text-xs font-black text-[#1ABC9C]">{initial}</span>
              </div>
            )}
            <div className="hidden sm:block text-left">
              <p className="text-white text-xs font-semibold leading-none">{user?.name}</p>
              <p className="text-slate-500 text-[10px] leading-none mt-0.5">{user?.email}</p>
            </div>
            <ChevronDown size={12} className={`text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1.5 w-44 bg-[#0f1525] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50"
              >
                <Link href="/account/profile" onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-400 hover:text-white hover:bg-white/[0.05] transition-all">
                  <User size={13} /> Profile
                </Link>
                <button
                  onClick={() => { setDropdownOpen(false); logout(); router.push('/'); }}
                  className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/[0.06] transition-all border-t border-white/[0.06]"
                >
                  <LogOut size={13} /> Sign Out
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loadSession, logout } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(2);
  const [isAdminUser, setIsAdminUser] = useState(false);

  useEffect(() => {
    loadSession();
    const stored = localStorage.getItem('faremind_session');
    if (!stored) {
      router.replace('/auth/login?redirect=/account');
    } else {
      setReady(true);
    }
  }, []);

  // 15 minutes inactivity logout
  useInactivityLogout(15 * 60 * 1000, () => {
    logout();
    router.push('/');
  });

  // Check if user has admin access
  useEffect(() => {
    if (!user?.email) return;
    fetch(`/api/admin/check-access?email=${encodeURIComponent(user.email)}`)
      .then(r => r.json())
      .then(data => setIsAdminUser(data.isAdmin === true))
      .catch(() => setIsAdminUser(false));
  }, [user?.email]);

  // Block non-admin users from admin pages
  useEffect(() => {
    if (ready && pathname.startsWith('/account/admin') && !isAdminUser) {
      router.replace('/account');
    }
  }, [ready, pathname, isAdminUser, router]);

  // Close mobile sidebar on route change
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#0f172a] to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#1ABC9C] border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 text-xs font-medium">Loading account…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#0f172a] to-slate-900 pt-[44px]">
      <div className="flex">
        {/* ── SIDEBAR ── */}
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            />
          )}
        </AnimatePresence>

        {/* Sidebar */}
        <aside className={`
          fixed top-16 left-0 bottom-0 w-[220px] bg-slate-900/95 backdrop-blur-xl border-r border-white/[0.06]
          flex flex-col z-40 transition-transform duration-300 
          lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>


          {/* Nav items */}
          <nav className="flex-1 px-3 pt-8 overflow-y-auto">
            <div className="space-y-0.5">
              {SIDEBAR_NAV.map(item => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href, item.exact);
                const isNotif = item.label === 'Notifications';
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`
                      flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200
                      ${active
                        ? 'text-[#1ABC9C] border border-transparent'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                      }
                    `}
                  >
                    <Icon size={16} className={active ? 'text-[#1ABC9C]' : ''} />
                    <span className="flex-1">{item.label === 'My FareMind DNA\u2122' ? <>My <span className="text-white">FARE</span><span style={{ color: '#009CA6' }}>MIND</span> DNA™</> : item.label}</span>
                    {isNotif && notifCount > 0 && (
                      <span className="w-5 h-5 rounded-full bg-[#1ABC9C] text-[10px] font-bold text-white flex items-center justify-center">
                        {notifCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

              {/* Admin section — only visible to admin/super_admin users */}
              {isAdminUser && ADMIN_NAV.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/[0.06]">
                  <p className="px-3 mb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Admin</p>
                  <div className="space-y-0.5">
                    {ADMIN_NAV.map(item => {
                      const Icon = item.icon;
                      const active = isActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`
                            flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200
                            ${active
                              ? 'text-[#1ABC9C] border border-transparent'
                              : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                            }
                          `}
                        >
                          <Icon size={16} className={active ? 'text-[#1ABC9C]' : ''} />
                          <span className="flex-1">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* Referral card */}
            <div className="mt-12">
              <div className="bg-gradient-to-br from-[#1ABC9C]/10 via-purple-500/5 to-transparent border border-[#1ABC9C]/15 rounded-2xl py-5 px-4">
                <p className="text-[#1ABC9C] text-xs font-bold mb-1">Refer & Earn</p>
                <p className="text-slate-400 text-[10px] leading-relaxed mb-4">
                  Invite friends and earn up to $50 in travel credits!
                </p>
                <div className="flex justify-center mb-4">
                  <Gift size={30} className="text-[#1ABC9C]/40" />
                </div>
                <button className="w-full py-2.5 rounded-xl bg-[#1ABC9C] text-white text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#16a085] transition-all shadow-lg shadow-[#1ABC9C]/20">
                  Refer Now <ChevronRight size={12} />
                </button>
              </div>
            </div>
          </nav>
        </aside>

        {/* ── MAIN AREA ── */}
        <div className="flex-1 lg:ml-[220px] min-h-screen flex flex-col">
          {/* Mobile menu toggle (only visible on small screens) */}
          <div className="lg:hidden flex items-center px-4 py-2 border-b border-white/[0.06]">
            <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all">
              <Menu size={18} />
            </button>
          </div>

          {/* Main content */}
          <main className="flex-1 px-5 pt-0 pb-5 lg:px-6 lg:pt-0 lg:pb-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
