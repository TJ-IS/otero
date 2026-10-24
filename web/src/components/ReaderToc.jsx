import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { headingId } from '@/lib/fulltext';
import { cn } from '@/lib/utils';

function outlineLabel(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// MinerU reports almost every section as level 2, so the heading's own numbering
// ("4.2. Impulse-Response Functions") is the only reliable depth signal.
function outlineDepth(item, label) {
  const numbered = label.match(/^(\d+(?:\.\d+)*)\./);
  if (numbered) return Math.min(numbered[1].split('.').length, 3);
  return Math.max(Math.min(Number(item.level) || 1, 3), 1);
}

const MARK_WIDTH = { 1: 18, 2: 11, 3: 7 };

export const ReaderToc = memo(function ReaderToc({
  outline = [],
  loading = false,
  onSelect,
  scrollRef,
  observeKey,
}) {
  const { t } = useTranslation('item');
  const [activeId, setActiveId] = useState(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const listRef = useRef(null);

  const syncFade = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setFade((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, []);

  const items = useMemo(
    () =>
      outline.map((o) => {
        const label = outlineLabel(o.text);
        return { ...o, label, slug: headingId(o.text), depth: outlineDepth(o, label) };
      }),
    [outline],
  );

  useEffect(() => {
    const container = scrollRef?.current;
    if (!container || items.length === 0) return;

    const slugToItem = new Map(items.map((item) => [item.slug, item]));
    const intersecting = new Set();
    let observer = null;
    let cancelled = false;
    let attempts = 0;
    let retryId = 0;

    const resolveActive = () => {
      let bestSlug = null;
      let bestTop = Infinity;
      for (const slug of intersecting) {
        const el = document.getElementById(slug);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top < bestTop) {
          bestTop = top;
          bestSlug = slug;
        }
      }
      if (bestSlug) {
        setActiveId(slugToItem.get(bestSlug)?.id ?? null);
        return;
      }

      const cutoff = container.getBoundingClientRect().top + 96;
      let last = null;
      for (const item of items) {
        const el = document.getElementById(item.slug);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= cutoff) last = item;
        else break;
      }
      setActiveId(last?.id ?? null);
    };

    const attach = () => {
      if (cancelled) return;
      const elements = items.map((item) => document.getElementById(item.slug)).filter(Boolean);
      if (elements.length === 0) {
        if (attempts++ < 40) retryId = requestAnimationFrame(attach);
        return;
      }

      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) intersecting.add(entry.target.id);
            else intersecting.delete(entry.target.id);
          }
          resolveActive();
        },
        {
          root: container,
          rootMargin: '0px 0px -55% 0px',
          threshold: 0,
        },
      );

      for (const el of elements) observer.observe(el);
      resolveActive();
    };

    attach();
    return () => {
      cancelled = true;
      cancelAnimationFrame(retryId);
      observer?.disconnect();
    };
  }, [items, scrollRef, observeKey]);

  // Keep the highlighted entry reachable: on a long outline it would otherwise
  // sit outside the panel's scrolled viewport.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el =
      activeId == null
        ? null
        : list.querySelector(`[data-toc-id="${CSS.escape(String(activeId))}"]`);
    if (el) {
      const { offsetTop, offsetHeight } = el;
      if (
        offsetTop < list.scrollTop ||
        offsetTop + offsetHeight > list.scrollTop + list.clientHeight
      ) {
        list.scrollTop = Math.max(0, offsetTop - (list.clientHeight - offsetHeight) / 2);
      }
    }
    syncFade();
  }, [activeId, items.length, syncFade]);

  if (loading) {
    return (
      <div
        className="pointer-events-none flex h-full flex-col justify-center gap-4 pl-1"
        aria-hidden
      >
        {[18, 11, 11, 18, 7, 11].map((w, i) => (
          <span key={i} className="block h-px rounded-full bg-foreground/15" style={{ width: w }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <nav
      className="reader-toc group/toc pointer-events-auto relative h-full w-full"
      aria-label={t('page.toc')}
    >
      {/* Collapsed: position marks only — no rule, no chrome. */}
      <div
        className="flex h-full min-h-0 flex-col justify-center pl-1"
        style={{ rowGap: items.length > 32 ? 2 : 6 }}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item.text)}
              title={item.label}
              aria-current={active ? 'location' : undefined}
              aria-label={item.label}
              className="flex h-2.5 items-center"
            >
              <span
                className={cn(
                  'block h-px rounded-full transition-colors duration-150',
                  active ? 'bg-brand' : 'bg-foreground/20 group-hover/toc:bg-foreground/35',
                )}
                style={{ width: active ? 22 : MARK_WIDTH[item.depth] }}
              />
            </button>
          );
        })}
      </div>

      {/* inset-y-0 gives the panel a definite height; without it the glass's
          percentage max-height resolves to `none` and the list never scrolls. */}
      <div className="reader-toc-panel pointer-events-none absolute inset-y-0 -left-1 z-30 w-[17.5rem] opacity-0 group-hover/toc:opacity-100 group-focus-within/toc:opacity-100">
        <div className="reader-toc-glass pointer-events-none flex max-h-full flex-col group-hover/toc:pointer-events-auto group-focus-within/toc:pointer-events-auto">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            <p className="shrink-0 px-4 pb-1.5 pt-3.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              {t('page.toc')}
            </p>
            <div
              ref={listRef}
              onScroll={syncFade}
              data-fade-top={fade.top ? '' : undefined}
              data-fade-bottom={fade.bottom ? '' : undefined}
              className="reader-toc-list relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2.5"
            >
              {items.map((item) => {
                const active = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-toc-id={item.id}
                    onClick={() => onSelect?.(item.text)}
                    aria-current={active ? 'location' : undefined}
                    className={cn(
                      'relative block w-full rounded-md py-[7px] pr-3 text-left leading-[1.45] transition-colors duration-150',
                      item.depth === 1 ? 'text-[12.5px]' : 'text-[12px]',
                      active
                        ? 'font-medium text-brand'
                        : item.depth === 1
                          ? 'text-foreground/85 hover:bg-foreground/[0.055] hover:text-foreground'
                          : 'text-muted-foreground hover:bg-foreground/[0.055] hover:text-foreground',
                    )}
                    style={{ paddingLeft: `${0.75 + (item.depth - 1) * 0.7}rem` }}
                    title={item.label}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-brand"
                      />
                    )}
                    <span className="line-clamp-2">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
});
