import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useInfiniteItems } from '@/hooks/useInfiniteItems';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS, yearOf, itemTitle, filterTitle, volumeIssuePages } from '@/lib/items';
import { highlight } from '@/lib/highlight';
import { AuthorLinks } from '@/components/AuthorLinks';
import {
  FileText, BookOpen, GraduationCap, BookMarked, Presentation,
  File, ChevronUp, ChevronDown, Sparkles, Loader2, ArrowUpDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

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

const ROW_HEIGHT = 37;
const MOBILE_ROW_HEIGHT = 84;

const SORT_OPTIONS = [
  { value: 'title', label: '标题' },
  { value: 'date', label: '年份' },
  { value: 'vip', label: '卷期页' },
  { value: 'itemType', label: '类型' },
];

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronDown className="size-3 opacity-25 ml-0.5" />;
  return sortDir === 'asc'
    ? <ChevronUp className="size-3 ml-0.5 text-primary" />
    : <ChevronDown className="size-3 ml-0.5 text-primary" />;
}

export const ItemTable = memo(function ItemTable({ filter, version, selectedKey, onSelect }) {
  const { canEdit } = useAuth();
  const isMobile = useIsMobile();

  const [sortField, setSortField] = useState('dateModified');
  const [sortDir, setSortDir] = useState('desc');
  const scrollRef = useRef(null);
  const [batchParsing, setBatchParsing] = useState(false);

  // Server-side pagination + sort. Changing sort/filter re-queries from page 1;
  // scrolling near the bottom appends the next page (see onScroll below).
  const { items: sortedItems, total, error, loading, loadingMore, hasMore, loadMore } = useInfiniteItems({
    filter,
    sortField,
    sortDir,
    pageSize: 100,
    version,
  });

  // O(1) key -> index lookup for keyboard nav and scroll-into-view
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

  // Trigger loadMore when the user scrolls within ~600px of the bottom.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loadingMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadMore();
  }, [hasMore, loadingMore, loading, loadMore]);

  const toggleSort = useCallback((field) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        return prev;
      }
      setSortDir('asc');
      return field;
    });
  }, []);

  const batchParseAll = useCallback(async () => {
    if (!canEdit) {
      toast.error('请先连接白名单钱包');
      return;
    }
    if (!total || batchParsing) return;
    setBatchParsing(true);
    const tid = toast.loading('正在收集条目并入队全文解析...');
    try {
      // The table only holds loaded pages; fetch every matching key so batch
      // parse covers the whole filtered set, not just what's scrolled into view.
      const keys = await api.listItemKeys({
        type: filter?.type, journal: filter?.journal,
        collection: filter?.collection, search: filter?.search,
      });
      if (!keys.length) {
        toast.info('没有可解析的条目', { id: tid });
        return;
      }
      toast.loading(`正在入队 ${keys.length} 篇全文解析...`, { id: tid });
      const res = await api.parseFulltextBatch(keys);
      const s = res.summary || {};
      const parts = [];
      if (s.queued) parts.push(`${s.queued} 篇已入队`);
      if (s.skippedDone) parts.push(`${s.skippedDone} 篇已完成跳过`);
      if (s.skippedRunning) parts.push(`${s.skippedRunning} 篇进行中跳过`);
      if (s.noPdf) parts.push(`${s.noPdf} 篇无 PDF`);
      if (s.notFound) parts.push(`${s.notFound} 篇未找到`);
      const summary = parts.length ? parts.join('，') : '无操作';
      if (s.queued > 0) {
        toast.success(`批量解析：${summary}（后台陆续提交到 MinerU）`, { id: tid });
      } else {
        toast.info(`批量解析：${summary}`, { id: tid });
      }
    } catch (err) {
      toast.error(`批量解析失败: ${err.message}`, { id: tid });
    } finally {
      setBatchParsing(false);
    }
  }, [canEdit, total, batchParsing, filter?.type, filter?.journal, filter?.collection, filter?.search]);

  // Keyboard navigation
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

  // Scroll selected row into view via virtualizer (row may not be mounted)
  useEffect(() => {
    if (selectedKey == null) return;
    const idx = keyToIndex.get(selectedKey);
    if (idx !== undefined) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selectedKey, keyToIndex, virtualizer]);

  if (error) {
    return <div className="p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  }

  const hasActiveFilter = filter?.search || filter?.journal || filter?.collection;
  const searchQuery = filter?.search || '';
  const title = filterTitle(filter);

  const thClass = 'px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors';

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-2">
        <span className="truncate text-sm font-medium" title={title}>{title}</span>
        <div className="flex items-center gap-3">
          {canEdit && total > 0 && (
            <button
              onClick={batchParseAll}
              disabled={batchParsing}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              title="将当前筛选下的所有条目提交给 MinerU 解析为 Markdown 全文"
            >
              {batchParsing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              批量解析全文
            </button>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {loading ? '加载中...' : `${total} 个条目`}
          </span>
        </div>
      </div>
      {isMobile && (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Select
            value={sortField}
            onValueChange={(v) => { setSortField(v); setSortDir('asc'); }}
          >
            <SelectTrigger className="h-8 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground transition-colors"
            title={sortDir === 'asc' ? '升序' : '降序'}
          >
            <ArrowUpDown className="size-4" />
          </button>
        </div>
      )}
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
              <div className="px-3 py-16 text-center text-muted-foreground">
                {hasActiveFilter
                  ? '没有匹配的条目，请尝试调整筛选条件'
                  : '暂无条目，点击右上角"导入 PDF"开始'}
              </div>
            )}
            {paddingTop > 0 && <div style={{ height: paddingTop }} />}
            {virtualItems.map(virtualRow => {
              const it = sortedItems[virtualRow.index];
              const title = itemTitle(it);
              return (
                <div
                  key={it.key}
                  data-key={it.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelect(it.key)}
                  className={cn(
                    'cursor-pointer border-b px-4 py-3 transition-colors hover:bg-accent/60',
                    selectedKey === it.key && 'bg-primary/10 text-foreground',
                  )}
                >
                  <div className="text-sm font-medium leading-snug">
                    {highlight(title, searchQuery)}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    <AuthorLinks creators={it.creators} query={searchQuery} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{yearOf(it.fields?.date) || '—'}</span>
                    <span className="tabular-nums">{volumeIssuePages(it.fields) || '—'}</span>
                    <Badge variant="secondary" className="inline-flex items-center gap-1 font-normal">
                      {TYPE_ICONS[it.itemType]}
                      {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                    </Badge>
                  </div>
                </div>
              );
            })}
            {paddingBottom > 0 && <div style={{ height: paddingBottom }} />}
            {loadingMore && (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> 加载更多...
              </div>
            )}
          </div>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className={cn(thClass, 'w-auto')} onClick={() => toggleSort('title')}>
                  <span className="inline-flex items-center">
                    标题 <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
                <th className={cn(thClass, 'w-40')}>作者</th>
                <th className={cn(thClass, 'w-16')} onClick={() => toggleSort('date')}>
                  <span className="inline-flex items-center">
                    年份 <SortIcon field="date" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
                <th className={cn(thClass, 'w-28')} onClick={() => toggleSort('vip')}>
                  <span className="inline-flex items-center">
                    卷期页 <SortIcon field="vip" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
                <th className={cn(thClass, 'w-32')} onClick={() => toggleSort('itemType')}>
                  <span className="inline-flex items-center">
                    类型 <SortIcon field="itemType" sortField={sortField} sortDir={sortDir} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && sortedItems.length === 0 && <TableSkeleton />}
              {!loading && sortedItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-16 text-center text-muted-foreground">
                    {hasActiveFilter
                      ? '没有匹配的条目，请尝试调整筛选条件'
                      : '暂无条目，点击右上角"导入 PDF"开始'}
                  </td>
                </tr>
              )}
              {paddingTop > 0 && (
                <tr key="__pad-top" aria-hidden="true" style={{ height: paddingTop }}>
                  <td colSpan={5} style={{ padding: 0, border: 'none' }} />
                </tr>
              )}
              {virtualItems.map(virtualRow => {
                const it = sortedItems[virtualRow.index];
                const title = itemTitle(it);
                return (
                  <tr
                    key={it.key}
                    data-key={it.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    onClick={() => onSelect(it.key)}
                    className={cn(
                      'cursor-pointer border-b transition-colors hover:bg-accent/60',
                      selectedKey === it.key && 'bg-primary/10 text-foreground',
                    )}
                  >
                    <td className="truncate px-3 py-2" title={title}>
                      {highlight(title, searchQuery)}
                    </td>
                    <td className="w-40 truncate px-3 py-2 text-muted-foreground">
                      <AuthorLinks creators={it.creators} query={searchQuery} className="truncate" />
                    </td>
                    <td className="w-16 px-3 py-2 text-muted-foreground tabular-nums">
                      {yearOf(it.fields?.date) || '—'}
                    </td>
                    <td className="w-28 truncate px-3 py-2 text-muted-foreground tabular-nums" title={volumeIssuePages(it.fields)}>
                      {volumeIssuePages(it.fields) || '—'}
                    </td>
                    <td className="w-32 px-3 py-2">
                      <Badge variant="secondary" className="inline-flex items-center gap-1 font-normal">
                        {TYPE_ICONS[it.itemType]}
                        {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr key="__pad-bottom" aria-hidden="true" style={{ height: paddingBottom }}>
                  <td colSpan={5} style={{ padding: 0, border: 'none' }} />
                </tr>
              )}
              {loadingMore && (
                <tr key="__loading-more">
                  <td colSpan={5} className="py-4 text-center text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="size-3 animate-spin" /> 加载更多...
                    </span>
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
        <tr key={i} className="border-b">
          <td className="max-w-[420px] px-3 py-2"><Skeleton className="h-4 w-[280px]" /></td>
          <td className="max-w-[200px] px-3 py-2"><Skeleton className="h-4 w-[140px]" /></td>
          <td className="w-20 px-3 py-2"><Skeleton className="h-4 w-10" /></td>
          <td className="w-28 px-3 py-2"><Skeleton className="h-4 w-16" /></td>
          <td className="w-36 px-3 py-2"><Skeleton className="h-4 w-20" /></td>
        </tr>
      ))}
    </>
  );
}

function CardSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="border-b px-4 py-3">
          <Skeleton className="h-4 w-[80%]" />
          <Skeleton className="mt-1.5 h-3 w-[50%]" />
          <Skeleton className="mt-2 h-3 w-[40%]" />
        </div>
      ))}
    </>
  );
}
