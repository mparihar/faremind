'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * An always-visible horizontal scrollbar for a scrolling element.
 *
 * The fare row already scrolled, but the native bar was invisible at rest: it is
 * styled `scrollbar-width: thin`, and modern Chrome honours that standard
 * property over the `::-webkit-scrollbar` rules — so on any machine with
 * overlay/auto-hiding scrollbars the row read as a card mysteriously clipped at
 * the edge, with nothing to say more fares existed.
 *
 * This draws the track and thumb as real elements, so it is there whether or not
 * the OS shows its own. It hides itself when the content fits, and it drives the
 * same `scrollLeft` the wheel, trackpad and touch already use — nothing about
 * native scrolling changes.
 */
export default function HScrollbar({
  targetRef,
  className = '',
  label = 'Scroll fares',
  controlsId,
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  className?: string;
  label?: string;
  /** id of the scrolling element, for aria-controls. Passed rather than read
   *  off the ref, which is not safe to touch during render. */
  controlsId?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);
  const [{ thumbWidth, thumbLeft, overflows, percent }, setMetrics] = useState({
    thumbWidth: 0, thumbLeft: 0, overflows: false, percent: 0,
  });

  const MIN_THUMB = 44;

  const measure = useCallback(() => {
    const el = targetRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const { scrollWidth, clientWidth, scrollLeft } = el;
    const trackWidth = track.clientWidth;
    // A sub-pixel difference is not overflow; it is rounding.
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    const overflows = maxScroll > 1 && trackWidth > 0;

    if (!overflows) {
      setMetrics({ thumbWidth: 0, thumbLeft: 0, overflows: false, percent: 0 });
      return;
    }
    const width = Math.max(MIN_THUMB, (clientWidth / scrollWidth) * trackWidth);
    const left = (scrollLeft / maxScroll) * (trackWidth - width);
    setMetrics({
      thumbWidth: width, thumbLeft: left, overflows: true,
      percent: Math.round((scrollLeft / maxScroll) * 100),
    });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    measure();

    el.addEventListener('scroll', measure, { passive: true });
    // Tab changes swap the fares in place, so the row's width changes without a
    // window resize — observe the element itself rather than the viewport.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    window.addEventListener('resize', measure);

    return () => {
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [targetRef, measure]);

  const scrollFromPointer = useCallback((clientX: number) => {
    const el = targetRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const usable = rect.width - thumbWidth;
    if (usable <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - thumbWidth / 2) / usable));
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  }, [targetRef, thumbWidth]);

  const onThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startScroll: el.scrollLeft };
  };

  const onThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const el = targetRef.current;
    const track = trackRef.current;
    if (!drag || !el || !track || drag.pointerId !== e.pointerId) return;
    const usable = track.clientWidth - thumbWidth;
    if (usable <= 0) return;
    const perPixel = (el.scrollWidth - el.clientWidth) / usable;
    el.scrollLeft = drag.startScroll + (e.clientX - drag.startX) * perPixel;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    if (!el) return;
    const page = el.clientWidth * 0.9;
    const step = 120;
    const moves: Record<string, number> = {
      ArrowLeft: -step, ArrowRight: step, PageUp: -page, PageDown: page,
    };
    if (e.key === 'Home') { el.scrollLeft = 0; e.preventDefault(); return; }
    if (e.key === 'End') { el.scrollLeft = el.scrollWidth; e.preventDefault(); return; }
    const delta = moves[e.key];
    if (delta !== undefined) { el.scrollLeft += delta; e.preventDefault(); }
  };

  // Nothing to scroll — say nothing rather than show a dead track.
  if (!overflows) return null;

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label={label}
      aria-orientation="horizontal"
      aria-controls={controlsId}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        // Clicking the track jumps to that position; dragging the thumb is handled below.
        if (e.target === trackRef.current) scrollFromPointer(e.clientX);
      }}
      className={`relative h-2.5 w-full rounded-full bg-slate-200/80 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ABC9C] ${className}`}
    >
      <div
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ width: `${thumbWidth}px`, transform: `translateX(${thumbLeft}px)` }}
        className="absolute top-0 left-0 h-full rounded-full bg-slate-400 hover:bg-slate-500 active:bg-slate-600 transition-colors touch-none"
      />
    </div>
  );
}
