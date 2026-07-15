import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS } from '@/lib/items';

const PAGE_SIZE = 50;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function TrashPanel() {
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [purging, setPurging] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [actionError, setActionError] = useState(null);
  const { data, error, loading, refresh } = useAsync(
    () => api.getAdminTrash({ page, pageSize: PAGE_SIZE }),
    [page]
  );

  const items = data?.items || [];
  const total = data?.total || 0;
  const childItems = data?.childItems || 0;

  async function handleEmptyTrash() {
    setPurging(true);
    setActionError(null);
    try {
      const result = await api.emptyAdminTrash();
      setActionResult(result);
      if (page === 1) refresh();
      else setPage(1);
    } catch (err) {
      setActionError(err);
    } finally {
      setPurging(false);
      setConfirmOpen(false);
    }
  }

  if (loading && !data) return <TrashSkeleton />;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <header className="grid gap-5 border-b pb-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">数据库维护</p>
          <h1 className="text-2xl font-semibold tracking-tight">回收站</h1>
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            永久清理已软删除的条目及其附件、笔记和全文索引记录。删除产生的空间会由 PostgreSQL
            回收并供后续数据复用，数据库物理大小不一定立即下降。
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={total === 0 || purging || loading}
          className="transition-transform active:translate-y-px"
        >
          {purging ? '正在清理…' : '清空回收站'}
        </Button>
      </header>

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <Metric label="待清理条目" value={total} />
        <Metric label="关联子项" value={childItems} />
        <Metric label="预计删除记录" value={total + childItems} />
      </section>

      {actionResult && (
        <div className="border-l-2 border-emerald-600 bg-emerald-500/5 px-4 py-3 text-sm">
          已永久删除 <strong className="tabular-nums">{actionResult.deletedItems}</strong> 条 item 记录，
          同时清理 <strong className="tabular-nums">{actionResult.orphanCreators}</strong> 个无引用作者和
          <strong className="tabular-nums"> {actionResult.orphanValues}</strong> 个无引用字段值。
        </div>
      )}

      {(error || actionError) && (
        <div className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          操作失败：{(actionError || error).message}
        </div>
      )}

      <section aria-busy={loading} className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">已删除条目</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">按移入回收站时间倒序排列</p>
          </div>
          {loading && data ? <span className="text-xs text-muted-foreground">正在刷新…</span> : null}
        </div>

        {items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">回收站为空</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              文库中软删除的条目会出现在这里。当前没有需要永久清理的数据。
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">标题</th>
                  <th className="px-4 py-2.5 font-medium">类型</th>
                  <th className="px-4 py-2.5 text-right font-medium">子项</th>
                  <th className="px-4 py-2.5 font-medium">移入时间</th>
                  <th className="px-4 py-2.5 font-medium">Key</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-muted/30">
                    <td className="max-w-md px-4 py-3 font-medium">
                      <span className="line-clamp-2">{item.title}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {ITEM_TYPE_LABELS[item.itemType] || item.itemType}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{item.childCount}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(item.deletedAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.key}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 ? (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">
              第 <span className="tabular-nums">{data.page}</span> / {data.totalPages} 页
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages || loading}
                onClick={() => setPage(p => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久清空回收站？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                将永久删除 {total} 个回收站条目及 {childItems} 个关联子项，此操作无法撤销。
              </span>
              <span className="block">
                本操作只清理 PostgreSQL。对应的 R2 文件会成为孤立对象，可随后在“存储对账”中确认并删除。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(event) => {
                event.preventDefault();
                handleEmptyTrash();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:translate-y-px"
            >
              {purging ? '正在永久删除…' : `永久删除 ${total + childItems} 条记录`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="bg-background px-4 py-4 sm:px-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

function TrashSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6" aria-busy="true">
      <div className="space-y-3 border-b pb-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-3 bg-background p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-lg" />
    </div>
  );
}
