import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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

function formatCount(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

export function MissingDoisModal({ open, onOpenChange, journal = null, year = null }) {
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
        setError(err?.message || '加载失败');
        setDois([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, journal, year]);

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
      toast.success(`已复制 ${formatCount(deferredQuery ? filtered.length : dois.length)} 条 DOI`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('复制失败');
    }
  }

  async function copyOne(doi) {
    try {
      await navigator.clipboard.writeText(doi);
      toast.success('已复制 DOI');
    } catch {
      toast.error('复制失败');
    }
  }

  const filterBits = [
    journal || null,
    year != null ? `${year} 年` : null,
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 pb-3 pt-6">
          <DialogTitle>目标未收录 DOI</DialogTitle>
          <DialogDescription>
            AIS Basket 目标清单中有、文库尚未收录的篇目
            {filterBits.length ? ` · ${filterBits.join(' · ')}` : null}
            {!loading && !error ? ` · 共 ${formatCount(total)} 条` : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-6 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="筛选 DOI…"
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
            {deferredQuery ? '复制筛选结果' : '复制全部'}
          </Button>
        </div>

        <div className="min-h-0 flex-1 px-2 pb-4 pt-2">
          {loading ? (
            <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : error ? (
            <div className="flex h-72 items-center justify-center text-sm text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              {dois.length === 0 ? '暂无缺失 DOI' : '无匹配结果'}
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
                      className="group absolute left-0 flex w-full items-center justify-between gap-3 px-3 text-left font-mono text-xs transition-colors hover:bg-muted/60 active:scale-[0.99]"
                      style={{
                        height: ROW_HEIGHT,
                        transform: `translateY(${row.start}px)`,
                      }}
                      onClick={() => copyOne(doi)}
                      title="点击复制"
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
              显示 {formatCount(filtered.length)} / {formatCount(total)} 条
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
