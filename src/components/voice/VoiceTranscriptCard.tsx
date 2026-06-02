'use client';

/**
 * VoiceTranscriptCard
 *
 * Shows the captured speech transcript for user verification.
 * Used inside the FareMindTravelAssistantButton dropdown panel.
 */

import { motion } from 'framer-motion';
import { MessageSquareQuote, RefreshCw, ArrowRight, X } from 'lucide-react';

interface VoiceTranscriptCardProps {
  transcript: string;
  onContinue: () => void;
  onRetry: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function VoiceTranscriptCard({
  transcript,
  onContinue,
  onRetry,
  onCancel,
  loading = false,
}: VoiceTranscriptCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      {/* Transcript display */}
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-[#1ABC9C]/10 flex items-center justify-center shrink-0 mt-0.5">
          <MessageSquareQuote className="w-3.5 h-3.5 text-[#1ABC9C]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Heard</p>
          <p className="text-sm font-semibold text-white leading-relaxed">
            &ldquo;{transcript}&rdquo;
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onContinue}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold text-white bg-[#1ABC9C] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-wait shadow-lg shadow-[#1ABC9C]/20"
        >
          {loading ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Understanding...
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
        <button
          onClick={onRetry}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-50"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
        <button
          onClick={onCancel}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
