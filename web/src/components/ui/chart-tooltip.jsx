export function ChartTooltip({ active, payload, label, formatter, yearLabel, sort }) {
  if (!active || !payload?.length) return null;
  const items = sort
    ? [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    : payload;
  const heading = yearLabel ? yearLabel(label) : label;

  return (
    <div className="max-h-72 overflow-y-auto rounded-sm border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      {heading != null && heading !== '' && (
        <div className="mb-1 font-medium text-popover-foreground">{heading}</div>
      )}
      {items.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="min-w-0 truncate">{p.name || p.payload?.label || p.dataKey}</span>
          <span className="ml-auto tabular-nums">{formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}
