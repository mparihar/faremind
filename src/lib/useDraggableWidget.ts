'use client';

/**
 * useDraggableWidget — makes a fixed-position floating widget (e.g. the FareMind
 * AI bot launcher) repositionable by mouse on desktop/laptop screens, with the
 * chosen position persisted per browser.
 *
 * Positioning is done with explicit `left`/`bottom` pixel coordinates (NOT CSS
 * transforms). This is deterministic — the widget stays exactly where it is
 * dropped and never drifts when the panel opens/closes or on re-render. The
 * bottom-left anchor is preserved so the launcher sits at the bottom and the
 * chat panel still opens upward from it.
 *
 * Behaviour:
 *  - Desktop/laptop (viewport >= 768px): drag anywhere; position saved to
 *    localStorage under `storageKey` and clamped to stay on screen.
 *  - Mobile (< 768px): dragging disabled; widget keeps its BAU fixed position.
 *
 * A drag only begins after the pointer moves > 4px, and `justDragged` is set the
 * instant a real drag starts (before any click) so the click that ends a drag
 * never opens the widget — a drag only repositions. Use `wasDragged()` in the
 * click handler; a later, separate click opens it as BAU.
 *
 * Wiring (see GlobalAIBot / FloatingAIAssistant):
 *   const drag = useDraggableWidget('faremind-aibot-pos');
 *   <div ref={drag.ref} style={drag.style} className="fixed … bottom-6 left-6">
 *     …
 *     <button onPointerDown={drag.startDrag}
 *             onClick={() => { if (drag.wasDragged()) return; setIsOpen(true); }} … />
 *   </div>
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';
const EDGE_MARGIN = 8; // keep at least this many px from each viewport edge

type Pos = { left: number; bottom: number };

export function useDraggableWidget(storageKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const justDraggedRef = useRef(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  // Desktop detection + load any saved position.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);

    const apply = () => {
      const desktop = mq.matches;
      setIsDesktop(desktop);
      if (!desktop) {
        setPos(null); // mobile: BAU fixed anchor via CSS classes
        return;
      }
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const p = JSON.parse(saved);
          if (typeof p?.left === 'number' && typeof p?.bottom === 'number') {
            setPos({ left: p.left, bottom: p.bottom });
          }
        }
      } catch { /* ignore malformed/blocked storage */ }
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [storageKey]);

  // Clamp a candidate position so the widget stays fully on screen.
  const clamp = useCallback((left: number, bottom: number): Pos => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
    const maxBottom = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);
    return {
      left: Math.min(Math.max(EDGE_MARGIN, left), maxLeft),
      bottom: Math.min(Math.max(EDGE_MARGIN, bottom), maxBottom),
    };
  }, []);

  // Keep the widget on screen if the viewport is resized.
  useEffect(() => {
    if (!isDesktop || !pos) return;
    const onResize = () => setPos((p) => (p ? clamp(p.left, p.bottom) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isDesktop, pos, clamp]);

  // Attach to the drag handle's onPointerDown.
  const startDrag = (e: React.PointerEvent) => {
    if (!isDesktop) return;
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const startLeft = rect.left;                          // current px from left
    const startBottom = window.innerHeight - rect.bottom; // current px from bottom
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        dragging = true;
        justDraggedRef.current = true; // block the click that follows pointer-up
      }
      if (dragging) {
        ev.preventDefault();
        setPos(clamp(startLeft + dx, startBottom - dy)); // pointer down => smaller bottom
      }
    };
    const onUp = () => {
      cleanup();
      if (dragging) {
        setPos((p) => {
          if (p) { try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* ignore */ } }
          return p;
        });
        // Release the click guard shortly after so the next genuine click opens it (BAU).
        setTimeout(() => { justDraggedRef.current = false; }, 120);
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const wasDragged = () => justDraggedRef.current;

  // Inline position overrides the CSS bottom/left classes only once dragged on
  // desktop; otherwise {} leaves the BAU anchor intact.
  const style: React.CSSProperties = (isDesktop && pos)
    ? { left: pos.left, bottom: pos.bottom, right: 'auto', top: 'auto' }
    : {};

  return { ref, isDesktop, style, startDrag, wasDragged };
}
