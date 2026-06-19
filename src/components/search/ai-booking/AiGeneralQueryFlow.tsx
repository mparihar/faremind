/**
 * AiGeneralQueryFlow — Conversational general travel Q&A inside the AI Bot.
 * Powered by GPT-4o Mini via POST /api/ai/general-query.
 * Supports text + voice input, conversation memory, and escalation to support.
 *
 * Follows the same UI pattern as AiContactSupportFlow / AiManageBookingFlow.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X, ChevronLeft, MessageCircle, Send, Loader2, Headphones, FileText } from 'lucide-react';
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
} from '@/services/speechRecognitionService';

// ── Chat bubble matching other AI flows ──────────────────────────────────────

function AiBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#0F172A] rounded-xl rounded-bl-sm px-3 py-2.5 mb-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Sparkles className="w-3.5 h-3.5 text-[#1ABC9C]" />
        <span className="text-[13px] font-bold">
          <span className="text-white">FARE</span>
          <span style={{ color: '#009CA6' }}>MIND</span>{' '}
          <span className="text-[#1ABC9C]">AI</span>
        </span>
      </div>
      <div className="text-[15px] text-white/90 leading-relaxed">{children}</div>
    </div>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[#1ABC9C]/10 border border-[#1ABC9C]/20 rounded-xl rounded-br-sm px-3 py-2.5 mb-2 ml-8">
      <div className="text-[14px] text-slate-700 leading-relaxed">{children}</div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  needsEscalation?: boolean;
  recommendedNextStep?: string;
  category?: string;
}

interface Props {
  onExit: () => void;
  onContactSupport?: () => void;
}

// ── Render markdown-like formatting ─────────────────────────────────────────

function renderBotText(text: string) {
  // Split by line breaks and render with basic formatting
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;

        // Bullet points
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
          const content = trimmed.slice(2);
          return (
            <div key={i} className="flex items-start gap-1.5 pl-1">
              <span className="text-[#1ABC9C] mt-1 text-[10px]">●</span>
              <span className="text-[14px]" dangerouslySetInnerHTML={{ __html: formatInline(content) }} />
            </div>
          );
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
        if (numMatch) {
          return (
            <div key={i} className="flex items-start gap-1.5 pl-1">
              <span className="text-[#1ABC9C] font-bold text-[12px] mt-0.5 w-4 shrink-0">{numMatch[1]}.</span>
              <span className="text-[14px]" dangerouslySetInnerHTML={{ __html: formatInline(numMatch[2]) }} />
            </div>
          );
        }

        // Normal text
        return <p key={i} className="text-[14px]" dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }} />;
      })}
    </div>
  );
}

function formatInline(text: string): string {
  // Bold: **text**
  return text.replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
}

// ── Component ───────────────────────────────────────────────────────────────

export default function AiGeneralQueryFlow({ onExit, onContactSupport }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [creatingCase, setCreatingCase] = useState(false);
  const voiceSupported = typeof window !== 'undefined' && isSpeechRecognitionSupported();

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []);

  // ── Voice input ─────────────────────────────────────────────────────────
  const handleVoice = useCallback(async () => {
    if (isRecording) {
      stopListening();
      setIsRecording(false);
      return;
    }
    setIsRecording(true);
    try {
      const result = await startListening((interim) => {
        setInputVal(interim);
      }, { singleShot: false });
      setIsRecording(false);
      if (result.transcript.trim()) {
        setInputVal(result.transcript.trim());
      }
    } catch {
      setIsRecording(false);
    }
  }, [isRecording]);

  // ── Send message ──────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const msg = inputVal.trim();
    if (!msg || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: msg };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputVal('');
    setLoading(true);

    try {
      // Build conversation history for context (last 10 turns)
      const history = updatedMessages.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/ai/general-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          conversationHistory: history.slice(0, -1), // exclude current message (sent separately)
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const botMsg: ChatMessage = {
          role: 'assistant',
          content: data.answer || 'I apologize, I was unable to process your question.',
          needsEscalation: data.needsEscalation,
          recommendedNextStep: data.recommendedNextStep,
          category: data.category,
        };
        setMessages(prev => [...prev, botMsg]);
      } else {
        const botMsg: ChatMessage = {
          role: 'assistant',
          content: 'I apologize, I\'m temporarily unavailable. Please try again or contact FareMind Support at +1 (972) 697-1532.',
        };
        setMessages(prev => [...prev, botMsg]);
      }
    } catch {
      const botMsg: ChatMessage = {
        role: 'assistant',
        content: 'Network error. Please check your connection and try again.',
      };
      setMessages(prev => [...prev, botMsg]);
    }

    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [inputVal, loading, messages]);

  // ── Create support case from conversation ──────────────────────────────
  const handleCreateCase = useCallback(async (category?: string) => {
    setCreatingCase(true);
    try {
      // Build conversation summary
      const summary = messages
        .map(m => `${m.role === 'user' ? 'User' : 'FareMind AI'}: ${m.content}`)
        .join('\n\n');

      const res = await fetch('/api/support/case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'AI_BOT',
          channel: 'CHATBOT',
          issueType: category || 'General Question',
          firstName: 'AI Bot',
          lastName: 'User',
          email: 'via-chatbot@faremind.ai',
          phone: '',
          issueDetails: `[AI Bot General Query — Escalated]\n\nConversation:\n${summary}`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const caseMsg: ChatMessage = {
          role: 'assistant',
          content: `✅ **Support case created!**\n\n**Case ID:** ${data.caseNumber}\n\n${data.slaMessage}\n\nOur support team will review your query and follow up.`,
        };
        setMessages(prev => [...prev, caseMsg]);
      } else {
        const errMsg: ChatMessage = {
          role: 'assistant',
          content: 'Sorry, I couldn\'t create a support case right now. Please contact FareMind Support directly at +1 (972) 697-1532.',
        };
        setMessages(prev => [...prev, errMsg]);
      }
    } catch {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: 'Network error while creating support case. Please try again or call +1 (972) 697-1532.',
      };
      setMessages(prev => [...prev, errMsg]);
    }
    setCreatingCase(false);
  }, [messages]);

  // ── Render ────────────────────────────────────────────────────────────

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-gradient-to-r from-violet-500/5 to-indigo-500/5 flex-none">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onExit}
            className="flex items-center justify-center w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-all mr-0.5"
            title="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <MessageCircle className="w-4 h-4 text-violet-500" />
          <span className="text-[15px] font-bold bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent">
            General Queries
          </span>
        </div>
        <button
          onClick={onExit}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable Chat */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-2 min-h-0"
        style={{ background: 'linear-gradient(180deg, #f5f3ff 0%, #faf9ff 100%)', scrollbarWidth: 'none' }}
      >
        {/* Welcome message */}
        {isEmpty && !loading && (
          <AiBubble>
            Ask me anything about flight booking, baggage, transit, travel documents, route concerns, or FareMind services.
            <span className="text-white/50 text-[12px] block mt-1.5">
              I can answer general travel questions, explain FareMind features, and help with booking guidance.
            </span>
          </AiBubble>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' ? (
              <UserBubble>{msg.content}</UserBubble>
            ) : (
              <>
                <AiBubble>{renderBotText(msg.content)}</AiBubble>

                {/* Escalation buttons */}
                {msg.needsEscalation && (
                  <div className="ml-1 mt-1 mb-2 space-y-1.5">
                    <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
                      <span className="text-amber-500 text-[12px] mt-0.5">⚠️</span>
                      <p className="text-[11px] text-amber-700 leading-snug font-medium">
                        This may need expert review. I can create a FareMind support case for you.
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {onContactSupport && (
                        <button
                          onClick={onContactSupport}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border border-[#1ABC9C]/30 bg-[#1ABC9C]/5 text-[#1ABC9C] hover:bg-[#1ABC9C]/10 transition-all"
                        >
                          <Headphones className="w-3 h-3" />
                          Contact Support
                        </button>
                      )}
                      <button
                        onClick={() => inputRef.current?.focus()}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold border border-violet-300/50 bg-violet-50 text-violet-600 hover:bg-violet-100 transition-all"
                      >
                        <MessageCircle className="w-3 h-3" />
                        Continue Chat
                      </button>
                    </div>
                  </div>
                )}

                {/* Recommended next step */}
                {msg.recommendedNextStep && !msg.needsEscalation && (
                  <div className="ml-1 mb-2 flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
                    <span className="text-blue-400 text-[11px] mt-0.5">💡</span>
                    <p className="text-[11px] text-blue-700 leading-snug">
                      {msg.recommendedNextStep}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <AiBubble>
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#1ABC9C]" />
              <span className="text-white/60 text-[13px]">Thinking…</span>
            </div>
          </AiBubble>
        )}
      </div>

      {/* Input Area */}
      <div className="px-3 py-2.5 border-t border-slate-100 bg-white flex-none">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask a travel question…"
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-[13px] text-slate-800 placeholder-slate-400 outline-none focus:border-violet-400/60 focus:ring-1 focus:ring-violet-400/20 transition-all"
            disabled={loading}
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={!inputVal.trim() || loading}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-500/25 disabled:opacity-30 disabled:shadow-none transition-all"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
          {voiceSupported && (
            <button
              onClick={handleVoice}
              className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all relative ${
                isRecording
                  ? 'text-red-500 ring-2 ring-red-400/40 bg-red-50'
                  : 'text-black/70 hover:text-black cursor-pointer'
              }`}
              title={isRecording ? 'Stop recording' : 'Voice input'}
            >
              {isRecording ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="relative z-10">
                  <rect x="3" y="9" width="2" height="6" rx="1" fill="currentColor">
                    <animate attributeName="height" values="6;10;6" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="y" values="9;7;9" dur="1.2s" repeatCount="indefinite" />
                  </rect>
                  <rect x="7.5" y="7" width="2" height="10" rx="1" fill="currentColor">
                    <animate attributeName="height" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
                    <animate attributeName="y" values="7;10;7" dur="0.9s" repeatCount="indefinite" />
                  </rect>
                  <rect x="12" y="5" width="2" height="14" rx="1" fill="currentColor">
                    <animate attributeName="height" values="14;6;14" dur="1.1s" repeatCount="indefinite" />
                    <animate attributeName="y" values="5;9;5" dur="1.1s" repeatCount="indefinite" />
                  </rect>
                  <rect x="16.5" y="8" width="2" height="8" rx="1" fill="currentColor">
                    <animate attributeName="height" values="8;14;8" dur="1.4s" repeatCount="indefinite" />
                    <animate attributeName="y" values="8;5;8" dur="1.4s" repeatCount="indefinite" />
                  </rect>
                  <rect x="21" y="10" width="2" height="4" rx="1" fill="currentColor">
                    <animate attributeName="height" values="4;10;4" dur="0.8s" repeatCount="indefinite" />
                    <animate attributeName="y" values="10;7;10" dur="0.8s" repeatCount="indefinite" />
                  </rect>
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
