import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, RefreshCw, Trash2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/contexts/AuthContext';
import { FulltextMarkdown } from './FulltextMarkdown';

const POLL_INTERVAL_MS = 3000;
const ACTIVE_STATES = new Set(['submitting', 'pending', 'running', 'converting']);

function ProgressInfo({ row }) {
  const { t } = useTranslation('item');
  if (row.state === 'running' && row.totalPages) {
    return (
      <span className="text-xs text-muted-foreground">
        {t('fulltext.pages', { extracted: row.extractedPages ?? 0, total: row.totalPages })}
      </span>
    );
  }
  return null;
}

function StateBadge({ state }) {
  const { t } = useTranslation('item');
  const map = {
    idle: 'secondary',
    pending: 'secondary',
    running: 'secondary',
    converting: 'secondary',
    done: 'default',
    failed: 'destructive',
  };
  return (
    <Badge variant={map[state] || 'secondary'}>
      {t(`fulltextStatus.${state}`, { defaultValue: state })}
    </Badge>
  );
}

export const FullTextView = memo(function FullTextView({ itemKey, hasPdf }) {
  const { t } = useTranslation(['item', 'common']);
  const { canEdit } = useAuth();
  const {
    data: row,
    error,
    loading,
    refresh,
  } = useAsync((signal) => api.getFulltext(itemKey, { signal }), [itemKey]);
  const { data: structure } = useAsync(
    (signal) => api.getFulltextStructure(itemKey, { signal }),
    [itemKey],
  );
  const [busy, setBusy] = useState(false);
  const refreshTimer = useRef(null);

  const state = row?.state || 'idle';
  const isActive = ACTIVE_STATES.has(state);

  // Poll while active. Stable interval; clears on unmount / state change.
  useEffect(() => {
    if (!isActive) return;
    refreshTimer.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(refreshTimer.current);
  }, [isActive, refresh]);

  const triggerParse = useCallback(
    async ({ force = false } = {}) => {
      if (!canEdit) {
        toast.error(t('common:connectWhitelistFirst'));
        return;
      }
      setBusy(true);
      try {
        await api.parseFulltext(itemKey, { force });
        toast.success(t('fulltext.submitted'));
        refresh();
      } catch (err) {
        toast.error(t('fulltext.submitFailed', { message: err.message }));
      } finally {
        setBusy(false);
      }
    },
    [itemKey, refresh, canEdit, t],
  );

  const removeFulltext = useCallback(async () => {
    if (!canEdit) {
      toast.error(t('common:connectWhitelistFirst'));
      return;
    }
    setBusy(true);
    try {
      await api.deleteFulltext(itemKey);
      toast.success(t('fulltext.deleted'));
      refresh();
    } catch (err) {
      toast.error(t('fulltext.deleteFailed', { message: err.message }));
    } finally {
      setBusy(false);
    }
  }, [itemKey, refresh, canEdit, t]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('common:loadingDots')}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">
        {t('common:loadFailed', { message: error.message })}
      </div>
    );
  }
  if (!hasPdf) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <FileText className="size-8 opacity-40" />
        <p>{t('fulltext.noPdf')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <StateBadge state={state} />
        <ProgressInfo row={row} />
        <div className="ml-auto flex items-center gap-1.5">
          {canEdit && state === 'done' && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => triggerParse({ force: true })}
                disabled={busy}
                title={t('fulltext.reparse')}
              >
                <RefreshCw className="size-3.5" /> {t('fulltext.reparse')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={removeFulltext}
                disabled={busy}
                title={t('fulltext.delete')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
          {canEdit && state === 'idle' && (
            <Button size="sm" onClick={() => triggerParse()} disabled={busy}>
              <FileText className="size-3.5" /> {t('fulltext.parse')}
            </Button>
          )}
          {canEdit && state === 'failed' && (
            <Button size="sm" onClick={() => triggerParse({ force: true })} disabled={busy}>
              <RefreshCw className="size-3.5" /> {t('common:retry')}
            </Button>
          )}
          {isActive && (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="size-3.5 animate-spin" /> {t('fulltext.processing')}
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {state === 'idle' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileText className="size-8 opacity-40" />
            <p>{t('fulltext.idleHint')}</p>
            <p className="text-xs">{t('fulltext.idleHint2')}</p>
          </div>
        )}

        {isActive && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="size-8 animate-spin opacity-60" />
            <p>{t(`fulltextStatus.${state}`)}…</p>
            {row?.totalPages && (
              <p className="text-xs">
                {t('fulltext.pages', { extracted: row.extractedPages ?? 0, total: row.totalPages })}
              </p>
            )}
            <p className="text-xs">{t('fulltext.autoRefresh')}</p>
          </div>
        )}

        {state === 'failed' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
            <AlertCircle className="size-8" />
            <p>{t('fulltext.parseFailed')}</p>
            <p className="text-xs text-muted-foreground max-w-md">
              {row?.errMsg || t('common:unknownError')}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => triggerParse({ force: true })}
              disabled={busy}
              className="mt-2"
            >
              <RefreshCw className="size-3.5" /> {t('fulltext.reparse')}
            </Button>
          </div>
        )}

        {state === 'done' && row?.markdown && (
          <div className="h-full overflow-y-auto overflow-x-hidden">
            <FulltextMarkdown
              markdown={row.markdown}
              imagesBaseUrl={row.imagesBaseUrl}
              references={structure?.references || []}
              className="px-6 py-4 max-w-none"
            />
          </div>
        )}

        {state === 'done' && !row?.markdown && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 opacity-40" />
            <p>{t('fulltext.mdMissing')}</p>
          </div>
        )}
      </div>
    </div>
  );
});
