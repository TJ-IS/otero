import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  Trash2, ScaleIcon,
} from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';

function StatTile({ icon, label, value, sub, tone }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            tone === 'warning'
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-primary/10 text-primary'
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{sub || ' '}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TruncatedNote({ truncated, listCap, total }) {
  if (!truncated) return null;
  return (
    <p className="px-1 text-xs text-muted-foreground">
      仅显示前 {listCap} 条，共 {total} 条。
    </p>
  );
}

export function StorageReconciliationPanel() {
  const { data, error, loading, refresh } = useAsync(() => api.getAdminReconcile(), []);
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

  const toggle = (name) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

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
      refresh();
    } catch (e) {
      setDeleteResult({ error: e.message });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> 正在对账存储...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 p-4 text-red-600 dark:text-red-400">
            <AlertCircle className="size-5" /> 加载失败：{error.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data?.status === 'not_applicable') {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <HardDrive className="size-5" /> {data.message}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ScaleIcon className="size-5" /> 存储对账（PostgreSQL ↔ R2）
        </h2>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> 重新对账
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Database className="size-4" />}
          label="PostgreSQL 存储引用"
          value={summary?.dbReferences ?? '—'}
          sub={summary ? `${summary.dbExactObjects} 个对象，${summary.dbPrefixes} 个目录` : undefined}
        />
        <StatTile icon={<HardDrive className="size-4" />} label="R2 对象总数" value={summary?.r2Objects ?? '—'} />
        <StatTile
          icon={<AlertCircle className="size-4" />}
          label="R2 中缺失"
          value={summary?.missingInR2 ?? '—'}
          sub="PostgreSQL 有记录，R2 无对象"
          tone={summary?.missingInR2 ? 'warning' : undefined}
        />
        <StatTile
          icon={<Trash2 className="size-4" />}
          label="R2 孤立对象"
          value={summary?.orphanInR2 ?? '—'}
          sub={summary?.orphanBytesFormatted ? `占用 ${summary.orphanBytesFormatted}` : undefined}
          tone={summary?.orphanInR2 ? 'warning' : undefined}
        />
      </div>

      {deleteResult && (
        <Card className={deleteResult.error ? 'border-red-500/40' : 'border-emerald-500/40'}>
          <CardContent className="p-4 text-sm">
            {deleteResult.error ? (
              <span className="text-red-600 dark:text-red-400">删除失败：{deleteResult.error}</span>
            ) : (
              <div className="space-y-1">
                <p>
                  已删除 <strong>{deleteResult.deleted.length}</strong> 个对象
                  {deleteResult.skipped.length > 0 && `，跳过 ${deleteResult.skipped.length} 个`}
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

      {/* Missing in R2 — read only */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">PostgreSQL 存在但 R2 缺失（只读）</CardTitle>
          <CardDescription>数据库中记录了附件或全文资产，但对应对象在 R2 中不存在。此列表仅供排查，不提供删除操作。</CardDescription>
        </CardHeader>
        <CardContent>
          {missingInR2.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">未发现缺失对象 🎉</p>
          ) : (
            <>
              <ul className="divide-y text-sm">
                {missingInR2.map((m, i) => (
                  <li key={`${m.key}-${m.path}-${i}`} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link
                        to={`/items/${m.key}`}
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      >
                        {m.key} <ExternalLink className="size-3" />
                      </Link>
                      <p className="truncate font-mono text-xs text-muted-foreground">{m.path}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline" className="text-xs">{m.type || 'attachment'}</Badge>
                      {m.deleted && <Badge variant="secondary">已删除条目</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
              <TruncatedNote truncated={data?.truncated?.missingInR2} listCap={data?.listCap} total={summary?.missingInR2} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Orphan in R2 — selectable + deletable */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">R2 存在但 PostgreSQL 无引用（可删除）</CardTitle>
              <CardDescription>这些对象在数据库中没有任何附件或全文记录指向它们，可以安全清理。</CardDescription>
            </div>
            {orphanInR2.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                disabled={selectedCount === 0}
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="mr-1.5 size-3.5" /> 删除选中（{selectedCount}）
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {orphanInR2.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">未发现孤立对象 🎉</p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span>全选本页</span>
              </div>
              <ul className="divide-y text-sm">
                {orphanInR2.map((o) => (
                  <li key={o.name} className="flex items-center gap-3 py-2">
                    <Checkbox checked={selected.has(o.name)} onCheckedChange={() => toggle(o.name)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs">{o.name}</p>
                      {o.key && <p className="truncate text-xs text-muted-foreground">关联条目：{o.key}</p>}
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">{o.type || 'unknown'}</Badge>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.sizeFormatted}</span>
                  </li>
                ))}
              </ul>
              <TruncatedNote truncated={data?.truncated?.orphanInR2} listCap={data?.listCap} total={summary?.orphanInR2} />
            </>
          )}
        </CardContent>
      </Card>

      {data?.timestamp && (
        <p className="text-center text-xs text-muted-foreground">
          采集于 {new Date(data.timestamp).toLocaleString()}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除孤立对象</AlertDialogTitle>
            <AlertDialogDescription>
              即将从 R2 永久删除 {selectedCount} 个对象（约 {(selectedBytes / 1024 / 1024).toFixed(2)} MB）。
              删除前会重新校验数据库引用，若期间有对象被引用将自动跳过。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Trash2 className="mr-1.5 size-3.5" />}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
