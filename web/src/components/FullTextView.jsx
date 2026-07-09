import { memo, useCallback, useEffect, useRef, useState } from 'react';
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

const STATE_LABELS = {
  idle: '未解析',
  submitting: '待提交',
  pending: '排队中',
  running: '解析中',
  converting: '格式转换中',
  done: '已完成',
  failed: '解析失败',
};

function ProgressInfo({ row }) {
  if (row.state === 'running' && row.totalPages) {
    return (
      <span className="text-xs text-muted-foreground">
        {row.extractedPages ?? 0} / {row.totalPages} 页
      </span>
    );
  }
  return null;
}

function StateBadge({ state }) {
  const map = {
    idle: 'secondary',
    pending: 'secondary',
    running: 'secondary',
    converting: 'secondary',
    done: 'default',
    failed: 'destructive',
  };
  return <Badge variant={map[state] || 'secondary'}>{STATE_LABELS[state] || state}</Badge>;
}

export const FullTextView = memo(function FullTextView({ itemKey, hasPdf }) {
  const { canEdit } = useAuth();
  const { data: row, error, loading, refresh } = useAsync(() => api.getFulltext(itemKey), [itemKey]);
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

  const triggerParse = useCallback(async ({ force = false } = {}) => {
    if (!canEdit) {
      toast.error('请先连接白名单钱包');
      return;
    }
    setBusy(true);
    try {
      await api.parseFulltext(itemKey, { force });
      toast.success('已提交解析任务');
      refresh();
    } catch (err) {
      toast.error(`提交失败: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [itemKey, refresh, canEdit]);

  const removeFulltext = useCallback(async () => {
    if (!canEdit) {
      toast.error('请先连接白名单钱包');
      return;
    }
    setBusy(true);
    try {
      await api.deleteFulltext(itemKey);
      toast.success('已删除全文');
      refresh();
    } catch (err) {
      toast.error(`删除失败: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [itemKey, refresh, canEdit]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center p-4 text-sm text-destructive">加载失败: {error.message}</div>;
  }
  if (!hasPdf) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <FileText className="size-8 opacity-40" />
        <p>该条目没有 PDF 附件，无法解析全文。</p>
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
                title="重新解析"
              >
                <RefreshCw className="size-3.5" /> 重新解析
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={removeFulltext}
                disabled={busy}
                title="删除全文"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
          {canEdit && state === 'idle' && (
            <Button size="sm" onClick={() => triggerParse()} disabled={busy}>
              <FileText className="size-3.5" /> 解析全文
            </Button>
          )}
          {canEdit && state === 'failed' && (
            <Button size="sm" onClick={() => triggerParse({ force: true })} disabled={busy}>
              <RefreshCw className="size-3.5" /> 重试
            </Button>
          )}
          {isActive && (
            <Button size="sm" variant="outline" disabled>
              <Loader2 className="size-3.5 animate-spin" /> 处理中
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {state === 'idle' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <FileText className="size-8 opacity-40" />
            <p>将 PDF 解析为 Markdown 全文，便于阅读与检索。</p>
            <p className="text-xs">解析约需 1–5 分钟，由 MinerU 在云端完成。</p>
          </div>
        )}

        {isActive && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            <Loader2 className="size-8 animate-spin opacity-60" />
            <p>{STATE_LABELS[state]}…</p>
            {row?.totalPages && (
              <p className="text-xs">{row.extractedPages ?? 0} / {row.totalPages} 页</p>
            )}
            <p className="text-xs">页面会自动刷新，也可稍后回来查看。</p>
          </div>
        )}

        {state === 'failed' && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-destructive">
            <AlertCircle className="size-8" />
            <p>解析失败</p>
            <p className="text-xs text-muted-foreground max-w-md">{row?.errMsg || '未知错误'}</p>
            <Button size="sm" variant="outline" onClick={() => triggerParse({ force: true })} disabled={busy} className="mt-2">
              <RefreshCw className="size-3.5" /> 重新解析
            </Button>
          </div>
        )}

        {state === 'done' && row?.markdown && (
          <div className="h-full overflow-y-auto overflow-x-hidden">
            <FulltextMarkdown
              markdown={row.markdown}
              imagesBaseUrl={row.imagesBaseUrl}
              className="px-6 py-4 max-w-none"
            />
          </div>
        )}

        {state === 'done' && !row?.markdown && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 opacity-40" />
            <p>已解析，但未找到 Markdown 文件。</p>
          </div>
        )}
      </div>

    </div>
  );
});
