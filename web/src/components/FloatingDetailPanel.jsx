import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMediaQuery';

export function FloatingDetailPanel({ open, onClose, width, resizeHandle, children }) {
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
            ? 'inset-0'
            : 'right-3 top-3 bottom-3 data-[state=open]:slide-in-from-right-full data-[state=closed]:slide-out-to-right-full',
        )}
        style={isMobile ? undefined : { width }}
        >
          <DialogPrimitive.Title className="sr-only">条目详情</DialogPrimitive.Title>
          {!isMobile && resizeHandle}
          <div className={cn('relative flex h-full flex-1 flex-col overflow-hidden bg-background', isMobile ? '' : 'border shadow-2xl')}>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
