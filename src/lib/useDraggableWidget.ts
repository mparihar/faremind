'use client';

/**
 * useDraggableWidget — makes a fixed-position floating widget (e.g. the FareMind
 * AI bot launcher) repositionable by mouse on desktop/laptop screens, with the
 * chosen position persisted per browser.
 *
 * Behaviour:
 *  - Desktop/laptop (viewport ≥ 768px): the widget can be dragged anywhere and its
 *    position is saved to localStorage under `storageKey`.
 *  - Mobile (< 768px): dragging is disabled and the widget stays at its BAU fixed
 *    position (x/y forced to 0).
 *
 * Drag only begins after the pointer moves > 4px, so a plain click still opens the
 * bot (use `wasDragged()` in the click handler to ignore the click that ends a drag).
 *
 * Wiring (see GlobalAIBot / FloatingAIAssistant):
 *   const drag = useDraggableWidget('faremind-aibot-pos');
 *   <div ref={drag.constraintsRef} className="fixed inset-2 z-40 pointer-events-none" aria-hidden />
 *   <motion.div drag={drag.isDesktop} dragListener={false} dragControls={drag.dragControls}
 *               dragConstraints={drag.constraintsRef} dragMomentum={false} dragElastic={0}
 *               onDragEnd={drag.onDragEnd} style={{ x: drag.x, y: drag.y }} className="fixed …">
 *     …
 *     <motion.button onPointerDown={drag.startDrag}
 *                    onClick={() => { if (drag.wasDragged()) return; setIsOpen(true); }} … />
 */

import { useEffect, useRef, useState } from 'react';
import { useDragControls, useMotionValue } from 'framer-motion';

const DESKTOP_QUERY = '(min-width: 768px)';

export function useDraggableWidget(storageKey: string) {
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const constraintsRef = useRef<HTMLDivElement>(null);
  const justDraggedRef = useRef(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);

    const apply = () => {
      const desktop = mq.matches;
      setIsDesktop(desktop);
      if (!desktop) {
        // Mobile: keep the BAU fixed anchor.
        x.set(0);
        y.set(0);
        return;
      }
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const p = JSON.parse(saved);
          if (typeof p?.x === 'number') x.set(p.x);
          if (typeof p?.y === 'number') y.set(p.y);
        }
      } catch { /* ignore malformed/blocked storage */ }
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [storageKey, x, y]);

  // Attach to the drag handle's onPointerDown. Starts a drag only after a small
  // movement threshold so ordinary clicks still open the widget. The moment a
  // real drag begins we mark `justDragged` — set BEFORE any click can fire — so
  // the click that ends a drag never opens the panel; a drag only repositions.
  const startDrag = (e: React.PointerEvent) => {
    if (!isDesktop) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
        dragging = true;
        justDraggedRef.current = true; // suppress the click that will follow pointer-up
        dragControls.start(ev);
      }
    };
    const onUp = () => {
      cleanup();
      if (dragging) {
        // Keep the guard up briefly so the trailing click is ignored, then
        // release it so the next genuine click opens the panel (BAU).
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

  // Persist the final position after a drag. (Click suppression is handled in
  // startDrag, not here, because onDragEnd can fire after the browser's click.)
  const onDragEnd = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ x: x.get(), y: y.get() }));
    } catch { /* ignore blocked storage */ }
  };

  const wasDragged = () => justDraggedRef.current;

  return { dragControls, x, y, constraintsRef, isDesktop, startDrag, onDragEnd, wasDragged };
}
