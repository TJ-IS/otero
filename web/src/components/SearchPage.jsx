import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Search as SearchIcon, X, FileText, Moon, Sun, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useInfiniteItems } from '@/hooks/useInfiniteItems';
import {
  ITEM_TYPE_LABELS, creatorsList, yearOf, itemTitle,
  AIS_BASKET_JOURNALS, UNFILED,
} from '@/lib/items';
import { highlight, snippetAround } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { ItemDetail } from '@/components/ItemDetail';
import { FloatingDetailPanel } from '@/components/FloatingDetailPanel';
import { AuthorLinks } from '@/components/AuthorLinks';
import { toast } from 'sonner';
import { WalletButton } from '@/components/WalletButton';

const BASKET_SET = new Set(AIS_BASKET_JOURNALS);

function journalBadgeProps(publicationTitle) {
  if (!publicationTitle) {
    return { label: UNFILED, variant: 'outline' };
  }
  if (BASKET_SET.has(publicationTitle)) {
    return { label: publicationTitle, variant: 'secondary' };
  }
  return { label: UNFILED, variant: 'outline' };
}

// Determine which core field(s) match the query (case-insensitive), so the
// card can show a contextual snippet from the most relevant field. Mirrors
// the backend COLLATE NOCASE restriction.
function matchInfo(item, q) {
  const ql = (q || '').trim().toLowerCase();
  if (!ql) return null;
  const fields = item?.fields || {};
  const titleHit = (fields.title || '').toLowerCase().includes(ql);
  const doiHit = (fields.DOI || '').toLowerCase().includes(ql);
  const journalHit = (fields.publicationTitle || '').toLowerCase().includes(ql);
  const abstract = fields.abstractNote || '';
  const abstractHit = abstract.toLowerCase().includes(ql);
  const authors = creatorsList(item.creators) || '';
  const authorsHit = authors.toLowerCase().includes(ql);
  const fulltextHit = !!item.fulltextHit;
  const fulltextSnippet = item.fulltextSnippet || null;
  return {
    titleHit, doiHit, journalHit, abstractHit, authorsHit, authors, abstract,
    fulltextHit, fulltextSnippet,
  };
}

function ResultCard({ item, query, onSelect }) {
  const m = useMemo(() => matchInfo(item, query), [item, query]);
  const title = itemTitle(item);
  const authors = creatorsList(item.creators) || '';
  const year = yearOf(item.fields?.date) || '';
  const jBadge = journalBadgeProps(item.fields?.publicationTitle);
  const doi = item.fields?.DOI || '';

  // Prefer MinerU body snippet when the hit is from full text; otherwise
  // fall back to abstract / journal / DOI metadata snippets.
  let snippet = null;
  let snippetFromFulltext = false;
  if (m?.fulltextHit && m.fulltextSnippet) {
    snippet = m.fulltextSnippet;
    snippetFromFulltext = true;
  } else if (m?.abstractHit) snippet = snippetAround(m.abstract, query);
  else if (m?.journalHit) snippet = item.fields?.publicationTitle || null;
  else if (m?.doiHit) snippet = doi || null;

  return (
    <article
      className="group rounded-md border bg-background px-4 py-3 transition-colors hover:bg-accent/40"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {ITEM_TYPE_LABELS[item.itemType] || item.itemType}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
          <button type="button" onClick={() => onSelect(item.key)} className="max-w-full truncate text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            {highlight(title, query)}
          </button>
        </h3>
        {snippetFromFulltext ? (
          <Badge variant="outline" className="shrink-0 font-normal text-[10px]">正文</Badge>
        ) : null}
      </div>

      {authors && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          <AuthorLinks creators={item.creators} query={query} />
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {year && <span className="tabular-nums">{year}</span>}
        <Badge variant={jBadge.variant} className="font-normal">{jBadge.label}</Badge>
        {doi && (
          <span className={cn('truncate', m?.doiHit && 'text-foreground')}>
            {m?.doiHit ? highlight(doi, query) : doi}
          </span>
        )}
      </div>

      {snippet && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {highlight(snippet, query)}
        </p>
      )}
    </article>
  );
}

function ResultsSkeleton({ count = 8 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-md border px-4 py-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-2 h-4 w-[80%]" />
          <Skeleton className="mt-1.5 h-3 w-[55%]" />
          <Skeleton className="mt-2 h-3 w-[40%]" />
        </div>
      ))}
    </div>
  );
}

export const SearchPage = memo(function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const [input, setInput] = useState(initialQ);
  const [submitted, setSubmitted] = useState(initialQ);
  const inputRef = useRef(null);
  const { resolvedTheme, setTheme } = useTheme();

  // Selected item detail (floating panel, mirrors LibraryView's UX).
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailDirty, setDetailDirty] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    // Place cursor at end of any pre-filled query.
    const el = inputRef.current;
    if (el && initialQ) el.setSelectionRange(el.value.length, el.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep URL ?q= in sync with the submitted query so it is shareable and the
  // back button works.
  useEffect(() => {
    const cur = searchParams.get('q') || '';
    if (cur !== submitted) {
      setSearchParams(submitted ? { q: submitted } : {}, { replace: true });
    }
  }, [submitted]); // eslint-disable-line react-hooks/exhaustive-deps

  const filter = useMemo(() => ({ search: submitted }), [submitted]);
  const { items, total, error, loading, loadingMore, hasMore, loadMore } = useInfiniteItems({
    filter,
    pageSize: 50,
    enabled: Boolean(submitted),
  });

  const onSubmit = useCallback((e) => {
    e?.preventDefault?.();
    setSubmitted(input.trim());
  }, [input]);

  const clearQuery = useCallback(() => {
    setInput('');
    setSubmitted('');
    inputRef.current?.focus();
  }, []);

  const onSelect = useCallback((key) => {
    if (key === selectedKey) return;
    if (detailDirty) {
      toast.message('当前条目有未保存的修改', { description: '请先保存或放弃修改后再切换。' });
      return;
    }
    setSelectedKey(key);
    setDetailOpen(true);
  }, [selectedKey, detailDirty]);

  const onItemDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDetailOpen(false);
    toast.success('条目已删除');
  }, []);

  const closeDetail = useCallback(() => {
    if (detailDirty) {
      toast.message('当前条目有未保存的修改', { description: '请先保存或放弃修改后再关闭。' });
      return;
    }
    setDetailOpen(false);
    setSelectedKey(null);
  }, [detailDirty]);

  const resultCount = total || 0;
  const hasQuery = Boolean(submitted);

  // Load the next page when the user scrolls near the bottom of the results.
  const onResultsScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (!hasMore || loadingMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadMore();
  }, [hasMore, loadingMore, loading, loadMore]);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      {/* Search header — mirrors TopBar's styling for visual consistency. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          title="返回文库"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <form
          onSubmit={onSubmit}
          className="relative flex h-8 flex-1 max-w-md min-w-[160px] items-center"
        >
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="搜索标题、作者、DOI、全文..."
            value={input}
            onChange={e => setInput(e.target.value)}
            className="h-8 w-full pl-8 pr-8"
          />
          {input && (
            <button
              type="button"
              onClick={clearQuery}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              title="清除搜索"
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>
        <div className="ml-auto flex items-center gap-1.5">
          <WalletButton />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={resolvedTheme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4" onScroll={onResultsScroll}>
        <div className="mx-auto max-w-2xl">
          {error ? (
            <div className="py-16 text-center text-sm text-destructive">
              搜索失败：{error.message}
            </div>
          ) : !hasQuery ? (
            <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
              <FileText className="size-8 opacity-30" />
              <p className="mt-3 text-sm">输入关键词搜索文献</p>
              <p className="mt-1 text-xs">匹配标题、摘要、期刊、DOI、作者与已解析全文</p>
            </div>
          ) : loading && items.length === 0 ? (
            <ResultsSkeleton />
          ) : resultCount === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              没有找到与「{submitted}」相关的条目
            </div>
          ) : (
            <>
              <div className="mb-3 text-xs text-muted-foreground tabular-nums">
                找到约 <span className="text-foreground font-medium">{resultCount}</span> 条结果
              </div>
              <div className="space-y-2">
                {items.map(it => (
                  <ResultCard key={it.key} item={it} query={submitted} onSelect={onSelect} />
                ))}
              </div>
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> 加载更多...
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating detail panel */}
      <FloatingDetailPanel
        open={detailOpen && !!selectedKey}
        onClose={closeDetail}
        width={520}
      >
        <div className="min-h-0 flex-1 overflow-hidden">
          <ItemDetail
            itemKey={selectedKey}
            onDeleted={onItemDeleted}
            onChanged={() => {}}
            onDirtyChange={setDetailDirty}
          />
        </div>
      </FloatingDetailPanel>
    </div>
  );
});
