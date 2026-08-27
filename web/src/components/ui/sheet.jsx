import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';

function Sheet({ ...props }) {
  return <SheetPrimitive.Root {...props} />;
}

function SheetTrigger({ className, ...props }) {
  return <SheetPrimitive.Trigger className={cn(className)} {...props} />;
}

function SheetClose({ className, ...props }) {
  return <SheetPrimitive.Close className={cn(className)} {...props} />;
}

function SheetPortal({ ...props }) {
  return <SheetPrimitive.Portal {...props} />;
}

function SheetOverlay({ className, ...props }) {
  return (
    <SheetPrimitive.Overlay
      className={cn(
        'motion-panel fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({ className, children, side = 'right', ...props }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        className={cn(
          'motion-panel fixed z-[60] gap-4 bg-background shadow-md overflow-hidden',
          'data-[state=closed]:duration-200 data-[state=open]:duration-200 [animation-timing-function:var(--motion-ease-drawer)]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          side === 'right' &&
            'inset-y-0 right-0 h-full w-full max-w-full sm:max-w-[42%] sm:min-w-[420px] border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          side === 'left' &&
            'inset-y-0 left-0 h-full w-full max-w-full sm:max-w-lg border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
            <path d="M4 4l7 7M11 4l-7 7" />
          </svg>
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetTitle({ className, ...props }) {
  return <SheetPrimitive.Title className={cn('text-lg font-semibold text-foreground', className)} {...props} />;
}

function SheetDescription({ className, ...props }) {
  return <SheetPrimitive.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription };
