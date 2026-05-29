'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch, useAdminStore } from '@/store/useAdminStore';
import {
  RefreshCw, Plus, Pencil, Trash2, X, Save, Shield,
  Search, UserPlus, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { format } from 'date-fns';

interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
}

const ROLES = ['SUPER_ADMIN', 'OPS_ADMIN', 'SUPPORT', 'FINANCE', 'READ_ONLY'];

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-400/15 text-red-400 border-red-400/20',
  OPS_ADMIN:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  SUPPORT:     'bg-blue-400/15 text-blue-400 border-blue-400/20',
  FINANCE:     'bg-emerald-400/15 text-emerald-400 border-emerald-400/20',
  READ_ONLY:   'bg-slate-400/15 text-slate-400 border-slate-400/20',
};

const ROLE_ICONS: Record<string, React.ElementType> = {
  SUPER_ADMIN: ShieldAlert,
  OPS_ADMIN: ShieldCheck,
  SUPPORT: Shield,
  FINANCE: Shield,
  READ_ONLY: Shield,
};

const inp = 'w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all';
const sel = `${inp} appearance-none cursor-pointer`;

export default function AdminUsersPage() {
  const router = useRouter();
  const { user: currentUser } = useAdminStore();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createData, setCreateData] = useState({ email: '', fullName: '', phone: '', role: 'SUPPORT', password: '' });
  const [creating, setCreating] = useState(false);

  // Edit drawer
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [editData, setEditData] = useState({ fullName: '', email: '', phone: '', role: '', isActive: true });
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const res = await adminFetch('/api/admin/users');
    if (res.status === 401) { router.replace('/admin/login'); return; }
    if (res.status === 403) { router.replace('/admin/dashboard'); return; }
    const json = await res.json();
    setUsers(json.users ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const superAdminCount = users.filter(u => u.role === 'SUPER_ADMIN' && u.isActive).length;

  const createIsSuperAdmin = createData.role === 'SUPER_ADMIN';
  const editIsSuperAdmin = editData.role === 'SUPER_ADMIN';

  async function handleCreate() {
    if (!createData.email || !createData.fullName || !createData.role) return;
    if (createIsSuperAdmin && !createData.phone.trim()) { setError('Phone number is mandatory for Super Admin'); return; }
    setCreating(true);
    setError('');
    const res = await adminFetch('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(createData),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Failed to create admin'); setCreating(false); return; }
    setCreateOpen(false);
    setCreateData({ email: '', fullName: '', phone: '', role: 'SUPPORT', password: '' });
    setCreating(false);
    await load();
  }

  async function handleEdit() {
    if (!editUser) return;
    if (editIsSuperAdmin && !editData.phone.trim()) { setError('Phone number is mandatory for Super Admin'); return; }
    if (editIsSuperAdmin && !editData.email.trim()) { setError('Email is mandatory for Super Admin'); return; }
    setSaving(true);
    setError('');
    const res = await adminFetch(`/api/admin/users/${editUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify(editData),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Failed to update admin'); setSaving(false); return; }
    setEditUser(null);
    setSaving(false);
    await load();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    const res = await adminFetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? 'Failed to delete admin'); setDeleting(false); return; }
    setDeleteTarget(null);
    setDeleting(false);
    await load();
  }

  const filteredUsers = search
    ? users.filter(u =>
        u.fullName.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.role.toLowerCase().includes(search.toLowerCase())
      )
    : users;

  return (
    <div className="p-8">
      {/* Modals */}

      {/* Create Admin Modal */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <UserPlus size={16} className="text-[#1ABC9C]" />
                Create Admin User
              </h3>
              <button onClick={() => { setCreateOpen(false); setError(''); }} className="text-slate-400 hover:text-white transition-all"><X size={16} /></button>
            </div>
            {error && <p className="text-red-400 text-xs mb-3 p-2 bg-red-400/10 rounded-lg">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Full Name *</label>
                <input className={inp} value={createData.fullName} onChange={e => setCreateData(d => ({ ...d, fullName: e.target.value }))} placeholder="Rishi Parihar" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Email *</label>
                <input className={inp} type="email" value={createData.email} onChange={e => setCreateData(d => ({ ...d, email: e.target.value }))} placeholder="admin@faremind.com" />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Phone {createIsSuperAdmin && <span className="text-red-400">*</span>}</label>
                <input className={`${inp} ${createIsSuperAdmin && !createData.phone.trim() ? 'border-red-400/40' : ''}`} value={createData.phone} onChange={e => setCreateData(d => ({ ...d, phone: e.target.value }))} placeholder="+1 234 567 8900" />
                {createIsSuperAdmin && !createData.phone.trim() && <p className="text-red-400 text-[10px] mt-1">Required for Super Admin</p>}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Role *</label>
                <select className={sel} value={createData.role} onChange={e => setCreateData(d => ({ ...d, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r} className="bg-slate-800">{r.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Password (optional)</label>
                <input className={inp} type="password" value={createData.password} onChange={e => setCreateData(d => ({ ...d, password: e.target.value }))} placeholder="Leave blank for OTP-only auth" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setCreateOpen(false); setError(''); }} className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:text-white text-sm transition-all">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !createData.email || !createData.fullName || (createIsSuperAdmin && !createData.phone.trim())}
                className="px-4 py-2 rounded-xl bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-sm font-bold disabled:opacity-50 transition-all">
                {creating ? 'Creating…' : 'Create Admin'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Admin Drawer */}
      {editUser && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-base flex items-center gap-2">
                <Pencil size={14} className="text-[#1ABC9C]" />
                Edit Admin: {editUser.fullName}
              </h3>
              <button onClick={() => { setEditUser(null); setError(''); }} className="text-slate-400 hover:text-white transition-all"><X size={16} /></button>
            </div>
            {error && <p className="text-red-400 text-xs mb-3 p-2 bg-red-400/10 rounded-lg">{error}</p>}
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Full Name</label>
                <input className={inp} value={editData.fullName} onChange={e => setEditData(d => ({ ...d, fullName: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Email {editIsSuperAdmin && <span className="text-red-400">*</span>}</label>
                <input className={`${inp} ${editIsSuperAdmin && !editData.email.trim() ? 'border-red-400/40' : ''}`} type="email" value={editData.email} onChange={e => setEditData(d => ({ ...d, email: e.target.value }))} />
                {editIsSuperAdmin && !editData.email.trim() && <p className="text-red-400 text-[10px] mt-1">Required for Super Admin</p>}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Phone {editIsSuperAdmin && <span className="text-red-400">*</span>}</label>
                <input className={`${inp} ${editIsSuperAdmin && !editData.phone.trim() ? 'border-red-400/40' : ''}`} value={editData.phone} onChange={e => setEditData(d => ({ ...d, phone: e.target.value }))} />
                {editIsSuperAdmin && !editData.phone.trim() && <p className="text-red-400 text-[10px] mt-1">Required for Super Admin</p>}
              </div>
              <div>
                <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 block">Role</label>
                <select className={sel} value={editData.role} onChange={e => setEditData(d => ({ ...d, role: e.target.value }))}>
                  {ROLES.map(r => <option key={r} value={r} className="bg-slate-800">{r.replace(/_/g, ' ')}</option>)}
                </select>
                {editUser.role === 'SUPER_ADMIN' && superAdminCount <= 1 && editData.role !== 'SUPER_ADMIN' && (
                  <p className="text-red-400 text-[10px] mt-1">⚠ Cannot demote — this is the only Super Admin</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="text-[10px] text-slate-500 uppercase font-bold">Active</label>
                <button
                  onClick={() => setEditData(d => ({ ...d, isActive: !d.isActive }))}
                  className={`w-10 h-5 rounded-full transition-all relative ${editData.isActive ? 'bg-[#1ABC9C]' : 'bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${editData.isActive ? 'left-5' : 'left-0.5'}`} />
                </button>
                <span className={`text-xs font-bold ${editData.isActive ? 'text-[#1ABC9C]' : 'text-slate-500'}`}>{editData.isActive ? 'Active' : 'Inactive'}</span>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setEditUser(null); setError(''); }} className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:text-white text-sm transition-all">Cancel</button>
              <button onClick={handleEdit} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-sm font-bold disabled:opacity-50 transition-all">
                <Save size={12} />{saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-white font-bold text-base mb-2">Delete Admin User</h3>
            {error && <p className="text-red-400 text-xs mb-3 p-2 bg-red-400/10 rounded-lg">{error}</p>}
            <p className="text-slate-400 text-sm mb-1">
              Delete <span className="text-white font-semibold">{deleteTarget.fullName}</span>?
            </p>
            <p className="text-slate-500 text-xs mb-5">{deleteTarget.email} · {deleteTarget.role.replace(/_/g, ' ')}</p>
            {deleteTarget.role === 'SUPER_ADMIN' && superAdminCount <= 1 && (
              <p className="text-red-400 text-xs mb-3 p-2 bg-red-400/10 rounded-lg">
                ⚠ This is the only Super Admin and cannot be deleted.
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button onClick={() => { setDeleteTarget(null); setError(''); }} className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:text-white text-sm transition-all">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleting || (deleteTarget.role === 'SUPER_ADMIN' && superAdminCount <= 1)}
                className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-bold disabled:opacity-50 transition-all"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">Admin Users</h1>
          <p className="text-slate-400 text-sm mt-0.5">{users.length} admin{users.length !== 1 ? 's' : ''} · {superAdminCount} super admin{superAdminCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white text-sm font-semibold transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setCreateOpen(true); setError(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#1ABC9C] hover:bg-[#1ABC9C]/80 text-white text-sm font-bold rounded-xl transition-all"
          >
            <Plus size={14} />
            Create Admin
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-5">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, role…"
          className="w-full pl-9 pr-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-[#1ABC9C] transition-all"
        />
      </div>

      {/* Table */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              {['Name', 'Email', 'Phone', 'Role', 'Status', 'Last Login', 'Created', 'Actions'].map(h => (
                <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {loading ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center">
                <RefreshCw size={20} className="text-[#1ABC9C] animate-spin mx-auto" />
              </td></tr>
            ) : filteredUsers.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-12 text-center text-slate-500">No admin users found</td></tr>
            ) : (
              filteredUsers.map(u => {
                const isProtected = u.role === 'SUPER_ADMIN' && superAdminCount <= 1;
                const isSelf = u.id === currentUser?.id;
                const RoleIcon = ROLE_ICONS[u.role] ?? Shield;
                return (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{u.fullName}</span>
                        {isProtected && (
                          <span className="px-1.5 py-0.5 rounded bg-red-400/10 text-red-400 text-[9px] font-bold">PROTECTED</span>
                        )}
                        {isSelf && (
                          <span className="px-1.5 py-0.5 rounded bg-[#1ABC9C]/10 text-[#1ABC9C] text-[9px] font-bold">YOU</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">{u.email}</td>
                    <td className="px-5 py-3.5 text-slate-500">{u.phone ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ROLE_COLORS[u.role] ?? 'bg-slate-400/15 text-slate-400 border-slate-400/20'}`}>
                        <RoleIcon size={10} />
                        {u.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        u.isActive ? 'bg-emerald-400/15 text-emerald-400' : 'bg-red-400/15 text-red-400'
                      }`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">
                      {u.lastLoginAt ? format(new Date(u.lastLoginAt), 'dd MMM yyyy HH:mm') : 'Never'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">
                      {format(new Date(u.createdAt), 'dd MMM yyyy')}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setEditUser(u);
                            setEditData({ fullName: u.fullName, email: u.email, phone: u.phone ?? '', role: u.role, isActive: u.isActive });
                            setError('');
                          }}
                          title="Edit"
                          className="p-1.5 rounded-lg bg-slate-700/40 text-slate-400 hover:text-white transition-all"
                        >
                          <Pencil size={12} />
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => { setDeleteTarget(u); setError(''); }}
                            disabled={isProtected}
                            title={isProtected ? 'Protected Super Admin' : 'Delete'}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-30 transition-all"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
