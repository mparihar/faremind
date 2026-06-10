'use client';

import { useEffect, useCallback, useRef } from 'react';

/**
 * Tracks user activity and triggers a logout callback after a period of inactivity.
 *
 * @param timeoutMs   The inactivity duration before triggering logout (e.g., 15 * 60 * 1000 for 15 mins).
 * @param onLogout    The callback to execute when the timeout is reached.
 * @param options.warningMs  Optional: how many ms before timeout to fire onWarning (e.g., 60_000 for 1 min).
 * @param options.onWarning  Optional: callback when the warning threshold is reached.
 *
 * Returns a `resetTimer` function that can be called imperatively (e.g., from a "Stay Signed In" button).
 */
export function useInactivityLogout(
  timeoutMs: number,
  onLogout: () => void,
  options?: { warningMs?: number; onWarning?: () => void },
): { resetTimer: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store the latest callbacks in refs to avoid re-running effects
  const onLogoutRef = useRef(onLogout);
  useEffect(() => { onLogoutRef.current = onLogout; }, [onLogout]);

  const onWarningRef = useRef(options?.onWarning);
  useEffect(() => { onWarningRef.current = options?.onWarning; }, [options?.onWarning]);

  const warningMs = options?.warningMs ?? 0;

  const resetTimer = useCallback(() => {
    // Clear existing timers
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);

    // Set warning timer (fires warningMs before timeout)
    if (warningMs > 0 && warningMs < timeoutMs) {
      warningRef.current = setTimeout(() => {
        onWarningRef.current?.();
      }, timeoutMs - warningMs);
    }

    // Set logout timer
    timerRef.current = setTimeout(() => {
      onLogoutRef.current();
    }, timeoutMs);
  }, [timeoutMs, warningMs]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

    // Start initial timer
    resetTimer();

    // Setup event listeners
    events.forEach(event => {
      window.addEventListener(event, resetTimer, { passive: true });
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [resetTimer]);

  return { resetTimer };
}
