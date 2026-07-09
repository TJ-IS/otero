import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS, creatorsList, yearOf, itemTitle, filterTitle } from '@/lib/items';
import { highlight } from '@/lib/highlight';
import {
  FileText, BookOpen, GraduationCap, BookMarked, Presentation,
  File, ChevronUp, ChevronDown, Sparkles, Loader2,
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

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronDown className="size-3 opacity-25 ml-0.5" />;
  return sortDir === 'asc'
    ? <ChevronUp className="size-3 ml-0.5 text-primary" />
    : <ChevronDown className="size-3 ml-0.5 text-primary" />;
}

export const ItemTable = memo(function ItemTable({ filter, version, selectedKey, onSelect }) {
  const { canEdit } = useAuth();
  const { data: items, error, loading } = useAsync(
    () => api.listItems({ type: filter?.type, journal: filter?.journal, collection: filter?.collection, search: filter?.search }),
    [filter?.type, filter?.journal, filter?.collection, filter?.search, version],
  );

  const [sortField, setSortField] = useState('dateModified');
  const [sortDir, setSortDir] = useState('desc');
  const scrollRef = useRef(null);
  const [batchParsing, setBatchParsing] = useState(false);

  const sortedItems = useMemo(() => {
    if (!items) return [];
    return [...items].sort((a, b) => {
      let av, bv;
      if (sortField === 'title') {
        av = itemTitle(a).toLowerCase();
        bv = itemTitle(b).toLowerCase();
      } else if (sortField === 'date') {
        av = yearOf(a.fields?.date) || '';
        bv = yearOf(b.fields?.date) || '';
      } else if (sortField === 'itemType') {
        av = ITEM_TYPE_LABELS[a.itemType] || a.itemType;
        bv = ITEM_TYPE_LABELS[b.itemType] || b.itemType;
      } else {
        av = a.dateModified || '';
        bv = b.dateModified || '';
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [items, sortField, sortDir]);

  // O(1) key -> index lookup for keyboard nav and scroll-into-view
  const keyToIndex = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < sortedItems.length; i++) m.set(sortedItems[i].key, i);
    return m;
  }, [sortedItems]);

  const virtualizer = useVirtualizer({
    count: sortedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

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
    if (!sortedItems.length || batchParsing) return;
    const keys = sortedItems.map(it => it.key);
    setBatchParsing(true);
    const tid = toast.loading(`正在入队 ${keys.length} 篇全文解析...`);
    try {
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
  }, [sortedItems, batchParsing]);

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
          {canEdit && sortedItems.length > 0 && (
            <button
              onClick={batchParseAll}
              disabled={batchParsing}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              title="将当前列表中的所有条目提交给 MinerU 解析为 Markdown 全文"
            >
              {batchParsing ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              批量解析全文
            </button>
          )}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {loading ? '加载中...' : `${sortedItems.length} 个条目`}
          </span>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
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
              <th className={cn(thClass, 'w-32')} onClick={() => toggleSort('itemType')}>
                <span className="inline-flex items-center">
                  类型 <SortIcon field="itemType" sortField={sortField} sortDir={sortDir} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (items || []).length === 0 && <TableSkeleton />}
            {!loading && sortedItems.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-16 text-center text-muted-foreground">
                  {hasActiveFilter
                    ? '没有匹配的条目，请尝试调整筛选条件'
                    : '暂无条目，点击右上角"导入 PDF"开始'}
                </td>
              </tr>
            )}
            {paddingTop > 0 && (
              <tr key="__pad-top" aria-hidden="true" style={{ height: paddingTop }}>
                <td colSpan={4} style={{ padding: 0, border: 'none' }} />
              </tr>
            )}
            {virtualItems.map(virtualRow => {
              const it = sortedItems[virtualRow.index];
              const title = itemTitle(it);
              const authors = creatorsList(it.creators) || '';
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
                  <td className="w-40 truncate px-3 py-2 text-muted-foreground" title={authors}>
                    {authors ? highlight(authors, searchQuery) : '—'}
                  </td>
                  <td className="w-16 px-3 py-2 text-muted-foreground tabular-nums">
                    {yearOf(it.fields?.date) || '—'}
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
                <td colSpan={4} style={{ padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
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
          <td className="w-36 px-3 py-2"><Skeleton className="h-4 w-20" /></td>
        </tr>
      ))}
    </>
  );
}
