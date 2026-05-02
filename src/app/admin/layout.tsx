'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminStore, adminFetch } from '@/store/useAdminStore';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { RefreshCw } from 'lucide-react';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const { user, setUser, clearAuth } = useAdminStore();
  const [checking, setChecking] = useState(true);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isLoginPage) { setChecking(false); return; }

    adminFetch('/api/admin/auth/me')
      .then(r => r.json())
      .then(d => {
        if (d.user) {
          setUser(d.user);
        } else {
          clearAuth();
          router.replace('/admin/login');
        }
      })
      .catch(() => {
        clearAuth();
        router.replace('/admin/login');
      })
      .finally(() => setChecking(false));
  }, [pathname]);

  if (isLoginPage) return <>{children}</>;

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <RefreshCw size={24} className="text-[#1ABC9C] animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-slate-950">
      <AdminSidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
