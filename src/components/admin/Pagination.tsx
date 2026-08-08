'use client';

/**
 * The admin console's pager.
 *
 * One component, because five tables each had their own prev/next pair and they
 * had drifted — different page sizes, different labels, and no way to jump to a
 * page on any of them.
 *
 * Renders nothing when there is only one page. A pager on a single page is
 * furniture that implies there is somewhere else to go.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageWindow, pageRangeLabel } from '@/lib/pagination';

export default function Pagination({
  page, pages, total, limit, onChange, className = '',
}: {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (pages <= 1) return null;

  const go = (p: number) => onChange(Math.min(pages, Math.max(1, p)));

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-t border-slate-700/50 ${className}`}>
      <p className="text-slate-400 text-xs tabular-nums">{pageRangeLabel(page, limit, total)}</p>

      <nav className="flex items-center gap-1.5" aria-label="Pagination">
        <button
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:border-slate-700 transition-all"
        >
          <ChevronLeft size={14} />
        </button>

        {pageWindow(page, pages).map((p, i) =>
          p === '…' ? (
            // Not a button — a destination you cannot predict is worse than a gap.
            <span key={`gap-${i}`} className="text-slate-600 text-xs px-1 select-none">…</span>
          ) : (
            <button
              key={p}
              onClick={() => go(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-bold tabular-nums transition-all ${
                p === page
                  ? 'bg-[#1ABC9C]/15 border border-[#1ABC9C]/40 text-[#1ABC9C]'
                  : 'border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
              }`}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => go(page + 1)}
          disabled={page >= pages}
          aria-label="Next page"
          className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 disabled:opacity-30 disabled:hover:text-slate-400 disabled:hover:border-slate-700 transition-all"
        >
          <ChevronRight size={14} />
        </button>
      </nav>
    </div>
  );
}
