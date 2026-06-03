/**
 * Speech Recognition Service
 *
 * Wraps the browser's Web Speech API (SpeechRecognition) for voice input.
 * Toggle-style: user clicks mic to start, clicks again to stop.
 * Like ChatGPT voice input.
 *
 * Supports Chrome, Edge, and Safari.
 */

export type VoiceState = 'idle' | 'listening' | 'processing' | 'completed' | 'error';

export interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
}

// Browser compatibility — Web Speech API uses vendor prefixes
function getSpeechRecognition(): typeof SpeechRecognition | null {
  if (typeof window === 'undefined') return null;
  return (
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition ||
    null
  );
}

/** Check if the browser supports the Web Speech API */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognition() !== null;
}

let activeRecognition: SpeechRecognition | null = null;
let accumulatedTranscript = '';
let stopRequested = false;

/**
 * Start listening via the browser microphone.
 *
 * Options:
 *  - singleShot: If true, captures a single phrase and stops automatically.
 *    Use this for short form-field inputs (names, numbers). Default: false (continuous).
 *
 * Returns a promise that resolves with the final transcript when stopped.
 * The onInterim callback fires with partial text as user speaks.
 */
export function startListening(
  onInterim?: (text: string) => void,
  options?: { singleShot?: boolean },
): Promise<SpeechRecognitionResult> {
  return new Promise((resolve, reject) => {
    const SpeechRecognitionCtor = getSpeechRecognition();

    if (!SpeechRecognitionCtor) {
      reject(new Error('Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.'));
      return;
    }

    // Stop any existing session
    if (activeRecognition) {
      try { activeRecognition.abort(); } catch { /* ignore */ }
      activeRecognition = null;
    }

    accumulatedTranscript = '';
    stopRequested = false;
    const singleShot = options?.singleShot ?? false;
    const recognition = new SpeechRecognitionCtor();
    activeRecognition = recognition;

    recognition.lang = 'en-US';
    recognition.interimResults = true;    // Show text as user speaks
    recognition.maxAlternatives = 1;
    recognition.continuous = !singleShot; // Single-shot: stop after first phrase

    let settled = false;
    let lastConfidence = 0;

    // Safety timeout — 30s for single-shot, 90s for continuous
    const timeout = setTimeout(() => {
      if (!settled) {
        stopRequested = true;
        try { recognition.stop(); } catch { /* ignore */ }
      }
    }, singleShot ? 30_000 : 90_000);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (settled) return;

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
          lastConfidence = result[0].confidence;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // Accumulate final results
      if (finalTranscript) {
        accumulatedTranscript += (accumulatedTranscript ? ' ' : '') + finalTranscript.trim();
      }

      // Show interim text to user
      const displayText = accumulatedTranscript + (interimTranscript ? ' ' + interimTranscript : '');
      if (displayText.trim() && onInterim) {
        onInterim(displayText.trim());
      }

      // In singleShot mode, resolve as soon as we get a final result
      if (singleShot && finalTranscript) {
        settled = true;
        clearTimeout(timeout);
        activeRecognition = null;
        try { recognition.stop(); } catch { /* ignore */ }
        resolve({ transcript: accumulatedTranscript.trim(), confidence: lastConfidence || 0.9 });
        return;
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (settled) return;

      // 'no-speech' in continuous mode is just a silence gap — don't error
      if (event.error === 'no-speech') return;

      // 'aborted' means user stopped or we cancelled — let onend handle it
      if (event.error === 'aborted') return;

      settled = true;
      clearTimeout(timeout);
      activeRecognition = null;

      switch (event.error) {
        case 'not-allowed':
          reject(new Error('Microphone access is required for Voice Search. Please allow microphone access in your browser settings.'));
          break;
        case 'network':
          reject(new Error('Network error during voice recognition. Please check your connection.'));
          break;
        default:
          reject(new Error("Sorry, I couldn't understand your request. Please try again."));
      }
    };

    recognition.onend = () => {
      if (settled) {
        clearTimeout(timeout);
        activeRecognition = null;
        return;
      }

      const transcript = accumulatedTranscript.trim();

      // If user explicitly stopped (clicked stop button) or timeout hit, resolve/reject
      if (stopRequested) {
        settled = true;
        clearTimeout(timeout);
        activeRecognition = null;

        if (transcript) {
          resolve({ transcript, confidence: lastConfidence || 0.9 });
        } else {
          reject(new Error("I didn't hear anything. Please try speaking again."));
        }
        return;
      }

      // Browser auto-ended (silence gap, no-speech, etc.) but user hasn't clicked stop.
      // If we have transcript, resolve. Otherwise, auto-restart to keep listening.
      if (transcript) {
        settled = true;
        clearTimeout(timeout);
        activeRecognition = null;
        resolve({ transcript, confidence: lastConfidence || 0.9 });
      } else {
        // Auto-restart — browser killed it but user is still expecting to speak
        console.log('[Voice] Auto-restarting recognition (browser ended prematurely)');
        try {
          recognition.start();
          activeRecognition = recognition;
        } catch {
          // Can't restart — give up gracefully
          settled = true;
          clearTimeout(timeout);
          activeRecognition = null;
          reject(new Error("Voice recognition stopped unexpectedly. Please try again."));
        }
      }
    };

    try {
      recognition.start();
    } catch (err) {
      settled = true;
      clearTimeout(timeout);
      activeRecognition = null;
      reject(new Error('Failed to start speech recognition. Please try again.'));
    }
  });
}

/** Stop the active recognition session. Triggers onend which resolves the promise. */
export function stopListening(): void {
  stopRequested = true;
  if (activeRecognition) {
    try { activeRecognition.stop(); } catch { /* ignore */ }
    // Don't null out — let onend handle cleanup and resolve the promise
  }
}

/** Abort (cancel) the active recognition session without resolving. */
export function abortListening(): void {
  accumulatedTranscript = '';
  stopRequested = true;  // Prevent onend from auto-restarting
  if (activeRecognition) {
    try { activeRecognition.abort(); } catch { /* ignore */ }
    activeRecognition = null;
  }
}

/** Check if currently recording */
export function isListening(): boolean {
  return activeRecognition !== null;
}
