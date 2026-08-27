import { cn } from '@/lib/utils';

export function StatTile({ icon, label, value, sub, valueTitle, mono, tone, className }) {
  return (
    <div className={cn('min-w-0 border-t border-border py-3', className)}>
      <div className="flex items-start gap-2">
        {icon ? (
          <span
            className={cn(
              'mt-0.5 shrink-0',
              tone === 'warning' ? 'text-warning' : 'text-brand',
            )}
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p
            className={cn(
              'mt-1 truncate leading-tight tabular-nums',
              mono ? 'font-mono text-sm font-semibold' : 'font-display text-2xl font-semibold',
            )}
            title={valueTitle ?? (value != null ? String(value) : undefined)}
          >
            {value}
          </p>
          <p className="truncate text-xs leading-4 text-muted-foreground">{sub || '\u00A0'}</p>
        </div>
      </div>
    </div>
  );
}
