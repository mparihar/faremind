'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch, useAdminStore } from '@/store/useAdminStore';
import { 
  ArrowLeft, RefreshCw, Send, AlertTriangle, CheckCircle2, 
  Clock, Inbox, User, ArrowUpCircle, MessageSquare, Tag, 
  Trash2, XCircle
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  LOW:    'bg-slate-400/15 text-slate-400 border-slate-400/20',
  MEDIUM: 'bg-blue-400/15 text-blue-400 border-blue-400/20',
  HIGH:   'bg-amber-400/15 text-amber-400 border-amber-400/20',
  URGENT: 'bg-red-400/15 text-red-400 border-red-400/20',
};

const STATUS_STYLES: Record<TicketStatus, { cls: string; icon: React.ElementType }> = {
  OPEN:              { cls: 'bg-blue-400/15 text-blue-400',    icon: Inbox },
  IN_PROGRESS:       { cls: 'bg-amber-400/15 text-amber-400', icon: Clock },
  WAITING_CUSTOMER:  { cls: 'bg-purple-400/15 text-purple-400', icon: User },
  ESCALATED:         { cls: 'bg-red-400/15 text-red-400',     icon: ArrowUpCircle },
  RESOLVED:          { cls: 'bg-emerald-400/15 text-emerald-400', icon: CheckCircle2 },
  CLOSED:            { cls: 'bg-slate-400/15 text-slate-400',  icon: XCircle },
};

export default function TicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const router = useRouter();
  const { user: adminUser } = useAdminStore();
  const { ticketId } = use(params);
  
  const [ticket, setTicket] = useState<any>(null);
  const [supportStaff, setSupportStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [message, setMessage] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ticketRes, usersRes] = await Promise.all([
        adminFetch(`/api/admin/support-tickets/${ticketId}`),
        adminFetch('/api/admin/users')
      ]);

      if (ticketRes.ok) {
        const json = await ticketRes.json();
        setTicket(json.ticket);
      } else {
        router.push('/admin/support-queue');
      }

      if (usersRes.ok) {
        const json = await usersRes.json();
        setSupportStaff((json.users || []).filter((u: any) => ['SUPPORT', 'SUPER_ADMIN', 'OPS_ADMIN'].includes(u.role)));
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [ticketId, router]);

  useEffect(() => { load(); }, [load]);

  const updateTicket = async (updates: any) => {
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        load();
      }
    } catch (e) {
      console.error('Update failed', e);
    }
  };

  const deleteTicket = async () => {
    if (!confirm('Are you sure you want to delete this ticket? This cannot be undone.')) return;
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/admin/support-queue');
      }
    } catch (e) {
      console.error('Delete failed', e);
    }
  };

  const sendMessage = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await adminFetch(`/api/admin/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message, isInternal })
      });
      if (res.ok) {
        setMessage('');
        setIsInternal(false);
        load();
      }
    } catch (e) {
      console.error('Send message failed', e);
    }
    setSending(false);
  };

  if (loading) return <div className="p-12 flex justify-center"><RefreshCw className="animate-spin text-[#1ABC9C]" /></div>;
  if (!ticket) return null;

  const StatusIcon = STATUS_STYLES[ticket.status as TicketStatus]?.icon ?? Inbox;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/admin/support-queue')} className="p-2 bg-slate-800 rounded-xl text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-black text-white">{ticket.subject}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${PRIORITY_STYLES[ticket.priority as TicketPriority]}`}>
              {ticket.priority}
            </span>
          </div>
          <p className="text-slate-400 text-sm">Ticket #{ticket.id.slice(-6)} · Created {format(new Date(ticket.createdAt), 'PPpp')}</p>
        </div>
        
        {adminUser?.role === 'SUPER_ADMIN' && (
          <button onClick={deleteTicket} className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-xl text-sm font-semibold transition-all">
            <Trash2 size={16} /> Delete
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content (Left) */}
        <div className="col-span-2 space-y-6">
          {/* Initial Description */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-white">
                {ticket.customerName.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div>
                <p className="text-white font-semibold">{ticket.customerName}</p>
                <p className="text-slate-400 text-sm">{ticket.customerEmail}</p>
              </div>
              <div className="ml-auto text-xs text-slate-500">
                {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
              </div>
            </div>
            <div className="text-slate-300 text-sm whitespace-pre-wrap">
              {ticket.description}
            </div>
          </div>

          {/* Messages */}
          {ticket.messages?.map((msg: any) => (
            <div key={msg.id} className={`p-6 rounded-2xl border ${msg.isInternal ? 'bg-amber-500/5 border-amber-500/20' : 'bg-slate-800/50 border-slate-700/50'}`}>
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${msg.adminUser ? 'bg-[#1ABC9C]/20 text-[#1ABC9C]' : 'bg-slate-700 text-white'}`}>
                  {msg.adminUser ? msg.adminUser.fullName[0] : ticket.customerName[0]}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">
                    {msg.adminUser ? msg.adminUser.fullName : ticket.customerName}
                    {msg.isInternal && <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-500 px-2 py-0.5 rounded uppercase font-bold tracking-wider">Internal Note</span>}
                  </p>
                </div>
                <div className="ml-auto text-xs text-slate-500">
                  {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
                </div>
              </div>
              <div className={`text-sm whitespace-pre-wrap ${msg.isInternal ? 'text-amber-200/80' : 'text-slate-300'}`}>
                {msg.message}
              </div>
            </div>
          ))}

          {/* Reply Box */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-4">
            <textarea
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your reply..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-[#1ABC9C] mb-4 resize-y"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="accent-amber-500 w-4 h-4" />
                <span className="text-sm text-slate-400 font-medium select-none">Internal note (hidden from customer)</span>
              </label>
              <button 
                onClick={sendMessage} 
                disabled={sending || !message.trim()}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-white font-bold text-sm transition-all shadow-lg ${
                  isInternal ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' : 'bg-[#1ABC9C] hover:bg-[#16a085] shadow-[#1ABC9C]/20'
                } disabled:opacity-50`}
              >
                {sending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                {isInternal ? 'Add Note' : 'Send Reply'}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar (Right) */}
        <div className="space-y-6">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-2xl p-6">
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-4">Ticket Details</h3>
            
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">Status</label>
                <select 
                  value={ticket.status} 
                  onChange={e => updateTicket({ status: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
                >
                  {(Object.keys(STATUS_STYLES) as TicketStatus[]).map(s => (
                    <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">Assignee</label>
                <select 
                  value={ticket.assignedToId || ''} 
                  onChange={e => updateTicket({ assignedToId: e.target.value || null })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {supportStaff.map(staff => (
                    <option key={staff.id} value={staff.id}>{staff.fullName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 mb-2">Priority</label>
                <select 
                  value={ticket.priority} 
                  onChange={e => updateTicket({ priority: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-[#1ABC9C] appearance-none cursor-pointer"
                >
                  {(Object.keys(PRIORITY_STYLES) as TicketPriority[]).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              
              <div className="pt-4 border-t border-slate-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400">Category</span>
                  <span className="text-sm font-semibold text-white">{ticket.category}</span>
                </div>
                {ticket.bookingRef && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400">Booking Ref</span>
                    <span className="text-sm font-semibold text-[#1ABC9C]">{ticket.bookingRef}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
