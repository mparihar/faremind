'use client';

/**
 * FareMind Travel Assistant Button
 *
 * Global header component that provides voice-driven flight search
 * and passenger detail filling.
 * Lives in the Navbar, available on every page.
 *
 * Mic behavior: Toggle style like ChatGPT
 *   - Click mic to start recording
 *   - Live transcript shows as user speaks
 *   - Click mic again to stop recording
 *   - GPT parses → fills hero form immediately → shows confirmation
 *
 * Phase 1: Supports SEARCH_FLIGHTS action on HOME_SEARCH context.
 * Phase 2: Supports FILL_PASSENGER_DETAILS / FILL_PRIMARY_CONTACT on PASSENGER_DETAILS context.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Loader2, Check, AlertTriangle, X, Sparkles, Search, RefreshCw, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  isSpeechRecognitionSupported,
  startListening,
  stopListening,
  abortListening,
} from '@/services/speechRecognitionService';
import { parseVoiceCommand, parsePassengerVoiceCommand } from '@/services/voiceParserService';
import type { VoicePassengerResult, PassengerContext } from '@/services/voiceParserService';
import {
  buildVoiceFormData,
  validateVoiceFormData,
  validateActionForContext,
  applyPassengerVoiceData,
  commitVoiceData,
  forceApplyConflicts,
  type VoiceFormData,
  type PassengerFillResult,
  type FilledField,
  type FieldConflict,
} from '@/actions/voiceActionEngine';
import { getPageContext, type PageContext } from '@/contexts/pageContextRegistry';
import { useVoiceStore } from '@/store/useVoiceStore';
import { useCheckoutStore } from '@/store/useCheckoutStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useTravelDnaStore } from '@/store/useTravelDnaStore';

// ─── Types ──────────────────────────────────────────────────────────────────

type AssistantState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'confirmation'              // flight search confirmation
  | 'passenger_confirmation'    // passenger fill success summary
  | 'passenger_conflicts'       // overwrite confirmation
  | 'passenger_clarify'         // ambiguous traveler
  | 'executing'
  | 'error';

// ─── Example phrases ────────────────────────────────────────────────────────

const SEARCH_EXAMPLE_PHRASES = [
  'Find me a flight from DFW to Delhi for 2 adults.',
  'Search flights from New York to Rome next Friday.',
  'Find me a round-trip flight to London for 2 adults and 1 child.',
  'One way flight from New York to Paris in business class.',
  'Find flights from Miami to Cancun for tomorrow.',
];

const PASSENGER_EXAMPLE_PHRASES = [
  'Fill Traveler 1: first name Rishi, last name Parihar, male, born August 15 2005.',
  'Update primary contact: email john@example.com, phone +1 972 555 1234.',
  'Fill child traveler: first name Aarav, last name Sharma, male, born June 10 2018.',
  'Update Traveler 2 passport number to P9876543.',
  'Fill Traveler 1 nationality India, passport country India, passport P12345678.',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function cabinLabel(cabin: string): string {
  switch (cabin) {
    case 'premium_economy': return 'Premium Economy';
    case 'business': return 'Business';
    case 'first': return 'First';
    default: return 'Economy';
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function FareMindTravelAssistantButton() {
  const pathname = usePathname();
  const router = useRouter();
  const searchFormRef = useVoiceStore((s) => s.searchFormRef);
  const { user, sessionToken } = useAuthStore();
  const { profile: dnaProfile, fetchProfile: fetchDna, fetched: dnaFetched } = useTravelDnaStore();

  // Core states
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<AssistantState>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [exampleIndex, setExampleIndex] = useState(0);

  // Flight search states
  const [formData, setFormData] = useState<VoiceFormData | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);

  // Passenger fill states
  const [passengerFillResult, setPassengerFillResult] = useState<PassengerFillResult | null>(null);
  const [passengerParsed, setPassengerParsed] = useState<VoicePassengerResult | null>(null);
  const [clarifyMessage, setClarifyMessage] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const supported = isSpeechRecognitionSupported();
  const pageContext: PageContext = getPageContext(pathname);
  const isPassengerPage = pageContext === 'PASSENGER_DETAILS';

  // Get example phrases based on context
  const examplePhrases = isPassengerPage ? PASSENGER_EXAMPLE_PHRASES : SEARCH_EXAMPLE_PHRASES;

  // Rotate example phrases
  useEffect(() => {
    const interval = setInterval(() => {
      setExampleIndex((i) => (i + 1) % examplePhrases.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [examplePhrases.length]);

  // Close on outside click — only when idle or error
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (state === 'idle' || state === 'error') {
          handleClose();
        }
      }
    }
    if (expanded) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [expanded, state]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    abortListening();
    setExpanded(false);
    setState('idle');
    setLiveTranscript('');
    setFinalTranscript('');
    setFormData(null);
    setMissingFields([]);
    setErrorMessage('');
    setPassengerFillResult(null);
    setPassengerParsed(null);
    setClarifyMessage('');
  }, []);

  const handleOpen = useCallback(() => {
    setExpanded(true);
    setState('idle');
    // Fetch Travel DNA status if user is logged in
    if (user && sessionToken && !dnaFetched) {
      fetchDna(sessionToken);
    }
    console.log('[Voice] Assistant Opened');
  }, [user, sessionToken, dnaFetched, fetchDna]);

  // Toggle mic — ChatGPT style
  const handleToggleMic = useCallback(async () => {
    if (!supported) {
      setErrorMessage('Voice search is not supported in this browser. Please use Chrome, Edge, or Safari.');
      setState('error');
      return;
    }

    if (state === 'listening') {
      console.log('[Voice] User stopped recording');
      stopListening();
      return;
    }

    // Start recording
    setState('listening');
    setLiveTranscript('');
    setFinalTranscript('');
    setFormData(null);
    setMissingFields([]);
    setPassengerFillResult(null);
    setPassengerParsed(null);
    setClarifyMessage('');
    setErrorMessage('');
    setExpanded(true);
    console.log('[Voice] Recording Started');

    try {
      const result = await startListening((interimText) => {
        setLiveTranscript(interimText);
      });

      const transcript = result.transcript;
      setFinalTranscript(transcript);
      setLiveTranscript(transcript);
      console.log('[Voice] Transcript:', transcript, 'Confidence:', result.confidence);

      setState('processing');
      console.log('[Voice] Parsing command...');

      try {
        // ── Branch by page context ────────────────────────────────────
        if (isPassengerPage) {
          await handlePassengerParse(transcript);
        } else {
          await handleSearchParse(transcript);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to understand command.';
        setErrorMessage(msg);
        setState('error');
        console.error('[Voice] Parse Failed:', msg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voice recognition failed.';
      if (msg.includes('cancelled') || msg.includes('aborted') || msg.includes("didn't hear")) {
        setState('idle');
        return;
      }
      setErrorMessage(msg);
      setState('error');
      setExpanded(true); // Keep panel open so user sees the friendly error message
      console.warn('[Voice] Recording Failed:', msg);
    }
  }, [supported, state, isPassengerPage]);

  // ── Flight search parse ─────────────────────────────────────────────────

  const handleSearchParse = useCallback(async (transcript: string) => {
    const parsed = await parseVoiceCommand(transcript, 'HOME_SEARCH');
    const data = buildVoiceFormData(parsed.params);
    const validation = validateVoiceFormData(data);

    setFormData(data);
    setMissingFields(validation.missingFields);
    console.log('[Voice] Command Parsed:', data);

    // Helper: attempt to fill the form, retrying briefly if ref isn't registered yet
    const tryFillForm = async (): Promise<boolean> => {
      // Try immediately
      const ref = useVoiceStore.getState().searchFormRef;
      if (ref) {
        ref.fillFromVoice(data);
        console.log('[Voice] Hero form populated — user will verify & click Search');
        return true;
      }
      // Ref not ready — retry a few times (SearchForm registers on mount after refresh)
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => setTimeout(r, 150));
        const retryRef = useVoiceStore.getState().searchFormRef;
        if (retryRef) {
          retryRef.fillFromVoice(data);
          console.log(`[Voice] Hero form populated on retry ${attempt + 1}`);
          return true;
        }
      }
      return false;
    };

    if (pageContext === 'HOME_SEARCH') {
      const filled = await tryFillForm();
      if (!filled) {
        // Last resort: stash in sessionStorage and force a reload so the recovery effect picks it up
        sessionStorage.setItem('faremind_voice_search', JSON.stringify(data));
        window.location.reload();
        console.log('[Voice] SearchForm ref unavailable — reloading to apply voice data');
        return;
      }
    } else {
      sessionStorage.setItem('faremind_voice_search', JSON.stringify(data));
      router.push('/');
      console.log('[Voice] Redirecting to homepage with voice data');
    }

    handleClose();
  }, [pageContext, router, handleClose]);

  // ── Passenger parse ─────────────────────────────────────────────────────

  const handlePassengerParse = useCallback(async (transcript: string) => {
    const passengers = useCheckoutStore.getState().passengers;

    // Build passenger context for the API
    const passengerContext: PassengerContext = {
      totalTravelers: passengers.length,
      travelers: passengers.map((p, i) => ({
        travelerIndex: i + 1,
        passengerType: p.type.toUpperCase() as 'ADULT' | 'CHILD' | 'INFANT',
      })),
    };

    const parsed = await parsePassengerVoiceCommand(transcript, passengerContext);
    setPassengerParsed(parsed);
    console.log('[Voice] Passenger command parsed:', parsed);

    // Handle CLARIFY
    if (parsed.action === 'CLARIFY') {
      setClarifyMessage(parsed.message || 'Which traveler should I update?');
      setState('passenger_clarify');
      return;
    }

    // Get departure date for validation
    const store = useCheckoutStore.getState();
    const departureDate = (() => {
      if (store.sourceFlight?.segments?.[0]?.departure?.time) {
        return store.sourceFlight.segments[0].departure.time.split('T')[0];
      }
      if (store.sourceRoundTrip?.outboundJourney?.departureTime) {
        return store.sourceRoundTrip.outboundJourney.departureTime.split('T')[0];
      }
      return undefined;
    })();

    // Preview the parsed data (dryRun: don't apply to form yet)
    const fillResult = applyPassengerVoiceData(
      parsed,
      passengers,
      useCheckoutStore.getState().updatePassenger,
      departureDate,
      false, // don't force overwrite
      true,  // dryRun — wait for user confirmation before applying
    );

    setPassengerFillResult(fillResult);
    console.log('[Voice] Passenger fill result:', fillResult);

    if (fillResult.conflicts.length > 0) {
      setState('passenger_conflicts');
    } else {
      setState('passenger_confirmation');
    }
  }, []);

  // ── Handle replace all conflicts ────────────────────────────────────────

  const handleReplaceAll = useCallback(() => {
    if (!passengerFillResult || !passengerParsed) return;

    const passengers = useCheckoutStore.getState().passengers;
    const targetPax = passengers[passengerFillResult.targetIndex];
    if (!targetPax) return;

    const extraFilled = forceApplyConflicts(
      passengerFillResult.conflicts,
      targetPax,
      useCheckoutStore.getState().updatePassenger,
      passengerParsed.params,
    );

    // Merge into fill result
    setPassengerFillResult(prev => prev ? {
      ...prev,
      filledFields: [...prev.filledFields, ...extraFilled],
      conflicts: [],
    } : null);

    setState('passenger_confirmation');
    console.log('[Voice] Conflicts resolved — replaced all');
  }, [passengerFillResult, passengerParsed]);

  const handleKeepExisting = useCallback(() => {
    // Just move to confirmation without applying conflicts
    setPassengerFillResult(prev => prev ? { ...prev, conflicts: [] } : null);
    setState('passenger_confirmation');
    console.log('[Voice] Conflicts resolved — kept existing');
  }, []);

  // Commit voice data only when user confirms ("Looks Good")
  const handleConfirmPassenger = useCallback(() => {
    if (passengerFillResult) {
      commitVoiceData(passengerFillResult, useCheckoutStore.getState().updatePassenger);
    }
    handleClose();
  }, [passengerFillResult, handleClose]);

  // ── Flight search execute ───────────────────────────────────────────────

  const handleSearch = useCallback(() => {
    if (!formData) return;

    setState('executing');
    console.log('[Voice] Executing search...');

    const currentRef = useVoiceStore.getState().searchFormRef;
    if (pageContext === 'HOME_SEARCH' && currentRef) {
      currentRef.triggerSearch();
      handleClose();
      console.log('[Voice] Flight Search Executed');
    } else if (pageContext !== 'HOME_SEARCH') {
      sessionStorage.setItem('faremind_voice_search', JSON.stringify(formData));
      router.push('/');
      handleClose();
    } else {
      const p = formData;
      const params = new URLSearchParams({
        origin: p.originCode,
        destination: p.destCode,
        date: p.departureDate,
        adults: p.passengers.adults.toString(),
        children: p.passengers.children.toString(),
        infants: p.passengers.infants.toString(),
        cabin: p.cabinClass,
        trip: p.tripType,
      });
      if (p.tripType === 'round_trip' && p.returnDate) {
        params.set('return', p.returnDate);
      }
      router.push(`/search?${params.toString()}`);
      handleClose();
    }
  }, [formData, pageContext, searchFormRef, router, handleClose]);

  const handleRetry = useCallback(() => {
    setLiveTranscript('');
    setFinalTranscript('');
    setFormData(null);
    setMissingFields([]);
    setPassengerFillResult(null);
    setPassengerParsed(null);
    setClarifyMessage('');
    setErrorMessage('');
    setState('idle');
  }, []);

  // ─── Header button states ──────────────────────────────────────────────

  const headerIcon = (() => {
    switch (state) {
      case 'listening': return <Mic className="w-4 h-4 text-red-400 animate-pulse" />;
      case 'processing':
      case 'executing': return <Loader2 className="w-4 h-4 text-[#1ABC9C] animate-spin" />;
      case 'confirmation':
      case 'passenger_confirmation': return <Check className="w-4 h-4 text-green-400" />;
      case 'error': return <AlertTriangle className="w-4 h-4 text-red-400" />;
      default: return <Mic className="w-4 h-4" />;
    }
  })();

  const headerLabel = (() => {
    switch (state) {
      case 'listening': return 'Listening...';
      case 'processing': return 'Understanding...';
      case 'executing': return 'Searching...';
      case 'confirmation': return 'Ready';
      case 'passenger_confirmation': return 'Filled';
      case 'passenger_conflicts': return 'Confirm';
      case 'passenger_clarify': return 'Clarify';
      case 'error': return 'Error';
      default: return 'Voice';
    }
  })();

  // ─── Passenger label helper ────────────────────────────────────────────

  const paxLabel = (data: VoiceFormData) => {
    const parts: string[] = [];
    if (data.passengers.adults > 0) parts.push(`${data.passengers.adults} Adult${data.passengers.adults > 1 ? 's' : ''}`);
    if (data.passengers.children > 0) parts.push(`${data.passengers.children} Child${data.passengers.children > 1 ? 'ren' : ''}`);
    if (data.passengers.infants > 0) parts.push(`${data.passengers.infants} Infant${data.passengers.infants > 1 ? 's' : ''}`);
    return parts.join(', ') || '1 Adult';
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div ref={panelRef} className="relative">
      {/* Header button */}
      <button
        onClick={() => {
          if (state === 'listening') {
            handleToggleMic(); // Stop recording
          } else if (!expanded) {
            handleOpen();
          } else if (state === 'idle') {
            handleClose();
          }
        }}
        className={cn(
          'relative flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all duration-200',
          expanded
            ? 'text-white bg-white/[0.08] border border-white/[0.1]'
            : 'text-white/60 hover:text-white hover:bg-white/[0.05] border border-transparent',
          state === 'listening' && 'ring-2 ring-red-400/50 bg-red-500/[0.08] text-red-300 border-red-500/20',
          state === 'error' && 'text-red-400',
          state === 'idle' && !expanded && 'animate-[assistant-glow_3s_ease-in-out_infinite]',
        )}
      >
        {/* Pulsing ring behind button when idle */}
        {state === 'idle' && !expanded && (
          <span className="absolute inset-0 rounded-xl border border-[#1ABC9C]/40 animate-ping opacity-30 pointer-events-none" />
        )}
        {state === 'idle' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="relative z-10">
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
        ) : (
          headerIcon
        )}
        <span className="hidden lg:inline">{headerLabel}</span>
      </button>

      {/* Expanded panel dropdown */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-[340px] bg-[#0f1525] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-[100]"
          >
            <div className="p-4 pt-3 space-y-3 relative">
              {/* Close button — top right */}
              <button
                onClick={handleClose}
                className="absolute top-2 right-2 p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all z-10"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              {/* ── Idle state: show example + mic ── */}
              {state === 'idle' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  {/* Try Saying box + Mic button (outside, right) — side by side, vertically centered */}
                  <div className="flex items-center gap-2.5">
                    {/* Try Saying box */}
                    <div className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Try saying</p>
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={exampleIndex}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.3 }}
                          className="text-xs text-slate-300 font-medium leading-relaxed"
                        >
                          &ldquo;{examplePhrases[exampleIndex]}&rdquo;
                        </motion.p>
                      </AnimatePresence>
                    </div>

                    {/* White circle mic button — outside the box, right side, vertically centered */}
                    <button
                      onClick={handleToggleMic}
                      disabled={!supported}
                      className={cn(
                        'relative w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0',
                        supported
                          ? 'bg-white hover:bg-slate-100 shadow-lg shadow-white/25 active:scale-[0.93]'
                          : 'bg-white/10 cursor-not-allowed',
                      )}
                    >
                      {supported && (
                        <span className="absolute inset-0 rounded-full bg-white/30 animate-ping opacity-40" />
                      )}
                      {/* Voice wave bars */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="relative z-10">
                        <rect x="4" y="8" width="2.5" height="8" rx="1.25" fill={supported ? '#0f1525' : '#666'}>
                          <animate attributeName="height" values="8;14;8" dur="1.2s" repeatCount="indefinite" />
                          <animate attributeName="y" values="8;5;8" dur="1.2s" repeatCount="indefinite" />
                        </rect>
                        <rect x="8.5" y="5" width="2.5" height="14" rx="1.25" fill={supported ? '#0f1525' : '#666'}>
                          <animate attributeName="height" values="14;6;14" dur="1s" repeatCount="indefinite" />
                          <animate attributeName="y" values="5;9;5" dur="1s" repeatCount="indefinite" />
                        </rect>
                        <rect x="13" y="7" width="2.5" height="10" rx="1.25" fill={supported ? '#0f1525' : '#666'}>
                          <animate attributeName="height" values="10;16;10" dur="1.4s" repeatCount="indefinite" />
                          <animate attributeName="y" values="7;4;7" dur="1.4s" repeatCount="indefinite" />
                        </rect>
                        <rect x="17.5" y="9" width="2.5" height="6" rx="1.25" fill={supported ? '#0f1525' : '#666'}>
                          <animate attributeName="height" values="6;12;6" dur="0.9s" repeatCount="indefinite" />
                          <animate attributeName="y" values="9;6;9" dur="0.9s" repeatCount="indefinite" />
                        </rect>
                      </svg>
                    </button>
                  </div>

                  {!supported && (
                    <p className="text-[10px] text-red-400 text-center font-medium">
                      Voice search requires Chrome, Edge, or Safari.
                    </p>
                  )}

                  {/* Travel DNA Status */}
                  <div className="pt-1.5 border-t border-white/[0.04]">
                    {user && dnaProfile?.status === 'ACTIVE' ? (
                      <a href="/travel-dna" className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-all group">
                        <span className="text-[10px]">🧬</span>
                        <span className="text-[10px] text-[#1ABC9C] font-semibold">Your FAREMIND DNA™ is ready — I can personalize recommendations.</span>
                      </a>
                    ) : user && dnaProfile?.status === 'LEARNING' ? (
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-[10px]">🧬</span>
                        <span className="text-[10px] text-amber-400/70 font-medium">Learning your travel preferences. Complete more bookings.</span>
                      </div>
                    ) : !user ? (
                      <a href="/auth/login" className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-all">
                        <span className="text-[10px]">🧬</span>
                        <span className="text-[10px] text-slate-500 font-medium">Sign in to enable <span className="font-black text-white">FARE</span><span className="font-black" style={{ color: '#009CA6' }}>MIND</span> DNA™.</span>
                      </a>
                    ) : null}
                  </div>
                </motion.div>
              )}

              {/* ── Listening state — End button + Cancel/Try Again ── */}
              {state === 'listening' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  {/* Transcript box + End button — side by side, vertically centered */}
                  <div className="flex items-center gap-2.5">
                    {/* Live transcript / prompt box */}
                    <div className="flex-1 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        {liveTranscript ? 'Hearing' : 'Listening'}
                      </p>
                      {liveTranscript ? (
                        <p className="text-xs text-white font-medium leading-relaxed">
                          {liveTranscript}
                          <span className="inline-block w-0.5 h-3.5 bg-[#1ABC9C] animate-pulse ml-0.5 align-text-bottom" />
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 font-medium leading-relaxed">
                          {isPassengerPage ? 'Start speaking passenger details...' : 'Start speaking your flight search...'}
                        </p>
                      )}
                    </div>

                    {/* White pill "End" button — matches reference image */}
                    <button
                      onClick={handleToggleMic}
                      className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white hover:bg-slate-100 shadow-lg shadow-white/25 active:scale-[0.95] transition-all shrink-0"
                    >
                      {/* Animated voice wave dots */}
                      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" className="relative z-10">
                        <circle cx="4" cy="10" r="2" fill="#0f1525">
                          <animate attributeName="cy" values="10;6;10" dur="0.8s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="10" cy="10" r="2" fill="#0f1525">
                          <animate attributeName="cy" values="10;14;10" dur="0.6s" repeatCount="indefinite" />
                        </circle>
                        <circle cx="16" cy="10" r="2" fill="#0f1525">
                          <animate attributeName="cy" values="10;6;10" dur="0.7s" repeatCount="indefinite" />
                        </circle>
                      </svg>
                      <span className="text-xs font-bold text-[#0f1525] relative z-10">End</span>
                    </button>
                  </div>

                  {/* Cancel + Try Again buttons */}
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={() => { abortListening(); setState('idle'); setLiveTranscript(''); }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                    <button
                      onClick={() => { abortListening(); setLiveTranscript(''); setFinalTranscript(''); handleToggleMic(); }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Try Again
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ── Processing state ── */}
              {state === 'processing' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  {/* Show captured transcript */}
                  <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Heard</p>
                    <p className="text-sm text-white font-semibold leading-relaxed">&ldquo;{finalTranscript}&rdquo;</p>
                  </div>
                  <div className="flex items-center justify-center gap-2 py-2">
                    <Loader2 className="w-4 h-4 text-[#1ABC9C] animate-spin" />
                    <p className="text-xs text-slate-400 font-medium">
                      {isPassengerPage ? 'Understanding passenger details...' : 'Understanding your request...'}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── Flight Search Confirmation state ── */}
              {state === 'confirmation' && formData && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#1ABC9C]" />
                    <p className="text-xs font-bold text-[#1ABC9C]">Form populated — review below</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[9px] font-bold text-slate-500 uppercase">From</p>
                      <p className="text-sm font-bold text-white truncate">{formData.originCode || <span className="text-red-400 text-xs">Missing</span>}</p>
                    </div>
                    <div className="px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[9px] font-bold text-slate-500 uppercase">To</p>
                      <p className="text-sm font-bold text-white truncate">{formData.destCode || <span className="text-red-400 text-xs">Missing</span>}</p>
                    </div>
                    <div className="px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[9px] font-bold text-slate-500 uppercase">Departure</p>
                      <p className="text-xs font-bold text-white">{formatDate(formData.departureDate)}</p>
                    </div>
                    <div className="px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[9px] font-bold text-slate-500 uppercase">{formData.tripType === 'round_trip' ? 'Return' : 'Trip'}</p>
                      <p className="text-xs font-bold text-white">{formData.tripType === 'round_trip' ? formatDate(formData.returnDate) : 'One Way'}</p>
                    </div>
                  </div>

                  <div className="px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center gap-2">
                    <p className="text-xs text-white font-bold">{paxLabel(formData)}</p>
                    <span className="text-slate-600">·</span>
                    <p className="text-xs text-slate-400 font-semibold">{cabinLabel(formData.cabinClass)}</p>
                  </div>

                  {missingFields.length > 0 && (
                    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-red-500/[0.08] border border-red-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-400 font-medium">
                        Missing {missingFields.join(' and ')}. Please edit the search form or retry.
                      </p>
                    </div>
                  )}

                  {missingFields.length === 0 && (
                    <p className="text-xs text-slate-400 font-medium">
                      ✓ The search form has been filled. Click below to search or edit the form directly.
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSearch}
                      disabled={missingFields.length > 0}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[#1ABC9C]/20"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Search Flights
                    </button>
                    <button
                      onClick={handleRetry}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                    <button
                      onClick={handleClose}
                      className="p-2.5 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ══ PHASE 2: Passenger Confirmation ══ */}
              {state === 'passenger_confirmation' && passengerFillResult && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  {/* Success header */}
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-[#1ABC9C]/20 flex items-center justify-center">
                      <Check className="w-3 h-3 text-[#1ABC9C]" />
                    </div>
                    <p className="text-xs font-bold text-[#1ABC9C]">
                      {passengerFillResult.targetLabel} details updated.
                    </p>
                  </div>

                  {/* Filled fields list */}
                  {passengerFillResult.filledFields.length > 0 && (
                    <div className="px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-1.5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Filled</p>
                      {passengerFillResult.filledFields.map((f) => (
                        <div key={f.field} className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 font-medium">{f.label}</span>
                          <span className="text-[11px] text-white font-semibold">{f.displayValue}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Validation warnings */}
                  {passengerFillResult.validationErrors.length > 0 && (
                    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-amber-500/[0.08] border border-amber-500/20">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        {passengerFillResult.validationErrors.map((err, i) => (
                          <p key={i} className="text-xs text-amber-400 font-medium leading-relaxed">{err}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing fields */}
                  {passengerFillResult.missingFields.length > 0 && (
                    <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <AlertTriangle className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-slate-400 font-medium">
                        I still need: {passengerFillResult.missingFields.join(', ')}.
                      </p>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleConfirmPassenger}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:brightness-110 transition-all shadow-lg shadow-[#1ABC9C]/20"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Looks Good
                    </button>
                    <button
                      onClick={handleClose}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      Edit Manually
                    </button>
                    <button
                      onClick={handleRetry}
                      className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Retry
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ══ PHASE 2: Passenger Conflicts ══ */}
              {state === 'passenger_conflicts' && passengerFillResult && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  {/* Warning header */}
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                    </div>
                    <p className="text-xs font-bold text-amber-400">
                      Some fields already have values
                    </p>
                  </div>

                  {/* Already filled fields (applied without conflict) */}
                  {passengerFillResult.filledFields.length > 0 && (
                    <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-1">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Applied</p>
                      {passengerFillResult.filledFields.map((f) => (
                        <div key={f.field} className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-400 font-medium">{f.label}</span>
                          <span className="text-[11px] text-[#1ABC9C] font-semibold">{f.displayValue}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Conflict fields */}
                  <div className="px-3 py-2.5 rounded-lg bg-amber-500/[0.05] border border-amber-500/20 space-y-2">
                    <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Replace?</p>
                    {passengerFillResult.conflicts.map((c) => (
                      <div key={c.field} className="flex items-center gap-2 text-[11px]">
                        <span className="text-slate-400 font-medium shrink-0">{c.label}:</span>
                        <span className="text-slate-500 line-through">{c.existingValue}</span>
                        <span className="text-slate-600">→</span>
                        <span className="text-white font-semibold">{c.newValue}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleReplaceAll}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-white bg-amber-500 hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/20"
                    >
                      Replace All
                    </button>
                    <button
                      onClick={handleKeepExisting}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-bold text-slate-300 bg-white/[0.06] hover:bg-white/[0.1] transition-all border border-white/[0.08]"
                    >
                      Keep Existing
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ══ PHASE 2: Passenger Clarify ══ */}
              {state === 'passenger_clarify' && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
                      <User className="w-3 h-3 text-blue-400" />
                    </div>
                    <p className="text-xs font-bold text-blue-400">{clarifyMessage}</p>
                  </div>

                  {/* Show traveler buttons */}
                  <div className="space-y-1.5">
                    {useCheckoutStore.getState().passengers.map((pax, i) => (
                      <button
                        key={pax.id}
                        onClick={() => {
                          // Re-parse with explicit traveler index
                          handleRetry();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] transition-all text-left"
                      >
                        <div className="w-6 h-6 rounded-full bg-[#1ABC9C]/10 flex items-center justify-center text-[10px] font-bold text-[#1ABC9C]">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-xs text-white font-semibold">
                            Traveler {i + 1}
                          </p>
                          <p className="text-[10px] text-slate-500 font-medium capitalize">
                            {pax.type} {pax.firstName ? `· ${pax.firstName} ${pax.lastName}` : ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleRetry}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Try Again with Specific Traveler
                  </button>
                </motion.div>
              )}

              {/* ── Error state ── */}
              {state === 'error' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-3"
                >
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-red-500/[0.08] border border-red-500/20">
                    <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-400 font-medium leading-relaxed">{errorMessage}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRetry}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:brightness-110 transition-all shadow-lg shadow-[#1ABC9C]/20"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      Try Again
                    </button>
                    <button
                      onClick={handleClose}
                      className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
