import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import { FileText, RefreshCw, Trash2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';

// KaTeX CSS — imported once for this view. Vite bundles it.
import 'katex/dist/katex.min.css';

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

/**
 * Lightweight "image lightbox" using the existing Dialog primitive.
 */
function ImageLightbox({ src, alt, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 overflow-hidden flex flex-col items-center justify-center">
        <DialogTitle className="sr-only">{alt || '图片预览'}</DialogTitle>
        <img src={src} alt={alt || ''} className="max-w-full max-h-[85vh] object-contain rounded" />
      </DialogContent>
    </Dialog>
  );
}

export const FullTextView = memo(function FullTextView({ itemKey, hasPdf }) {
  const { data: row, error, loading, refresh } = useAsync(() => api.getFulltext(itemKey), [itemKey]);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState({ open: false, src: '', alt: '' });
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
  }, [itemKey, refresh]);

  const removeFulltext = useCallback(async () => {
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
  }, [itemKey, refresh]);

  // Markdown components: rewrite relative image srcs to absolute asset URLs,
  // open images in a lightbox on click, lazy-load, open external links safely.
  const mdComponents = useMemo(() => ({
    img: ({ src, alt, ...rest }) => {
      const fullSrc = src?.startsWith('http') || src?.startsWith('/')
        ? src
        : `${row?.imagesBaseUrl || ''}/${String(src).replace(/^\.\//, '')}`;
      return (
        <span className="block my-4">
          <img
            src={fullSrc}
            alt={alt || ''}
            loading="lazy"
            className="max-w-full rounded-md border cursor-zoom-in hover:opacity-90 transition-opacity mx-auto"
            onClick={() => setLightbox({ open: true, src: fullSrc, alt: alt || '' })}
            {...rest}
          />
          {alt && <span className="block text-center text-xs text-muted-foreground mt-1">{alt}</span>}
        </span>
      );
    },
    a: ({ href, children, ...rest }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" {...rest}>
        {children}
      </a>
    ),
    table: ({ children, ...rest }) => (
      <div className="overflow-x-auto my-4">
        <table {...rest}>{children}</table>
      </div>
    ),
  }), [row?.imagesBaseUrl]);

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
          {state === 'done' && (
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
          {state === 'idle' && (
            <Button size="sm" onClick={() => triggerParse()} disabled={busy}>
              <FileText className="size-3.5" /> 解析全文
            </Button>
          )}
          {state === 'failed' && (
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
            <article className="max-w-none px-6 py-4 fulltext-prose">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeRaw, rehypeKatex]}
                components={mdComponents}
              >
                {row.markdown}
              </ReactMarkdown>
            </article>
          </div>
        )}

        {state === 'done' && !row?.markdown && (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 opacity-40" />
            <p>已解析，但未找到 Markdown 文件。</p>
          </div>
        )}
      </div>

      <ImageLightbox
        src={lightbox.src}
        alt={lightbox.alt}
        open={lightbox.open}
        onOpenChange={(open) => setLightbox(s => ({ ...s, open }))}
      />
    </div>
  );
});
