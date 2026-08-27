import { cn } from '@/lib/utils';

export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header
      className={cn(
        'grid gap-5 border-b border-border/80 pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end',
        className,
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-2xl font-semibold leading-tight text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
    </header>
  );
}
