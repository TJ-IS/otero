import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ExternalLink, Loader2, AlertCircle, CheckCircle2, Clock, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';

const POLL_MS = 3000;
const ACTIVE = new Set(['submitting', 'pending', 'running', 'converting']);

const STATE_META = {
  idle:        { label: '未解析',   variant: 'secondary', icon: Clock,        pulse: false },
  submitting:  { label: '待提交',   variant: 'secondary', icon: Loader2,      pulse: true  },
  pending:     { label: '排队中',   variant: 'secondary', icon: Loader2,      pulse: true  },
  running:     { label: '解析中',   variant: 'secondary', icon: Loader2,      pulse: true  },
  converting:  { label: '转换中',   variant: 'secondary', icon: Loader2,      pulse: true  },
  done:        { label: '已完成',   variant: 'default',   icon: CheckCircle2, pulse: false },
  failed:      { label: '失败',     variant: 'destructive', icon: AlertCircle, pulse: false },
};

function StateBadge({ state }) {
  const m = STATE_META[state] || STATE_META.idle;
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className="inline-flex items-center gap-1 font-normal">
      <Icon className={`size-3 ${m.pulse ? 'animate-spin' : ''}`} />
      {m.label}
    </Badge>
  );
}

function fmtTime(s) {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 19);
}

export const MineruTaskLog = memo(function MineruTaskLog({ open, onOpenChange, onSelectItem }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.listFulltextPending();
      setRows(Array.isArray(items) ? items : []);
    } catch (err) {
      toast.error(`加载任务列表失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-poll while there are active tasks.
  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const hasActive = rows.some(r => ACTIVE.has(r.state));
    if (!hasActive) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    timerRef.current = setInterval(refresh, POLL_MS);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [open, rows, refresh]);

  const retry = useCallback(async (key) => {
    setBusyKey(key);
    try {
      await api.parseFulltext(key, { force: true });
      toast.success(`已重新提交: ${key}`);
      refresh();
    } catch (err) {
      toast.error(`重试失败: ${err.message}`);
    } finally {
      setBusyKey(null);
    }
  }, [refresh]);

  const viewItem = useCallback((key) => {
    onSelectItem?.(key);
    onOpenChange?.(false);
  }, [onSelectItem, onOpenChange]);

  // Summary counts
  const counts = rows.reduce((acc, r) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});
  const total = rows.length;
  const activeCount = ['submitting', 'pending', 'running', 'converting'].reduce((n, s) => n + (counts[s] || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-5" />
            MinerU 解析任务
          </DialogTitle>
          <DialogDescription>
            共 {total} 个任务
            {activeCount > 0 && <span className="text-blue-600"> · {activeCount} 个进行中</span>}
            {counts.done > 0 && <span className="text-green-600"> · {counts.done} 已完成</span>}
            {counts.failed > 0 && <span className="text-red-600"> · {counts.failed} 失败</span>}
            {activeCount > 0 && <span className="ml-2 text-xs">（每 {POLL_MS / 1000}s 自动刷新）</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between px-6 py-2 border-b">
          <span className="text-xs text-muted-foreground">
            {loading ? '加载中…' : `最近更新于 ${new Date().toLocaleTimeString()}`}
          </span>
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading} title="手动刷新">
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          {total === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              暂无解析任务。在条目详情页点击"解析全文"或在列表点"批量解析全文"即可创建。
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                <tr>
                  <th className="px-4 py-2 font-medium">状态</th>
                  <th className="px-4 py-2 font-medium">标题 / Key</th>
                  <th className="px-4 py-2 font-medium w-20">模型</th>
                  <th className="px-4 py-2 font-medium w-28">进度</th>
                  <th className="px-4 py-2 font-medium w-40">提交时间</th>
                  <th className="px-4 py-2 font-medium w-40">完成时间</th>
                  <th className="px-4 py-2 font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isActive = ACTIVE.has(r.state);
                  return (
                    <tr key={r.itemKey} className="border-b last:border-0 hover:bg-accent/40 align-top">
                      <td className="px-4 py-2"><StateBadge state={r.state} /></td>
                      <td className="px-4 py-2 max-w-[260px]">
                        <div className="truncate font-medium" title={r.title || '(无标题)'}>{r.title || '(无标题)'}</div>
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
                            title="在详情面板打开"
                          >
                            <ExternalLink className="size-3" />
                          </Button>
                          {r.state === 'failed' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => retry(r.itemKey)}
                              disabled={busyKey === r.itemKey}
                              title="重试"
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});
