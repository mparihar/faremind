'use client';

import { useEffect, useCallback, useRef } from 'react';

/**
 * Tracks user activity and triggers a logout callback after a period of inactivity.
 * @param timeoutMs The inactivity duration before triggering logout (e.g., 15 * 60 * 1000 for 15 mins).
 * @param onLogout The callback to execute when the timeout is reached.
 */
export function useInactivityLogout(timeoutMs: number, onLogout: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Need to wrap onLogout in a ref if we don't want it to cause effect re-runs, 
  // but usually it's stable. To be safe, store the latest callback.
  const onLogoutRef = useRef(onLogout);
  useEffect(() => {
    onLogoutRef.current = onLogout;
  }, [onLogout]);

  const resetTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      onLogoutRef.current();
    }, timeoutMs);
  }, [timeoutMs]);

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
      events.forEach(event => {
        window.removeEventListener(event, resetTimer);
      });
    };
  }, [resetTimer]);
}
