import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useMediaQuery';

export function FloatingDetailPanel({ open, onClose, width, resizeHandle, transitioning, children }) {
  const isMobile = useIsMobile();
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="关闭详情"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 z-20 cursor-default bg-black/15 animate-in fade-in duration-150"
      />
      <div
        className={cn(
          'z-30 flex',
          isMobile
            ? 'fixed inset-0'
            : cn('absolute right-3 top-3 bottom-3', transitioning ? '' : 'transition-[width] duration-200 ease-out'),
        )}
        style={isMobile ? undefined : { width }}
      >
        {!isMobile && resizeHandle}
        <div
          className={cn(
            'relative flex h-full flex-1 flex-col bg-background overflow-hidden animate-in slide-in-from-right-full duration-200',
            isMobile ? '' : 'border shadow-2xl',
          )}
        >
          {children}
        </div>
      </div>
    </>
  );
}
