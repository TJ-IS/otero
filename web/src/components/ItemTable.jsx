import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS, creatorsList, yearOf, itemTitle } from '@/lib/items';
import {
  FileText, BookOpen, GraduationCap, BookMarked, Presentation,
  File, ChevronUp, ChevronDown,
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

function highlight(text, query) {
  if (!query || !text) return text || '';
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-0">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronDown className="size-3 opacity-25 ml-0.5" />;
  return sortDir === 'asc'
    ? <ChevronUp className="size-3 ml-0.5 text-primary" />
    : <ChevronDown className="size-3 ml-0.5 text-primary" />;
}

export const ItemTable = memo(function ItemTable({ filter, version, selectedKey, onSelect }) {
  const { data: items, error, loading } = useAsync(
    () => api.listItems({ type: filter?.type, journal: filter?.journal, collection: filter?.collection, search: filter?.search }),
    [filter?.type, filter?.journal, filter?.collection, filter?.search, version],
  );

  const [sortField, setSortField] = useState('dateModified');
  const [sortDir, setSortDir] = useState('desc');
  const tableRef = useRef(null);

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

  // Keyboard navigation
  const onKeyDown = useCallback((e) => {
    if (!sortedItems.length) return;
    const current = sortedItems.findIndex(it => it.key === selectedKey);
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
  }, [sortedItems, selectedKey, onSelect]);

  // Scroll selected row into view
  useEffect(() => {
    if (!selectedKey || !tableRef.current) return;
    const row = tableRef.current.querySelector(`[data-key="${selectedKey}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  if (error) {
    return <div className="p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  }

  const hasActiveFilter = filter?.search || filter?.journal || filter?.collection;
  const searchQuery = filter?.search || '';

  const thClass = 'px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
        <span>{loading ? '加载中...' : `${sortedItems.length} 个条目`}</span>
      </div>
      <div
        ref={tableRef}
        className="min-h-0 flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className={cn(thClass, 'max-w-[420px]')} onClick={() => toggleSort('title')}>
                <span className="inline-flex items-center">
                  标题 <SortIcon field="title" sortField={sortField} sortDir={sortDir} />
                </span>
              </th>
              <th className={cn(thClass, 'max-w-[200px]')}>作者</th>
              <th className={cn(thClass, 'w-20')} onClick={() => toggleSort('date')}>
                <span className="inline-flex items-center">
                  年份 <SortIcon field="date" sortField={sortField} sortDir={sortDir} />
                </span>
              </th>
              <th className={cn(thClass, 'w-36')} onClick={() => toggleSort('itemType')}>
                <span className="inline-flex items-center">
                  类型 <SortIcon field="itemType" sortField={sortField} sortDir={sortDir} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (items || []).length === 0 && <TableSkeleton />}
            {sortedItems.map(it => {
              const title = itemTitle(it);
              const authors = creatorsList(it.creators) || '';
              return (
                <tr
                  key={it.key}
                  data-key={it.key}
                  onClick={() => onSelect(it.key)}
                  className={cn(
                    'cursor-pointer border-b transition-colors hover:bg-accent/60',
                    selectedKey === it.key && 'bg-primary/10 text-foreground',
                  )}
                >
                  <td className="max-w-[420px] truncate px-3 py-2" title={title}>
                    {highlight(title, searchQuery)}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground" title={authors}>
                    {authors ? highlight(authors, searchQuery) : '—'}
                  </td>
                  <td className="w-20 px-3 py-2 text-muted-foreground tabular-nums">
                    {yearOf(it.fields?.date) || '—'}
                  </td>
                  <td className="w-36 px-3 py-2">
                    <Badge variant="secondary" className="inline-flex items-center gap-1 font-normal">
                      {TYPE_ICONS[it.itemType]}
                      {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                    </Badge>
                  </td>
                </tr>
              );
            })}
            {!loading && sortedItems.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-16 text-center text-muted-foreground">
                  {hasActiveFilter
                    ? '没有匹配的条目，请尝试调整筛选条件'
                    : '暂无条目，点击右上角"导入 PDF"开始'}
                </td>
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
