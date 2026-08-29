import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useMediaQuery';

/**
 * Centered modal for inspecting an item. Deliberately a fixed rectangle rather
 * than a right-hand drawer so it never crops the table behind it.
 */
export function ItemDetailDialog({ open, onClose, children }) {
  const { t } = useTranslation(['library', 'common']);
  const { canEdit } = useAuth();
  const isMobile = useIsMobile();
  const compact = !canEdit;
  const previouslyFocused = useRef(null);
  const [present, setPresent] = useState(false);
  const [state, setState] = useState('closed');

  useEffect(() => {
    if (open) previouslyFocused.current = document.activeElement;
  }, [open]);

  // Entry/exit run as CSS animations rather than a transition toggled on the
  // next frame: rAF never fires in a background tab, which would leave the
  // dialog mounted but invisible.
  useEffect(() => {
    if (open) {
      setPresent(true);
      setState('open');
      return undefined;
    }

    setState('closed');
    const closeTimer = setTimeout(() => setPresent(false), 160);
    return () => clearTimeout(closeTimer);
  }, [open]);

  if (!present) return null;

  return (
    <DialogPrimitive.Root open={present} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="detail-scrim fixed inset-0 z-40 bg-foreground/25 backdrop-blur-[2px]"
          data-state={state}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previouslyFocused.current?.focus?.();
          }}
          className={cn(
            'detail-dialog fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden outline-none',
            compact
              ? cn(
                'min-h-0 max-h-[min(88dvh,56rem)] bg-card',
                isMobile
                  ? 'w-[calc(100vw-1.25rem)] rounded-lg border shadow-[0_24px_64px_-28px_hsl(var(--foreground)/0.28)]'
                  : 'w-[min(40rem,calc(100vw-2rem))] rounded-lg border shadow-[0_24px_64px_-28px_hsl(var(--foreground)/0.28)]',
              )
              : cn(
                'bg-background',
                isMobile
                  ? 'h-[100dvh] w-screen'
                  : 'h-[min(780px,calc(100dvh-6rem))] w-[min(1040px,calc(100vw-4rem))] rounded-md border shadow-2xl',
              ),
          )}
          data-state={state}
        >
          <DialogPrimitive.Title className="sr-only">{t('itemDetail')}</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
            <span className="sr-only">{t('common:close')}</span>
          </DialogPrimitive.Close>
          <div className={cn(
            'flex min-h-0 flex-col',
            compact ? 'max-h-[inherit] flex-1 overflow-hidden' : 'flex-1 overflow-hidden',
          )}>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
