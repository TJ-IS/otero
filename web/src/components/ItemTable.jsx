import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useInfiniteItems } from '@/hooks/useInfiniteItems';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { ITEM_TYPE_LABELS, yearOf, itemTitle, volumeIssuePages } from '@/lib/items';
import { highlight } from '@/lib/highlight';
import { AuthorLinks } from '@/components/AuthorLinks';
import { EmptyState, ErrorState } from '@/components/ui/async-states';
import {
  FileText, BookOpen, GraduationCap, BookMarked, Presentation,
  File, ChevronUp, ChevronDown, ArrowUpDown,
} from 'lucide-react';

const TYPE_ICONS = {
  journalArticle: <FileText className="size-3.5 shrink-0" />,
  preprint: <File className="size-3.5 shrink-0" />,
  book: <BookOpen className="size-3.5 shrink-0" />,
  bookSection: <BookMarked className="size-3.5 shrink-0" />,
  conferencePaper: <Presentation className="size-3.5 shrink-0" />,
  thesis: <GraduationCap className="size-3.5 shrink-0" />,
  report: <File className="size-3.5 shrink-0" />,
  document: <FileText className="size-3.5 shrink-0" />,
};

const ROW_HEIGHT = 52;
const MOBILE_ROW_HEIGHT = 92;

const SORT_OPTION_KEYS = [
  { value: 'title', labelKey: 'table.title' },
  { value: 'date', labelKey: 'table.year' },
  { value: 'vip', labelKey: 'table.vip' },
  { value: 'itemType', labelKey: 'table.type' },
];

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronDown className="ml-1 size-3 opacity-20" />;
  return sortDir === 'asc'
    ? <ChevronUp className="ml-1 size-3 text-brand" />
    : <ChevronDown className="ml-1 size-3 text-brand" />;
}

function journalOf(item) {
  return item?.fields?.publicationTitle || '';
}

export const ItemTable = memo(function ItemTable({ filter, version, selectedKey, onSelect, onStatusChange }) {
  const { t } = useTranslation(['library', 'common']);
  const isMobile = useIsMobile();

  const [sortField, setSortField] = useState('dateModified');
  const [sortDir, setSortDir] = useState('desc');
  const scrollRef = useRef(null);
  const showJournal = !filter?.journal;

  const { items: sortedItems, total, error, loading, loadingMore, hasMore, loadMore } = useInfiniteItems({
    filter,
    sortField,
    sortDir,
    pageSize: 100,
    version,
  });

  const keyToIndex = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < sortedItems.length; i++) m.set(sortedItems[i].key, i);
    return m;
  }, [sortedItems]);

  const virtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (isMobile ? MOBILE_ROW_HEIGHT : ROW_HEIGHT),
    overscan: 8,
  });

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadMore();
  }, [hasMore, loadingMore, loading, loadMore]);

  const toggleSort = useCallback((field) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const onKeyDown = useCallback((e) => {
    if (!sortedItems.length) return;
    const current = selectedKey != null ? (keyToIndex.get(selectedKey) ?? -1) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(sortedItems.length - 1, current + 1);
      onSelect(sortedItems[next].key);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = Math.max(0, current - 1);
      onSelect(sortedItems[prev].key);
    } else if (e.key === 'Enter' && selectedKey) {
      e.preventDefault();
    }
  }, [sortedItems, selectedKey, keyToIndex, onSelect]);

  useEffect(() => {
    if (selectedKey == null) return;
    const idx = keyToIndex.get(selectedKey);
    if (idx !== undefined) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selectedKey, keyToIndex, virtualizer]);

  // The page heading owns the item count, so report it upward.
  useEffect(() => {
    onStatusChange?.({ total: total || 0, loading });
  }, [total, loading, onStatusChange]);

  if (error) {
    return <ErrorState message={t('common:loadFailed', { message: error.message })} />;
  }

  const hasActiveFilter = filter?.search || filter?.journal || filter?.collection;
  const searchQuery = filter?.search || '';
  const emptyMessage = hasActiveFilter ? t('table.emptyFiltered') : t('table.emptyImport');
  const colCount = 5;

  const thClass = 'px-3 py-3 font-medium cursor-pointer select-none hover:text-foreground transition-colors first:pl-0 last:pr-0';
  const tdClass = 'px-3 py-3.5 first:pl-0 last:pr-0';

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {isMobile ? (
        <div className="flex items-center gap-2 border-y border-border/80 py-2">
          <Select
            value={sortField}
            onValueChange={(v) => { setSortField(v); setSortDir('asc'); }}
          >
            <SelectTrigger className="h-8 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTION_KEYS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border/80 text-muted-foreground transition-colors hover:text-foreground"
            title={sortDir === 'asc' ? t('table.sortAsc') : t('table.sortDesc')}
          >
            <ArrowUpDown className="size-4" />
          </button>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
      >
        {isMobile ? (
          <div>
            {loading && sortedItems.length === 0 && <CardSkeleton />}
            {!loading && sortedItems.length === 0 && (
              <EmptyState title={emptyMessage} />
            )}
            {paddingTop > 0 && <div style={{ height: paddingTop }} />}
            {virtualItems.map((virtualRow) => {
              const it = sortedItems[virtualRow.index];
              const rowTitle = itemTitle(it);
              return (
                <div
                  key={it.key}
                  data-key={it.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelect(it.key)}
                  className={cn(
                    'cursor-pointer border-b border-border/70 py-3.5 transition-colors hover:bg-accent/40',
                    selectedKey === it.key && 'bg-brand/5 text-foreground',
                  )}
                >
                  <div className="font-display text-sm font-semibold leading-snug">
                    {highlight(rowTitle, searchQuery)}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    <AuthorLinks creators={it.creators} query={searchQuery} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{yearOf(it.fields?.date) || '—'}</span>
                    {showJournal && journalOf(it) ? <span className="truncate">{journalOf(it)}</span> : null}
                    <span className="tabular-nums">{volumeIssuePages(it.fields) || '—'}</span>
                    <Badge variant="secondary" className="font-normal">
                      {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                    </Badge>
                  </div>
                </div>
              );
            })}
            {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
            {loadingMore && (
              <div className="py-4">
                <div className="h-3 w-32 animate-pulse rounded-sm bg-muted" />
              </div>
            )}
          </div>
        ) : (
          <table className="w-full table-fixed text-[13px]">
            <thead className="sticky top-0 z-10 bg-background/95 backdrop-blur">
              <tr className="border-y border-border/80 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                <th className={cn(thClass, 'w-auto')} onClick={() => toggleSort('title')}>
                  <span className="inline-flex items-center">
                    {t('table.title')} <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
                <th className={cn(thClass, 'w-52')}>{t('table.authors')}</th>
                <th className={cn(thClass, 'w-[4.5rem]')} onClick={() => toggleSort('date')}>
                  <span className="inline-flex items-center">
                    {t('table.year')} <SortIcon field="date" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
                <th className={cn(thClass, showJournal ? 'w-56' : 'w-28')} onClick={() => (showJournal ? undefined : toggleSort('vip'))}>
                  {showJournal ? (
                    t('table.journal')
                  ) : (
                    <span className="inline-flex items-center">
                      {t('table.vip')} <SortIcon field="vip" sortField={sortField} sortDir={sortDir} />
                    </span>
                  )}
                </th>
                <th className={cn(thClass, 'w-44')} onClick={() => toggleSort('itemType')}>
                  <span className="inline-flex items-center">
                    {t('table.type')} <SortIcon field="itemType" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && sortedItems.length === 0 && <TableSkeleton />}
              {!loading && sortedItems.length === 0 && (
                <tr>
                  <td colSpan={colCount}>
                    <EmptyState title={emptyMessage} />
                  </td>
                </tr>
              )}
              {paddingTop > 0 && (
                <tr key="__pad-top" aria-hidden="true" style={{ height: paddingTop }}>
                  <td colSpan={colCount} style={{ padding: 0, border: 'none' }} />
                </tr>
              )}
              {virtualItems.map((virtualRow) => {
                const it = sortedItems[virtualRow.index];
                const rowTitle = itemTitle(it);
                return (
                  <tr
                    key={it.key}
                    data-key={it.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    onClick={() => onSelect(it.key)}
                    className={cn(
                      'cursor-pointer border-b border-border/70 transition-colors hover:bg-accent/40',
                      selectedKey === it.key && 'bg-brand/5 text-foreground',
                    )}
                  >
                    <td className={cn(tdClass, 'truncate font-medium')} title={rowTitle}>
                      {highlight(rowTitle, searchQuery)}
                    </td>
                    <td className={cn(tdClass, 'w-52 truncate text-muted-foreground')}>
                      <AuthorLinks creators={it.creators} query={searchQuery} className="truncate" />
                    </td>
                    <td className={cn(tdClass, 'w-[4.5rem] font-mono text-muted-foreground tabular-nums')}>
                      {yearOf(it.fields?.date) || '—'}
                    </td>
                    <td
                      className={cn(tdClass, 'truncate text-muted-foreground', showJournal ? 'w-56' : 'w-28 tabular-nums')}
                      title={showJournal ? journalOf(it) : volumeIssuePages(it.fields)}
                    >
                      {showJournal ? (journalOf(it) || '—') : (volumeIssuePages(it.fields) || '—')}
                    </td>
                    <td className={cn(tdClass, 'w-44')}>
                      <Badge variant="secondary" className="gap-1 whitespace-nowrap font-normal">
                        {TYPE_ICONS[it.itemType]}
                        {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr key="__pad-bottom" aria-hidden="true" style={{ height: paddingBottom }}>
                  <td colSpan={colCount} style={{ padding: 0, border: 'none' }} />
                </tr>
              )}
              {loadingMore && (
                <tr key="__loading-more">
                  <td colSpan={colCount} className="py-4">
                    <div className="h-3 w-32 animate-pulse rounded-sm bg-muted" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <tr key={i} className="border-b border-border/70">
          <td className="py-3.5 pr-3"><Skeleton className="h-4 w-[22rem]" /></td>
          <td className="px-3 py-3.5"><Skeleton className="h-4 w-36" /></td>
          <td className="px-3 py-3.5"><Skeleton className="h-4 w-10" /></td>
          <td className="px-3 py-3.5"><Skeleton className="h-4 w-28" /></td>
          <td className="py-3.5 pl-3"><Skeleton className="h-4 w-20" /></td>
        </tr>
      ))}
    </>
  );
}

function CardSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border-b border-border/70 py-3.5">
          <Skeleton className="h-4 w-[80%]" />
          <Skeleton className="mt-2 h-3 w-[50%]" />
          <Skeleton className="mt-2 h-3 w-[40%]" />
        </div>
      ))}
    </>
  );
}
