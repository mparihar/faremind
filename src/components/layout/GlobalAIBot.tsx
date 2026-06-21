/**
 * GlobalAIBot — Lightweight version of FareMind AI Bot available on all pages.
 * Shows Contact Support, General Queries, and Manage Booking modes.
 * On the /search page, the full FloatingAIAssistant renders instead (with flight context).
 * Hidden on: home page (/), admin pages (/admin/*), and auth pages (/auth/*).
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Sparkles, MessageCircleQuestion } from 'lucide-react';
import { usePathname } from 'next/navigation';
import AiContactSupportFlow from '@/components/search/ai-booking/AiContactSupportFlow';
import AiGeneralQueryFlow from '@/components/search/ai-booking/AiGeneralQueryFlow';
import AiManageBookingFlow from '@/components/search/ai-booking/AiManageBookingFlow';

type BotMode = 'home' | 'support' | 'general' | 'manage';

export default function GlobalAIBot() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<BotMode>('home');
  const [isAgentMode, setIsAgentMode] = useState(false);

  // Detect agent mode (agent pages or agent booking flow on public pages)
  useEffect(() => {
    const isAgentPath = pathname.startsWith('/agent');
    let hasAgentCtx = false;
    try { hasAgentCtx = !!sessionStorage.getItem('agentBookingContext'); } catch {}
    setIsAgentMode(isAgentPath || hasAgentCtx);
  }, [pathname]);

  // Hide on home, admin, auth pages, and /search (full bot renders there)
  const hiddenPaths = ['/', '/admin', '/auth'];
  const shouldHide = hiddenPaths.some(p =>
    p === '/' ? pathname === '/' : pathname.startsWith(p)
  ) || pathname === '/search';

  if (shouldHide) return null;

  const handleClose = () => {
    setIsOpen(false);
    setMode('home');
  };

  return (
    <div className={`fixed z-50 flex flex-col items-start gap-3 ${isAgentMode ? 'bottom-3 left-[320px]' : 'bottom-4 sm:bottom-6 left-4 sm:left-56'}`}>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="w-[calc(100vw-2rem)] sm:w-[420px] md:w-[440px] max-sm:fixed max-sm:inset-2 max-sm:w-auto flex flex-col rounded-2xl overflow-hidden shadow-[0_12px_48px_rgba(13,148,136,0.18),0_2px_12px_rgba(0,0,0,0.10)] border border-teal-200/60"
            style={{ minHeight: 'min(500px, calc(100dvh - 6rem))', maxHeight: 'min(650px, calc(100dvh - 4rem))', background: '#ffffff' }}
          >
            {/* Accent bar */}
            <div className="h-1 w-full shrink-0" style={{ background: 'linear-gradient(90deg, #007a7c 0%, #009A9C 50%, #00b5b7 100%)' }} />

            {/* Mode: Home — show action tiles */}
            {mode === 'home' && (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0 bg-white">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm shrink-0 relative overflow-hidden"
                    style={{ background: 'linear-gradient(135deg, #007a7c 0%, #009A9C 55%, #00b5b7 100%)' }}>
                    <span className="absolute inset-0 opacity-30 blur-sm"
                      style={{ background: 'radial-gradient(circle at 30% 30%, #5eead4, transparent)' }} />
                    <Bot className="w-4 h-4 text-white relative z-10" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-slate-800 font-bold text-[13px] leading-none">FARE<span style={{ color: '#009CA6' }}>MIND</span></p>
                      <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider text-white"
                        style={{ background: 'linear-gradient(90deg, #007a7c, #009A9C)' }}>AI</span>
                    </div>
                    <p className="text-slate-400 text-[11px] font-medium mt-0.5">Your intelligent travel consultant</p>
                  </div>
                  <button
                    onClick={handleClose}
                    title="Close"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Action tiles */}
                <div className="flex-1 overflow-y-auto px-4 py-5 space-y-3"
                  style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)' }}>
                  {/* Welcome */}
                  <div className="text-center pb-2">
                    <div className="w-11 h-11 rounded-2xl flex items-center justify-center mx-auto mb-3 relative overflow-hidden shadow-sm"
                      style={{ background: 'linear-gradient(135deg, #007a7c 0%, #009A9C 50%, #00b5b7 100%)' }}>
                      <span className="absolute inset-0 opacity-25 blur-sm"
                        style={{ background: 'radial-gradient(circle at 30% 30%, #5eead4, transparent)' }} />
                      <Sparkles className="w-5 h-5 text-white relative z-10" />
                    </div>
                    <p className="text-slate-700 font-bold text-[13px] mb-1">How can I help you today?</p>
                    <p className="text-slate-400 text-[11px]">Choose an option below</p>
                  </div>

                  {/* Action buttons */}
                  <div className="space-y-2">
                    <button
                      onClick={() => setMode('general')}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-violet-200 bg-white hover:bg-violet-50/50 hover:border-violet-300 transition-all text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600 text-white shrink-0 shadow-sm">
                        <MessageCircleQuestion className="w-[18px] h-[18px]" />
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-slate-800 group-hover:text-violet-700 transition-colors">General Queries</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Ask about flights, baggage, transit, visas & more</p>
                      </div>
                    </button>

                    <button
                      onClick={() => setMode('manage')}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-teal-200 bg-white hover:bg-teal-50/50 hover:border-teal-300 transition-all text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-teal-500 to-cyan-600 text-white shrink-0 shadow-sm">
                        <span className="text-[16px]">📋</span>
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-slate-800 group-hover:text-teal-700 transition-colors">Manage Booking</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">View, cancel, or update your booking</p>
                      </div>
                    </button>

                    <button
                      onClick={() => setMode('support')}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border border-[#009CA6]/20 bg-white hover:bg-[#009CA6]/5 hover:border-[#009CA6]/30 transition-all text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-gradient-to-br from-[#009CA6] to-[#007a7c] text-white shrink-0 shadow-sm">
                        <span className="text-[16px]">🎧</span>
                      </div>
                      <div>
                        <p className="text-[13px] font-bold text-slate-800 group-hover:text-[#009CA6] transition-colors">Contact Support</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">Create a support case for urgent help</p>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Mode: General Queries */}
            {mode === 'general' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <AiGeneralQueryFlow
                  onExit={() => setMode('home')}
                  onContactSupport={() => setMode('support')}
                />
              </div>
            )}

            {/* Mode: Manage Booking */}
            {mode === 'manage' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)' }}>
                <AiManageBookingFlow
                  preselectedAction="manage"
                  onExit={() => setMode('home')}
                />
              </div>
            )}

            {/* Mode: Contact Support */}
            {mode === 'support' && (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: 'linear-gradient(180deg, #f0fdfb 0%, #f8fffe 100%)' }}>
                <AiContactSupportFlow
                  onExit={() => setMode('home')}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating trigger button */}
      <div className="relative">
        {isAgentMode ? (
          <AnimatePresence>
            {!isOpen && (
              <motion.button
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setIsOpen(true)}
                className="relative flex items-center gap-2.5 h-11 pl-3 pr-4 rounded-2xl text-white overflow-visible cursor-pointer select-none backdrop-blur-xl"
                style={{
                  background: 'linear-gradient(135deg, rgba(10,20,35,0.85) 0%, rgba(15,25,45,0.90) 100%)',
                  border: '1px solid rgba(0,180,190,0.35)',
                  boxShadow: '0 0 24px rgba(0,180,190,0.20), 0 4px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
                title="FareMind AI Assistant"
              >
                {/* Outer glow pulse */}
                <span className="absolute -inset-[2px] rounded-2xl pointer-events-none"
                  style={{ animation: 'aiGlowPulse 3s ease-in-out infinite', boxShadow: '0 0 18px rgba(0,180,190,0.30), 0 0 36px rgba(0,180,190,0.12)' }} />

                {/* Shimmer sweep */}
                <motion.span
                  animate={{ x: ['-130%', '230%'] }}
                  transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', repeatDelay: 2.5 }}
                  className="absolute inset-0 rounded-2xl bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg] pointer-events-none"
                />

                {/* Icon with teal glow dot */}
                <span className="relative flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
                  style={{ background: 'linear-gradient(135deg, #009CA6 0%, #00b8b8 100%)' }}>
                  <motion.span
                    animate={{ y: [0, -1, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative flex"
                  >
                    <Bot className="w-3.5 h-3.5 text-white" />
                  </motion.span>
                </span>

                {/* Label */}
                <span className="text-[12px] font-extrabold tracking-wide whitespace-nowrap">
                  <span className="text-white">FARE</span><span style={{ color: '#2ee8d6' }}>MIND</span>
                  <span className="text-white/50 ml-1 font-semibold text-[10px]">AI</span>
                </span>
              </motion.button>
            )}
          </AnimatePresence>
        ) : (
          <>
            {/* Outer glow pulse rings for black orb */}
            {!isOpen && (
              <>
                <motion.span
                  animate={{ scale: [1, 1.55], opacity: [0.22, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{ background: 'linear-gradient(135deg, #111111, #222222)' }}
                />
                <motion.span
                  animate={{ scale: [1, 1.25], opacity: [0.15, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: 0.6 }}
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{ background: 'linear-gradient(135deg, #111111, #222222)' }}
                />
              </>
            )}

            <motion.button
              onClick={() => setIsOpen(v => !v)}
              title="FAREMIND Co-Pilot"
              whileHover={{ scale: 1.05, y: -2 }}
              whileTap={{ scale: 0.96 }}
              className="relative flex items-center gap-0 h-12 rounded-2xl text-white overflow-hidden cursor-pointer select-none"
              style={isOpen
                ? { background: '#111111', boxShadow: 'none', border: '1px solid rgba(255,255,255,0.1)' }
                : { background: '#000000', boxShadow: '0 6px 32px rgba(0,0,0,0.50), 0 2px 8px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06)' }
              }
            >
              {/* Shimmer sweep */}
              {!isOpen && (
                <motion.span
                  animate={{ x: ['-130%', '230%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.8 }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[-20deg] pointer-events-none"
                />
              )}

              {/* Orb icon area */}
              <span className="relative flex items-center justify-center w-12 h-12 shrink-0">
                {/* Inner orb glow */}
                {!isOpen && (
                  <span className="absolute w-8 h-8 rounded-full opacity-40 blur-md"
                    style={{ background: 'radial-gradient(circle, #555555, #222222)' }} />
                )}
                <AnimatePresence mode="wait">
                  {isOpen ? (
                    <motion.span key="x"
                      initial={{ rotate: -90, opacity: 0, scale: 0.7 }}
                      animate={{ rotate: 0, opacity: 1, scale: 1 }}
                      exit={{ rotate: 90, opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.2 }}
                      className="relative flex"
                    >
                      <X className="w-4 h-4 text-violet-200" />
                    </motion.span>
                  ) : (
                    <motion.span key="bot"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="relative flex"
                    >
                      <motion.span
                        animate={{ y: [0, -1.5, 0] }}
                        transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                      >
                        <Bot className="w-5 h-5 text-white drop-shadow-sm" />
                      </motion.span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>

              {/* Divider */}
              <span className="w-px h-6 bg-white/20 shrink-0 -ml-2" />

              {/* Label */}
              <span className="px-4">
                <span className="text-[13px] font-black tracking-tight text-white whitespace-nowrap">
                  {isOpen ? 'Close' : <><span>FARE</span><span style={{ color: '#009CA6' }}>MIND</span> AI</>}
                </span>
              </span>
            </motion.button>
          </>
        )}
      </div>

    </div>
  );
}
