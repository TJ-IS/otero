import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw, ExternalLink, Loader2, AlertCircle, CheckCircle2, Clock, ListChecks,
  RotateCcw, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';

const POLL_MS = 3000;
const PAGE_SIZE = 50;
const ACTIVE_STATES = ['submitting', 'pending', 'running', 'converting'];
const ACTIVE = new Set(ACTIVE_STATES);

const FILTER_IDS = ['all', 'active', 'done', 'failed'];

const STATE_ICONS = {
  idle: Clock,
  submitting: Loader2,
  pending: Loader2,
  running: Loader2,
  converting: Loader2,
  done: CheckCircle2,
  failed: AlertCircle,
};

const STATE_VARIANTS = {
  idle: 'secondary',
  submitting: 'secondary',
  pending: 'secondary',
  running: 'secondary',
  converting: 'secondary',
  done: 'default',
  failed: 'destructive',
};

const STATE_PULSE = new Set(['submitting', 'pending', 'running', 'converting']);

function StateBadge({ state }) {
  const { t } = useTranslation('item');
  const Icon = STATE_ICONS[state] || STATE_ICONS.idle;
  const pulse = STATE_PULSE.has(state);
  return (
    <Badge variant={STATE_VARIANTS[state] || 'secondary'} className="inline-flex items-center gap-1 font-normal">
      <Icon className={`size-3 ${pulse ? 'animate-spin' : ''}`} />
      {t(`fulltextStatus.${state}`, { defaultValue: state })}
    </Badge>
  );
}

function fmtTime(s) {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 19);
}

export const MineruTaskLog = memo(function MineruTaskLog({ open, onOpenChange, onSelectItem }) {
  const { t } = useTranslation(['library', 'item', 'common']);
  const { canEdit } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [bulkRetrying, setBulkRetrying] = useState(false);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [counts, setCounts] = useState({});
  const timerRef = useRef(null);
  const viewRef = useRef({ filter, page });
  viewRef.current = { filter, page };

  const filters = useMemo(() => FILTER_IDS.map((id) => ({
    id,
    label: t(`mineru.filter${id.charAt(0).toUpperCase()}${id.slice(1)}`),
  })), [t]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { filter: f, page: p } = viewRef.current;
      const r = await api.listFulltextPending({ filter: f, page: p, pageSize: PAGE_SIZE });
      setRows(Array.isArray(r?.items) ? r.items : []);
      setTotal(r?.total ?? 0);
      setTotalPages(r?.totalPages ?? 1);
      setCounts(r?.counts ?? {});
    } catch (err) {
      toast.error(t('mineru.loadListFailed', { message: err.message }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, filter, page, refresh]);

  const activeCount = ACTIVE_STATES.reduce((n, s) => n + (counts[s] || 0), 0);
  useEffect(() => {
    if (!open) return;
    if (activeCount === 0) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [open, activeCount, refresh]);

  const retry = useCallback(async (key) => {
    if (!canEdit) {
      toast.error(t('common:connectWhitelistFirst'));
      return;
    }
    setBusyKey(key);
    try {
      await api.parseFulltext(key, { force: true });
      toast.success(t('mineru.resubmitted', { key }));
      refresh();
    } catch (err) {
      toast.error(t('mineru.retryFailed', { message: err.message }));
    } finally {
      setBusyKey(null);
    }
  }, [refresh, canEdit, t]);

  const retryAllFailed = useCallback(async () => {
    if (!canEdit) {
      toast.error(t('common:connectWhitelistFirst'));
      return;
    }
    setBulkRetrying(true);
    try {
      const r = await api.retryFailedFulltext();
      const s = r?.summary;
      if (!s || s.queued === 0) {
        toast.info(t('mineru.noRetryable'));
      } else {
        toast.success(t('mineru.bulkRequeued', { count: s.queued }));
      }
      refresh();
    } catch (err) {
      toast.error(t('mineru.bulkRetryFailed', { message: err.message }));
    } finally {
      setBulkRetrying(false);
    }
  }, [refresh, canEdit, t]);

  const viewItem = useCallback((key) => {
    onSelectItem?.(key);
    onOpenChange?.(false);
  }, [onSelectItem, onOpenChange]);

  const changeFilter = useCallback((f) => {
    setFilter(f);
    setPage(1);
  }, []);

  const goPrev = useCallback(() => setPage(p => Math.max(1, p - 1)), []);
  const goNext = useCallback(() => setPage(p => Math.min(totalPages, p + 1)), [totalPages]);

  const filterCount = (id) => {
    if (id === 'all') return total;
    if (id === 'active') return activeCount;
    return counts[id] || 0;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100%-2rem)] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-5" />
            {t('mineru.title')}
          </DialogTitle>
          <DialogDescription>
            {t('mineru.totalTasks', { total })}
            {activeCount > 0 && <span className="text-brand">{t('mineru.activeCount', { count: activeCount })}</span>}
            {counts.done > 0 && <span className="text-green-600">{t('mineru.doneCount', { count: counts.done })}</span>}
            {counts.failed > 0 && <span className="text-red-600">{t('mineru.failedCount', { count: counts.failed })}</span>}
            {activeCount > 0 && <span className="ml-2 text-xs">{t('mineru.autoRefresh', { seconds: POLL_MS / 1000 })}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 px-6 py-2 border-b">
          {filters.map(f => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? 'default' : 'outline'}
              className="h-7"
              onClick={() => changeFilter(f.id)}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70 tabular-nums">{filterCount(f.id)}</span>
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between px-6 py-2 border-b">
          <span className="text-xs text-muted-foreground">
            {loading ? t('common:loading') : t('mineru.updatedAt', { time: new Date().toLocaleTimeString() })}
          </span>
          <div className="flex items-center gap-2">
            {canEdit && counts.failed > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={retryAllFailed}
                disabled={bulkRetrying || loading}
                title={t('mineru.retryAllTitle', { count: counts.failed })}
              >
                {bulkRetrying
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <RotateCcw className="size-3.5" />}
                {t('mineru.retryAll', { count: counts.failed })}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading} title={t('common:refresh')}>
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              {t('common:refresh')}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {total === 0 ? t('mineru.emptyAll') : t('mineru.emptyFiltered')}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('mineru.colStatus')}</th>
                  <th className="px-4 py-2 font-medium">{t('mineru.colTitle')}</th>
                  <th className="px-4 py-2 font-medium w-20">{t('mineru.colModel')}</th>
                  <th className="px-4 py-2 font-medium w-28">{t('mineru.colProgress')}</th>
                  <th className="px-4 py-2 font-medium w-40">{t('mineru.colSubmitted')}</th>
                  <th className="px-4 py-2 font-medium w-40">{t('mineru.colFinished')}</th>
                  <th className="px-4 py-2 font-medium w-24">{t('mineru.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isActive = ACTIVE.has(r.state);
                  return (
                    <tr key={r.itemKey} className="border-b last:border-0 hover:bg-accent/40 align-top">
                      <td className="px-4 py-2"><StateBadge state={r.state} /></td>
                      <td className="px-4 py-2 max-w-[260px]">
                        <div className="truncate font-medium" title={r.title || t('item:untitled')}>{r.title || t('item:untitled')}</div>
                        <div className="text-xs text-muted-foreground font-mono">{r.itemKey}</div>
                        {r.state === 'failed' && r.errMsg && (
                          <div className="mt-1 text-xs text-destructive line-clamp-2" title={r.errMsg}>{r.errMsg}</div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.modelVersion || '—'}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">
                        {isActive && r.totalPages ? `${r.extractedPages ?? 0} / ${r.totalPages}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">{fmtTime(r.submittedAt)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground tabular-nums">{fmtTime(r.completedAt)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => viewItem(r.itemKey)}
                            title={t('mineru.openDetail')}
                          >
                            <ExternalLink className="size-3" />
                          </Button>
                          {canEdit && r.state === 'failed' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => retry(r.itemKey)}
                              disabled={busyKey === r.itemKey}
                              title={t('mineru.retry')}
                            >
                              {busyKey === r.itemKey
                                ? <Loader2 className="size-3 animate-spin" />
                                : <RefreshCw className="size-3" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between px-6 py-2 border-t text-xs text-muted-foreground">
            <span>{t('mineru.pageInfo', { page, totalPages, pageSize: PAGE_SIZE })}</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={goPrev}
                disabled={page <= 1 || loading}
                title={t('common:prevPage')}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={goNext}
                disabled={page >= totalPages || loading}
                title={t('common:nextPage')}
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});
