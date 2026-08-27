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
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState, ErrorState } from '@/components/ui/async-states';

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
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={t('common:nav.admin')}
        title={t('trash.title')}
        description={t('trash.desc')}
        actions={(
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={total === 0 || purging || loading}
          >
            {purging ? t('trash.emptying') : t('trash.emptyTrash')}
          </Button>
        )}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <StatTile label={t('trash.pendingItems')} value={total} />
        <StatTile label={t('trash.childItems')} value={childItems} />
        <StatTile label={t('trash.estRecords')} value={total + childItems} />
      </section>

      {actionResult && (
        <div className="border-l-2 border-success bg-success/5 px-4 py-3 text-sm">
          {t('trash.purged', {
            items: actionResult.deletedItems,
            creators: actionResult.orphanCreators,
            values: actionResult.orphanValues,
          })}
        </div>
      )}

      {(error || actionError) && (
        <ErrorState
          className="items-start py-6 text-left"
          message={t('trash.actionFailed', { message: (actionError || error).message })}
        />
      )}

      <section aria-busy={loading} className="overflow-hidden border border-border/80">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="font-display text-base font-semibold">{t('trash.deletedList')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('trash.deletedListDesc')}</p>
          </div>
          {loading && data ? <span className="text-xs text-muted-foreground">{t('trash.refreshing')}</span> : null}
        </div>

        {items.length === 0 ? (
          <EmptyState title={t('trash.emptyTitle')} description={t('trash.emptyDesc')} />
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
                  <tr key={item.id} className="transition-colors hover:bg-accent/40">
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

function TrashSkeleton() {
  return (
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8" aria-busy="true">
      <div className="space-y-3 border-b border-border/80 pb-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-3 border-t border-border py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-sm" />
    </div>
  );
}
