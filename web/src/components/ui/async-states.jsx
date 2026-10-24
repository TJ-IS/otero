import { AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const VARIANT_ROWS = {
  lines: ['h-4 w-48', 'h-3 w-72', 'h-3 w-56', 'h-40 w-full'],
  stats: ['h-3 w-20', 'h-8 w-24', 'h-3 w-16'],
  chart: ['h-4 w-40', 'h-3 w-64', 'h-64 w-full'],
  list: ['h-4 w-[80%]', 'h-3 w-[55%]', 'h-3 w-[40%]'],
};

export function LoadingSkeleton({ rows, variant = 'lines', className, label }) {
  const { t } = useTranslation('common');
  const shapes = rows
    ? Array.from({ length: rows }, (_, i) => VARIANT_ROWS.list[i % VARIANT_ROWS.list.length])
    : VARIANT_ROWS[variant] || VARIANT_ROWS.lines;

  return (
    <div
      className={cn('animate-pulse space-y-3', className)}
      aria-busy="true"
      aria-label={label || t('loading')}
    >
      {shapes.map((shape, i) => (
        <Skeleton key={i} className={shape} />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      {Icon ? <Icon className="size-8 text-muted-foreground opacity-40" /> : null}
      {title ? (
        <p className={cn('text-sm font-medium text-foreground', Icon && 'mt-3')}>{title}</p>
      ) : null}
      {description ? (
        <p
          className={cn(
            'max-w-md text-xs leading-relaxed text-muted-foreground',
            title ? 'mt-1' : 'mt-0',
          )}
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry, action, className }) {
  const { t } = useTranslation('common');
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-16 text-center text-sm text-destructive',
        className,
      )}
    >
      <AlertCircle className="size-8" />
      <p>{message || t('unknownError')}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      ) : null}
      {action}
    </div>
  );
}
