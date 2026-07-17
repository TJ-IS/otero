import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export function TrashPanel() {
  const { t, i18n } = useTranslation(['admin', 'common']);
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
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{t('trash.eyebrow')}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t('trash.title')}</h1>
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            {t('trash.desc')}
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => setConfirmOpen(true)}
          disabled={total === 0 || purging || loading}
          className="transition-transform active:translate-y-px"
        >
          {purging ? t('trash.emptying') : t('trash.emptyTrash')}
        </Button>
      </header>

      <section className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <Metric label={t('trash.pendingItems')} value={total} />
        <Metric label={t('trash.childItems')} value={childItems} />
        <Metric label={t('trash.estRecords')} value={total + childItems} />
      </section>

      {actionResult && (
        <div className="border-l-2 border-emerald-600 bg-emerald-500/5 px-4 py-3 text-sm">
          {t('trash.purged', {
            items: actionResult.deletedItems,
            creators: actionResult.orphanCreators,
            values: actionResult.orphanValues,
          })}
        </div>
      )}

      {(error || actionError) && (
        <div className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {t('trash.actionFailed', { message: (actionError || error).message })}
        </div>
      )}

      <section aria-busy={loading} className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{t('trash.deletedList')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('trash.deletedListDesc')}</p>
          </div>
          {loading && data ? <span className="text-xs text-muted-foreground">{t('trash.refreshing')}</span> : null}
        </div>

        {items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">{t('trash.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              {t('trash.emptyDesc')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('trash.colTitle')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('trash.colType')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('trash.colChildren')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('trash.colTime')}</th>
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
                      {formatDate(item.deletedAt, i18n.language)}
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
              {t('trash.pageOf', { page: data.page, total: data.totalPages })}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
                {t('common:prevPage')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages || loading}
                onClick={() => setPage(p => p + 1)}
              >
                {t('common:nextPage')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trash.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                {t('trash.confirmDesc', { items: total, children: childItems })}
              </span>
              <span className="block">
                {t('trash.confirmNote')}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(event) => {
                event.preventDefault();
                handleEmptyTrash();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:translate-y-px"
            >
              {purging ? t('trash.purgingHard') : t('trash.purgeRecords', { count: total + childItems })}
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
