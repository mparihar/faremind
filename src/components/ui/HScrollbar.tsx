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
 * the OS shows its own. It drives the same `scrollLeft` the wheel, trackpad and
 * touch already use — nothing about native scrolling changes.
 *
 * ── Why the track is always mounted ──────────────────────────────────────────
 *
 * An earlier version returned null while `overflows` was false, which deadlocked
 * it: the track was never in the DOM, so `trackRef.current` was null, so
 * `measure()` bailed on its first line, so `overflows` never became true, so the
 * track was never mounted. The bar could not appear for any content at all —
 * which is exactly what three rounds of "it still isn't showing" looked like.
 *
 * The element is now always rendered and merely hidden when there is nothing to
 * scroll. Measurement never depends on the outcome of measurement.
 */

/**
 * The track and thumb have to be visible against the surface they sit on. The
 * original light-only colours disappeared completely on the admin console's
 * slate-900 tables — the bar was there, doing nothing anyone could see, which is
 * the same failure as having no bar at all.
 */
const TONES = {
  light: { track: 'bg-slate-200', thumb: 'bg-slate-400 hover:bg-slate-500 active:bg-slate-600' },
  dark:  { track: 'bg-slate-700/50', thumb: 'bg-slate-500 hover:bg-slate-400 active:bg-[#1ABC9C]' },
} as const;

export default function HScrollbar({
  targetRef,
  className = '',
  label = 'Scroll',
  controlsId,
  tone = 'light',
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  className?: string;
  label?: string;
  /** id of the scrolling element, for aria-controls. Passed rather than read
   *  off the ref, which is not safe to touch during render. */
  controlsId?: string;
  /** Match the surface underneath — the console tables are dark. */
  tone?: keyof typeof TONES;
}) {
  const colors = TONES[tone];
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);
  const [{ thumbWidth, thumbLeft, overflows, percent }, setMetrics] = useState({
    thumbWidth: 0, thumbLeft: 0, overflows: false, percent: 0,
  });

  const MIN_THUMB = 44;

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;

    const { scrollWidth, clientWidth, scrollLeft } = el;
    // The track spans the same width as the row, so the row's own width is a
    // safe fallback on the first pass, before the track has been laid out.
    const trackWidth = trackRef.current?.clientWidth || clientWidth;

    // A sub-pixel difference is rounding, not overflow.
    const maxScroll = Math.max(0, scrollWidth - clientWidth);
    if (maxScroll <= 1 || trackWidth <= 0) {
      setMetrics((m) => (m.overflows || m.thumbWidth
        ? { thumbWidth: 0, thumbLeft: 0, overflows: false, percent: 0 }
        : m));
      return;
    }

    const width = Math.min(trackWidth, Math.max(MIN_THUMB, (clientWidth / scrollWidth) * trackWidth));
    const left = (scrollLeft / maxScroll) * (trackWidth - width);
    const next = {
      thumbWidth: width,
      thumbLeft: Number.isFinite(left) ? left : 0,
      overflows: true,
      percent: Math.round((scrollLeft / maxScroll) * 100),
    };
    // Skip identical updates so a ResizeObserver cannot loop.
    setMetrics((m) =>
      m.overflows === next.overflows &&
      Math.abs(m.thumbWidth - next.thumbWidth) < 0.5 &&
      Math.abs(m.thumbLeft - next.thumbLeft) < 0.5
        ? m
        : next);
  }, [targetRef]);

  // Hide the target's NATIVE scrollbar, because this component draws its own.
  //
  // Two bars appeared under the admin tables — the OS one and this one, in
  // different colours, stacked. This component exists for machines whose native
  // bar is an invisible overlay; on machines where it IS drawn, adding ours
  // simply doubled it.
  //
  // Done here rather than asking every caller to remember `scrollbar-hide`: the
  // pairing is what makes it correct, so the component that creates the problem
  // owns the fix. Removed on unmount so the element is left as it was found.
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const had = el.classList.contains('scrollbar-hide');
    if (!had) el.classList.add('scrollbar-hide');
    return () => { if (!had) el.classList.remove('scrollbar-hide'); };
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    // Measure after layout, and again on the next frame — fonts and images
    // settle after mount and change the row's width.
    measure();
    const raf = requestAnimationFrame(measure);

    el.addEventListener('scroll', measure, { passive: true });
    // Tab changes swap the fares in place, so the row's width changes without a
    // window resize — observe the element and its children, not the viewport.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measure()) : null;
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    // Children are added and removed when the cabin tab changes.
    const mo = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          for (const child of Array.from(el.children)) ro?.observe(child);
          measure();
        })
      : null;
    mo?.observe(el, { childList: true });
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
      mo?.disconnect();
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
    e.stopPropagation();
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
      // Kept in the DOM so it can be measured; hidden, and out of the tab order
      // and the accessibility tree, when there is nothing to scroll.
      aria-hidden={!overflows}
      tabIndex={overflows ? 0 : -1}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        // Clicking the track jumps there; dragging the thumb is handled below.
        if (e.target === trackRef.current) scrollFromPointer(e.clientX);
      }}
      // Collapsed to zero height when idle so it leaves no dead strip under the
      // row; width is unaffected, so it still measures correctly.
      className={`relative w-full rounded-full ${colors.track} transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ABC9C] ${
        overflows ? 'mt-1 h-2.5 opacity-100 cursor-pointer' : 'mt-0 h-0 pointer-events-none opacity-0'
      } ${className}`}
    >
      <div
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ width: `${thumbWidth}px`, transform: `translateX(${thumbLeft}px)` }}
        className={`absolute top-0 left-0 h-full rounded-full ${colors.thumb} transition-colors touch-none`}
      />
    </div>
  );
}
