import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS, creatorsList, yearOf, itemTitle } from '@/lib/items';

export function ItemTable({ filter, version, selectedKey, onSelect }) {
  const { data: items, error, loading } = useAsync(
    () => api.listItems({ type: filter?.type, journal: filter?.journal, collection: filter?.collection, search: filter?.search }),
    [filter?.type, filter?.journal, filter?.collection, filter?.search, version],
  );

  if (error) {
    return <div className="p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  }

  const hasActiveFilter = filter?.search || filter?.journal || filter?.collection;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
        <span>{loading ? '加载中...' : `${items?.length || 0} 个条目`}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="max-w-[420px] px-3 py-2 font-medium">标题</th>
              <th className="max-w-[200px] px-3 py-2 font-medium">作者</th>
              <th className="w-24 px-3 py-2 font-medium">年份</th>
              <th className="w-32 px-3 py-2 font-medium">类型</th>
            </tr>
          </thead>
          <tbody>
            {loading && (items || []).length === 0 && (
              <TableSkeleton />
            )}
            {(items || []).map(it => (
              <tr
                key={it.key}
                onClick={() => onSelect(it.key)}
                className={cn(
                  'cursor-pointer border-b transition-colors hover:bg-accent/60',
                  selectedKey === it.key && 'bg-primary/10 text-foreground',
                )}
              >
                <td className="max-w-[420px] truncate px-3 py-2" title={itemTitle(it)}>
                  {itemTitle(it)}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground" title={creatorsList(it.creators) || ''}>
                  {creatorsList(it.creators) || '—'}
                </td>
                <td className="w-24 px-3 py-2 text-muted-foreground">{yearOf(it.fields?.date) || '—'}</td>
                <td className="w-32 px-3 py-2">
                  <Badge variant="secondary">
                    {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                  </Badge>
                </td>
              </tr>
            ))}
            {!loading && (items?.length || 0) === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-muted-foreground">
                  {hasActiveFilter
                    ? '没有匹配的条目，请尝试调整筛选条件'
                    : '暂无条目，点击右上角“导入 PDF”开始'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <tr key={i} className="border-b">
          <td className="max-w-[420px] px-3 py-2"><Skeleton className="h-4 w-[280px]" /></td>
          <td className="max-w-[200px] px-3 py-2"><Skeleton className="h-4 w-[140px]" /></td>
          <td className="w-24 px-3 py-2"><Skeleton className="h-4 w-12" /></td>
          <td className="w-32 px-3 py-2"><Skeleton className="h-4 w-16" /></td>
        </tr>
      ))}
    </>
  );
}
