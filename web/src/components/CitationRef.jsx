import { memo, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '@/hooks/useMediaQuery';

// An in-text author-year citation (e.g. "Samuelson 2001") that resolves to one
// or more entries in the reference list. Hovering / focusing shows a floating
// card with the full reference text; clicking scrolls the matching entry in the
// "文献" list into view (when that list is mounted on the page) and flashes it.
//
// The card is rendered in a portal so it escapes the article's overflow
// clipping, and positioned against the trigger via getBoundingClientRect.

const CARD_WIDTH = 380;

function scrollToReference(refId, reduceMotion) {
  const el = document.getElementById(`ref-${refId}`);
  if (!el) return false;
  const container = el.closest('[data-reader-scroll]');
  if (container) {
    const top = el.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop
      - (container.clientHeight - el.clientHeight) / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
  } else {
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }
  // A short orientation cue helps locate the destination without interrupting reading.
  el.classList.add('ref-flash');
  setTimeout(() => el.classList.remove('ref-flash'), 220);
  return true;
}

export const CitationRef = memo(function CitationRef({ refs, children }) {
  const { t } = useTranslation('item');
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placeAbove: false });
  const triggerRef = useRef(null);
  const closeTimer = useRef(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const cardId = useId();

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const placeAbove = spaceBelow < 220 && r.top > spaceBelow;
    let left = r.left;
    // Keep the card within the viewport horizontally.
    left = Math.min(left, window.innerWidth - CARD_WIDTH - 12);
    left = Math.max(12, left);
    setCoords({
      top: placeAbove ? r.top : r.bottom,
      left,
      placeAbove,
    });
  }, []);

  const show = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    place();
    setOpen(true);
  }, [place]);

  const hideSoon = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  const onClick = useCallback((e) => {
    e.preventDefault();
    // Jump to the first matching reference in the list, if present on the page.
    if (refs?.length) scrollToReference(refs[0].id, reduceMotion);
  }, [refs, reduceMotion]);

  // Defensive: if nothing resolved, render the text untouched (no link/card).
  if (!refs || refs.length === 0) return <>{children}</>;

  return (
    <>
      <a
        ref={triggerRef}
        href={`#ref-${refs[0].id}`}
        className="cite-ref"
        aria-describedby={open ? cardId : undefined}
        onClick={onClick}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hideSoon}
      >
        {children}
      </a>
      {open && createPortal(
        <div
          id={cardId}
          role="tooltip"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: CARD_WIDTH,
            maxWidth: 'calc(100vw - 24px)',
            '--citation-translate': coords.placeAbove ? 'translateY(calc(-100% - 6px))' : 'translateY(6px)',
            '--citation-origin': coords.placeAbove ? 'bottom left' : 'top left',
          }}
          className="citation-tooltip z-50 rounded-md border bg-popover text-popover-foreground shadow-lg p-3 text-xs leading-relaxed"
        >
          {refs.map((r, i) => (
            <div key={r.id} className={i > 0 ? 'mt-2 pt-2 border-t' : ''}>
              <p className="text-foreground/90">{r.text}</p>
            </div>
          ))}
          <p className="mt-2 text-[10px] text-muted-foreground">{t('page.citeJump')}</p>
        </div>,
        document.body,
      )}
    </>
  );
});
