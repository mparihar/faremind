'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  PlaneTakeoff,
  Briefcase,
  UserCog,
  XCircle,
  Bell,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Wrench,
  Ticket,
  Users,
  RotateCcw,
  Headphones,
  HelpCircle,
  CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

const AGENT_NAV = [
  { href: '/agent/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/agent/new-booking', label: 'New Booking', icon: PlaneTakeoff },
  { href: '/agent/booking-workspace', label: 'Booking Workspace', icon: Wrench },
  { href: '/agent/bookings', label: 'My Bookings', icon: Briefcase },
  { href: '/agent/ticket-queue', label: 'Ticket Queue', icon: Ticket },
  { href: '/agent/support-tickets', label: 'Support Tickets', icon: Headphones },
  { href: '/agent/passenger-updates', label: 'Passenger Updates', icon: UserCog },
  { href: '/agent/post-booking', label: 'Post-Booking', icon: RotateCcw },
  { href: '/agent/cancellations', label: 'Cancellations', icon: XCircle },
  { href: '/agent/refunds', label: 'Refunds & Credits', icon: CreditCard },
  { href: '/agent/duffel-assistant', label: 'Duffel Assistant', icon: MessageCircle },
  { href: '/agent/notifications', label: 'Notifications', icon: Bell },
  { href: '/agent/support', label: 'Contact Support', icon: HelpCircle },
  { href: '/agent/profile', label: 'Profile', icon: User },
  { href: '__logout__', label: 'Sign Out', icon: LogOut },
];

interface AgentSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AgentSidebar({ collapsed, onToggleCollapse }: AgentSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logoutWithServerRevoke } = useAuthStore();

  async function handleLogout() {
    // Clear agent booking context
    try { sessionStorage.removeItem('agentBookingContext'); } catch {}
    await logoutWithServerRevoke();
    router.push('/agent/login');
  }

  return (
    <aside className={cn(
      'fixed left-0 top-0 h-full bg-slate-900/95 border-r border-white/[0.06] flex flex-col transition-all duration-300 z-40',
      collapsed ? 'w-[68px]' : 'w-[240px]'
    )}>
      {/* Logo area + toggle */}
      <div className="h-16 flex items-center justify-between px-3 border-b border-white/[0.06]">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1ABC9C] to-[#009CA6] flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-white leading-none">FAREMIND</p>
              <p className="text-[9px] font-bold text-[#1ABC9C] tracking-widest">AGENT PORTAL</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1ABC9C] to-[#009CA6] flex items-center justify-center mx-auto">
            <Briefcase className="w-4 h-4 text-white" />
          </div>
        )}
        {/* Toggle button — always in header */}
        <button
          onClick={onToggleCollapse}
          className={cn(
            'p-1.5 rounded-lg text-slate-400 hover:text-[#1ABC9C] hover:bg-[#1ABC9C]/10 transition-all shrink-0',
            collapsed && 'absolute top-[62px] left-1/2 -translate-x-1/2 z-10'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Nav items */}
      <nav className={cn('flex-1 px-2 space-y-1 overflow-y-auto', collapsed ? 'pt-8' : 'py-4')}>
        {AGENT_NAV.map((item) => {
          const Icon = item.icon;
          if (item.href === '__logout__') {
            return (
              <button
                key="logout"
                onClick={handleLogout}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full text-left',
                  'text-slate-400 hover:text-red-400 hover:bg-red-500/[0.06] border border-transparent'
                )}
                title={collapsed ? 'Sign Out' : undefined}
              >
                <Icon className="w-4.5 h-4.5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </button>
            );
          }
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-[#1ABC9C]/15 text-[#1ABC9C] border border-[#1ABC9C]/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
              )}
            >
              <Icon className={cn('w-4.5 h-4.5 shrink-0', isActive ? 'text-[#1ABC9C]' : '')} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User info */}
      <div className="border-t border-white/[0.06] p-3 pb-4">
        {!collapsed && user && (
          <div className="flex items-center gap-2.5 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-[#1ABC9C]/20 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-[#1ABC9C]">
                {user.name?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate leading-relaxed">{user.name?.split(' ')[0]}</p>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">{user.email}</p>
            </div>
          </div>
        )}
        {collapsed && user && (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-full bg-[#1ABC9C]/20 flex items-center justify-center">
              <span className="text-xs font-bold text-[#1ABC9C]">
                {user.name?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

