import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, Check, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/api/client';

const ROW_HEIGHT = 32;

function formatCount(n, lng) {
  return Number(n || 0).toLocaleString(lng || 'zh-CN');
}

export function MissingDoisModal({ open, onOpenChange, journal = null, year = null }) {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const lng = i18n.language;
  const [dois, setDois] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuery('');
    setCopied(false);
    api.getStatsDoiCoverageMissing({ journal, year })
      .then((res) => {
        if (cancelled) return;
        setDois(res.dois || []);
        setTotal(res.total ?? (res.dois?.length || 0));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || t('missingDois.loadFailed'));
        setDois([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, journal, year, t]);

  const filtered = useMemo(() => {
    if (!deferredQuery) return dois;
    return dois.filter((d) => d.includes(deferredQuery));
  }, [dois, deferredQuery]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  async function copyAll() {
    const text = (deferredQuery ? filtered : dois).join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(t('missingDois.copiedCount', {
        count: formatCount(deferredQuery ? filtered.length : dois.length, lng),
      }));
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t('common:copyFailed'));
    }
  }

  async function copyOne(doi) {
    try {
      await navigator.clipboard.writeText(doi);
      toast.success(t('missingDois.copiedOne'));
    } catch {
      toast.error(t('common:copyFailed'));
    }
  }

  const filterBits = [
    journal || null,
    year != null ? t('missingDois.year', { year }) : null,
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 pb-3 pt-6">
          <DialogTitle>{t('missingDois.title')}</DialogTitle>
          <DialogDescription>
            {t('missingDois.desc')}
            {filterBits.length ? ` · ${filterBits.join(' · ')}` : null}
            {!loading && !error ? t('missingDois.total', { count: formatCount(total, lng) }) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-6 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('missingDois.filterPlaceholder')}
              className="pl-9 font-mono text-sm"
              disabled={loading || !!error}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyAll}
            disabled={loading || !!error || filtered.length === 0}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {deferredQuery ? t('missingDois.copyFiltered') : t('missingDois.copyAll')}
          </Button>
        </div>

        <div className="min-h-0 flex-1 px-2 pb-4 pt-2">
          {loading ? (
            <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('loading')}
            </div>
          ) : error ? (
            <div className="flex h-72 items-center justify-center text-sm text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              {dois.length === 0 ? t('missingDois.empty') : t('missingDois.noMatch')}
            </div>
          ) : (
            <div ref={scrollRef} className="h-72 overflow-auto rounded-md border">
              <div
                style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
              >
                {virtualizer.getVirtualItems().map((row) => {
                  const doi = filtered[row.index];
                  return (
                    <button
                      key={doi}
                      type="button"
                      className="group absolute left-0 flex w-full items-center justify-between gap-3 px-3 text-left font-mono text-xs transition-colors hover:bg-muted/60"
                      style={{
                        height: ROW_HEIGHT,
                        transform: `translateY(${row.start}px)`,
                      }}
                      onClick={() => copyOne(doi)}
                      title={t('missingDois.clickCopy')}
                    >
                      <span className="min-w-0 truncate">{doi}</span>
                      <Copy className="size-3 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!loading && !error && deferredQuery && filtered.length > 0 ? (
            <p className="mt-2 px-1 text-xs text-muted-foreground">
              {t('missingDois.showing', {
                shown: formatCount(filtered.length, lng),
                total: formatCount(total, lng),
              })}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
