import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMediaQuery';

export function FloatingDetailPanel({ open, onClose, width, resizeHandle, children }) {
  const { t } = useTranslation(['library', 'common']);
  const isMobile = useIsMobile();
  const previouslyFocused = useRef(null);
  const [panelPresent, setPanelPresent] = useState(false);
  const [panelState, setPanelState] = useState('closed');

  useEffect(() => {
    if (open) previouslyFocused.current = document.activeElement;
  }, [open]);

  useEffect(() => {
    let frame;
    let closeTimer;

    if (open) {
      setPanelPresent(true);
      frame = requestAnimationFrame(() => setPanelState('open'));
    } else {
      setPanelState('closed');
      closeTimer = setTimeout(() => setPanelPresent(false), 220);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [open]);

  if (!panelPresent) return null;

  return (
    <DialogPrimitive.Root open={panelPresent} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="detail-panel-scrim fixed inset-0 z-20 bg-black/20"
          data-state={panelState}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previouslyFocused.current?.focus?.();
          }}
          className={cn(
            'detail-panel fixed z-30 flex outline-none',
            isMobile
              ? 'inset-x-0 bottom-0 top-0'
              : 'right-3 top-3 bottom-3',
          )}
          data-mobile={isMobile ? 'true' : 'false'}
          data-state={panelState}
          style={isMobile ? undefined : { width }}
        >
          <DialogPrimitive.Title className="sr-only">{t('itemDetail')}</DialogPrimitive.Title>
          {!isMobile && resizeHandle}
          <div
            className={cn(
              'relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background',
              isMobile ? 'pt-[env(safe-area-inset-top)]' : 'border shadow-2xl',
            )}
          >
            {isMobile && (
              <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="-ml-1 gap-1.5 text-muted-foreground hover:text-foreground"
                  aria-label={t('common:back')}
                >
                  <ArrowLeft className="size-4" />
                  <span>{t('common:back')}</span>
                </Button>
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
