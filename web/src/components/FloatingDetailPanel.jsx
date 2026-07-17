import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMediaQuery';

export function FloatingDetailPanel({ open, onClose, width, resizeHandle, children }) {
  const { t } = useTranslation(['library', 'common']);
  const isMobile = useIsMobile();
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (open) previouslyFocused.current = document.activeElement;
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="motion-panel fixed inset-0 z-20 bg-black/20 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previouslyFocused.current?.focus?.();
          }}
          className={cn(
            'motion-panel fixed z-30 flex outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 [animation-timing-function:var(--motion-ease-drawer)]',
            isMobile
              ? 'inset-x-0 bottom-0 top-0 data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4'
              : 'right-3 top-3 bottom-3 data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full',
          )}
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
