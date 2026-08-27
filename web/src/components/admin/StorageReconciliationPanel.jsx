import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Database, HardDrive, RefreshCw, Loader2, AlertCircle, ExternalLink,
  Trash2,
} from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';

function TruncatedNote({ truncated, listCap, total }) {
  const { t } = useTranslation('admin');
  if (!truncated) return null;
  return (
    <p className="px-1 text-xs text-muted-foreground">
      {t('reconcile.listCap', { cap: listCap, total })}
    </p>
  );
}

function VirtualMissingList({ items }) {
  const { t } = useTranslation('admin');
  const parentRef = useRef(null);
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="max-h-[32rem] overflow-y-auto">
      <div className="relative w-full" style={{ height: `${rows.getTotalSize()}px` }}>
        {rows.getVirtualItems().map((row) => {
          const item = items[row.index];
          return (
            <div
              key={`${item.key}-${item.path}-${row.index}`}
              ref={rows.measureElement}
              data-index={row.index}
              className="absolute left-0 top-0 flex w-full items-center justify-between gap-3 border-b py-2"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <div className="min-w-0">
                <Link
                  to={`/items/${item.key}`}
                  className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:text-brand hover:underline"
                >
                  {item.key} <ExternalLink className="size-3" />
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">{item.path}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline" className="text-xs">{item.type || 'attachment'}</Badge>
                {item.deleted ? <Badge variant="secondary">{t('reconcile.deletedItem')}</Badge> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VirtualOrphanList({ items, selected, onToggle }) {
  const { t } = useTranslation('admin');
  const parentRef = useRef(null);
  const rows = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="max-h-[32rem] overflow-y-auto">
      <div className="relative w-full" style={{ height: `${rows.getTotalSize()}px` }}>
        {rows.getVirtualItems().map((row) => {
          const item = items[row.index];
          return (
            <div
              key={item.name}
              ref={rows.measureElement}
              data-index={row.index}
              className="absolute left-0 top-0 flex w-full items-center gap-3 border-b py-2"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <Checkbox checked={selected.has(item.name)} onCheckedChange={() => onToggle(item.name)} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs">{item.name}</p>
                {item.key ? <p className="truncate text-xs text-muted-foreground">{t('reconcile.linkedItem', { key: item.key })}</p> : null}
              </div>
              <Badge variant="outline" className="shrink-0 text-xs">{item.type || 'unknown'}</Badge>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.sizeFormatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StorageReconciliationPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const forceNextRefresh = useRef(false);
  const {
    data, error, loading, refresh: runRefresh,
  } = useAsync(() => {
    const force = forceNextRefresh.current;
    forceNextRefresh.current = false;
    return api.getAdminReconcile({ force });
  }, []);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);

  const orphanInR2 = data?.orphanInR2 || [];
  const missingInR2 = data?.missingInR2 || [];
  const summary = data?.summary;

  const orphanNames = useMemo(() => new Set(orphanInR2.map((o) => o.name)), [orphanInR2]);
  const selectedCount = useMemo(
    () => Array.from(selected).reduce((count, name) => count + Number(orphanNames.has(name)), 0),
    [orphanNames, selected],
  );
  const allSelected = orphanInR2.length > 0 && selectedCount === orphanInR2.length;

  const refresh = useCallback(() => {
    forceNextRefresh.current = true;
    runRefresh();
  }, [runRefresh]);

  const toggle = useCallback((name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(orphanInR2.map((o) => o.name)));
  };

  const selectedBytes = useMemo(
    () => orphanInR2.filter((o) => selected.has(o.name)).reduce((sum, o) => sum + (o.size || 0), 0),
    [orphanInR2, selected],
  );

  async function handleDelete() {
    setDeleting(true);
    try {
      const names = Array.from(selected).filter((name) => orphanNames.has(name));
      const result = await api.deleteAdminOrphanObjects(names);
      setDeleteResult(result);
      setSelected(new Set());
      runRefresh();
    } catch (e) {
      setDeleteResult({ error: e.message });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-page px-4 py-8 sm:px-6 lg:px-8">
        <LoadingSkeleton variant="chart" label={t('reconcile.scanning')} />
        <p className="mt-3 text-center text-xs text-muted-foreground">{t('reconcile.scanningHint')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-page px-4 py-8 sm:px-6 lg:px-8">
        <ErrorState message={t('reconcile.loadFailed', { message: error.message })} onRetry={refresh} />
      </div>
    );
  }

  if (data?.status === 'not_applicable') {
    return (
      <div className="mx-auto max-w-page px-4 py-8 sm:px-6 lg:px-8">
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <HardDrive className="size-5" /> {data.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={t('common:nav.admin')}
        title={t('reconcile.title')}
        actions={(
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('reconcile.rescan')}
          </Button>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Database className="size-4" />}
          label={t('reconcile.dbRefs')}
          value={summary?.dbReferences ?? '—'}
          sub={summary ? t('reconcile.dbRefsSub', { objects: summary.dbExactObjects, prefixes: summary.dbPrefixes }) : undefined}
        />
        <StatTile icon={<HardDrive className="size-4" />} label={t('reconcile.r2Total')} value={summary?.r2Objects ?? '—'} />
        <StatTile
          icon={<AlertCircle className="size-4" />}
          label={t('reconcile.r2Missing')}
          value={summary?.missingInR2 ?? '—'}
          sub={t('reconcile.r2MissingSub')}
          tone={summary?.missingInR2 ? 'warning' : undefined}
        />
        <StatTile
          icon={<Trash2 className="size-4" />}
          label={t('reconcile.r2Orphans')}
          value={summary?.orphanInR2 ?? '—'}
          sub={summary?.orphanBytesFormatted ? t('reconcile.orphanBytes', { size: summary.orphanBytesFormatted }) : undefined}
          tone={summary?.orphanInR2 ? 'warning' : undefined}
        />
      </div>

      {deleteResult && (
        <Card className={deleteResult.error ? 'border-destructive/40' : 'border-success/40'}>
          <CardContent className="text-sm">
            {deleteResult.error ? (
              <span className="text-destructive">{t('reconcile.deleteFailed', { error: deleteResult.error })}</span>
            ) : (
              <div className="space-y-1">
                <p>
                  {t('reconcile.deletedObjects', { count: deleteResult.deleted.length })}
                  {deleteResult.skipped.length > 0 && t('reconcile.skippedObjects', { count: deleteResult.skipped.length })}
                </p>
                {deleteResult.skipped.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {deleteResult.skipped.map((s) => (
                      <li key={s.name} className="font-mono">
                        {s.name} — {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('reconcile.missingTitle')}</CardTitle>
          <CardDescription>{t('reconcile.missingDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {missingInR2.length === 0 ? (
            <EmptyState className="py-6" title={t('reconcile.noMissing')} />
          ) : (
            <>
              <VirtualMissingList items={missingInR2} />
              <TruncatedNote truncated={data?.truncated?.missingInR2} listCap={data?.listCap} total={summary?.missingInR2} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('reconcile.orphanTitle')}</CardTitle>
              <CardDescription>{t('reconcile.orphanDesc')}</CardDescription>
            </div>
            {orphanInR2.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedCount === 0}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 size-3.5" /> {t('reconcile.deleteSelected', { count: selectedCount })}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {orphanInR2.length === 0 ? (
            <EmptyState className="py-6" title={t('reconcile.noOrphans')} />
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span>{t('reconcile.selectPage')}</span>
              </div>
              <VirtualOrphanList items={orphanInR2} selected={selected} onToggle={toggle} />
              <TruncatedNote truncated={data?.truncated?.orphanInR2} listCap={data?.listCap} total={summary?.orphanInR2} />
            </>
          )}
        </CardContent>
      </Card>

      {data?.timestamp && (
        <p className="text-center text-xs text-muted-foreground">
          {data.cached ? t('reconcile.cached') : t('reconcile.live')} · {t('reconcile.collectedAt', { time: new Date(data.timestamp).toLocaleString() })}
          {Number.isFinite(data.durationMs) ? t('reconcile.duration', { seconds: (data.durationMs / 1000).toFixed(1) }) : ''}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reconcile.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('reconcile.confirmDesc', {
                count: selectedCount,
                mb: (selectedBytes / 1024 / 1024).toFixed(2),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common:cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}
              {t('reconcile.confirmDelete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
