import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search as SearchIcon, X, FileText } from 'lucide-react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { useInfiniteItems } from '@/hooks/useInfiniteItems';
import { usePageMeta } from '@/hooks/usePageMeta';
import {
  ITEM_TYPE_LABELS, creatorsList, yearOf, itemTitle,
  AIS_BASKET_JOURNALS, UNFILED,
} from '@/lib/items';
import { highlight, snippetAround } from '@/lib/highlight';
import { cn } from '@/lib/utils';
import { ItemDetail } from '@/components/ItemDetail';
import { ItemDetailDialog } from '@/components/ItemDetailDialog';
import { AuthorLinks } from '@/components/AuthorLinks';
import { toast } from 'sonner';
import { SiteHeader } from '@/components/SiteHeader';

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
  const { t } = useTranslation(['library', 'common']);
  const m = useMemo(() => matchInfo(item, query), [item, query]);
  const title = itemTitle(item);
  const authors = creatorsList(item.creators) || '';
  const year = yearOf(item.fields?.date) || '';
  const jBadge = journalBadgeProps(item.fields?.publicationTitle);
  const journalLabel = jBadge.label === UNFILED ? t('common:unfiled') : jBadge.label;
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
      className="group border-b border-border/80 px-1 py-4 transition-colors hover:bg-accent/40 sm:px-2"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {ITEM_TYPE_LABELS[item.itemType] || item.itemType}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          <button type="button" onClick={() => onSelect(item.key)} className="max-w-full truncate text-left transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            {highlight(title, query)}
          </button>
        </h3>
        {snippetFromFulltext ? (
          <Badge variant="secondary" className="shrink-0 font-normal">{t('search.fulltextBadge')}</Badge>
        ) : null}
      </div>

      {authors && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          <AuthorLinks creators={item.creators} query={query} />
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {year && <span className="tabular-nums">{year}</span>}
        <Badge variant={jBadge.variant} className="font-normal">{journalLabel}</Badge>
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
        <div key={i} className="border-b border-border/80 px-2 py-4">
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
  const { t } = useTranslation(['library', 'common']);
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const [input, setInput] = useState(initialQ);
  const [submitted, setSubmitted] = useState(initialQ);
  const inputRef = useRef(null);

  const hasSearchParams = Boolean([...searchParams.keys()].length);
  usePageMeta({
    title: t('common:seo.searchTitle'),
    description: t('common:seo.searchDescription'),
    canonicalPath: '/search',
    robots: hasSearchParams ? 'noindex, follow' : 'index, follow',
  });

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
      toast.message(t('common:unsavedChangesToast'), { description: t('common:unsavedSwitchToastDesc') });
      return;
    }
    setSelectedKey(key);
    setDetailOpen(true);
  }, [selectedKey, detailDirty, t]);

  const onItemDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDetailOpen(false);
    toast.success(t('itemDeleted'));
  }, [t]);

  const closeDetail = useCallback(() => {
    if (detailDirty) {
      toast.message(t('common:unsavedChangesToast'), { description: t('common:unsavedCloseDesc') });
      return;
    }
    setDetailOpen(false);
    setSelectedKey(null);
  }, [detailDirty, t]);

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
      <SiteHeader />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex min-h-0 w-full max-w-page flex-1 flex-col px-4 sm:px-6 lg:px-8"
      >
        <div className="shrink-0 pb-5 pt-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-brand">
            {t('common:nav.search')}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">
            {hasQuery ? submitted : t('search.emptyPrompt')}
          </h1>
          <form
            onSubmit={onSubmit}
            className="mt-4 flex h-10 min-w-0 items-center gap-3 border-b border-foreground/30 focus-within:border-brand"
          >
            <SearchIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder={t('search.placeholder')}
              value={input}
              onChange={e => setInput(e.target.value)}
              className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            />
            {input ? (
              <button
                type="button"
                onClick={clearQuery}
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                title={t('search.clear')}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
            <button type="submit" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand hover:underline">
              {t('search.label')}
            </button>
          </form>
        </div>

        <div className="min-h-0 flex-1 overflow-auto pb-4" onScroll={onResultsScroll}>
          {error ? (
            <ErrorState message={t('search.failed', { message: error.message })} />
          ) : !hasQuery ? (
            <EmptyState icon={FileText} title={t('search.emptyPrompt')} description={t('search.emptyHint')} />
          ) : loading && items.length === 0 ? (
            <ResultsSkeleton />
          ) : resultCount === 0 ? (
            <EmptyState title={t('search.noResults', { query: submitted })} />
          ) : (
            <>
              <div className="mb-3 text-xs text-muted-foreground tabular-nums">
                {t('search.foundApprox')} <span className="text-foreground font-medium">{resultCount}</span> {t('search.results')}
              </div>
              <div className="divide-y divide-border border-t border-border/80">
                {items.map(it => (
                  <ResultCard key={it.key} item={it} query={submitted} onSelect={onSelect} />
                ))}
              </div>
              {loadingMore && (
                <LoadingSkeleton variant="list" className="py-4" label={t('search.loadMore')} />
              )}
            </>
          )}
        </div>
      </main>

      <ItemDetailDialog open={detailOpen && !!selectedKey} onClose={closeDetail}>
        <ItemDetail
          itemKey={selectedKey}
          onDeleted={onItemDeleted}
          onChanged={() => {}}
          onDirtyChange={setDetailDirty}
        />
      </ItemDetailDialog>
    </div>
  );
});
