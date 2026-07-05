import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS, creatorsList, yearOf, itemTitle } from '@/lib/items';

export function ItemTable({ filter, version, selectedKey, onSelect }) {
  const { data: items, error, loading } = useAsync(
    () => api.listItems({ type: filter?.type, tag: filter?.tag, collection: filter?.collection }),
    [filter?.type, filter?.tag, filter?.collection, version],
  );

  if (error) {
    return <div className="p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  }

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
        <span>{loading ? '加载中...' : `${items?.length || 0} 个条目`}</span>
      </div>
      <ScrollArea className="flex-1">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">标题</th>
              <th className="px-3 py-2 font-medium">作者</th>
              <th className="w-24 px-3 py-2 font-medium">年份</th>
              <th className="w-32 px-3 py-2 font-medium">类型</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map(it => (
              <tr
                key={it.key}
                onClick={() => onSelect(it.key)}
                className={cn(
                  'cursor-pointer border-b transition-colors hover:bg-accent/60',
                  selectedKey === it.key && 'bg-accent text-accent-foreground',
                )}
              >
                <td className="max-w-[420px] truncate px-3 py-2">{itemTitle(it)}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-muted-foreground">
                  {creatorsList(it.creators) || '—'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{yearOf(it.fields?.date) || '—'}</td>
                <td className="px-3 py-2">
                  <Badge variant="secondary">
                    {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                  </Badge>
                </td>
              </tr>
            ))}
            {!loading && (items?.length || 0) === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-muted-foreground">
                  暂无条目，点击右上角“导入 PDF”开始
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}
