import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Database, HardDrive, Server, RefreshCw, Loader2, AlertCircle,
  CheckCircle2, XCircle, Cpu, FileText, Paperclip,
} from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';

function StatusBadge({ status }) {
  const map = {
    connected: { label: '已连接', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
    not_configured: { label: '未启用', cls: 'bg-muted text-muted-foreground', icon: HardDrive },
    bucket_not_found: { label: '存储桶缺失', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', icon: AlertCircle },
    error: { label: '连接失败', cls: 'bg-red-500/15 text-red-600 dark:text-red-400', icon: XCircle },
  };
  const s = map[status] || map.error;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <Icon className="size-3" /> {s.label}
    </span>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 break-all text-right ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</span>
    </div>
  );
}

function formatUptime(sec) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [d && `${d}天`, h && `${h}小时`, `${m}分钟`].filter(Boolean).join(' ');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

export function SystemStatusPanel() {
  const { data, error, loading, refresh } = useAsync(() => api.getAdminStatus(), []);

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> 正在检测连接...
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

  const pg = data?.postgres;
  const r2 = data?.r2;
  const stats = data?.statistics;
  const sys = data?.config;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">数据库与存储连接</h2>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* PostgreSQL */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4 text-primary" /> PostgreSQL
              </CardTitle>
              <StatusBadge status={pg?.status} />
            </div>
            <CardDescription>元数据主库</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {pg?.status === 'connected' ? (
              <>
                <Row label="连接串" value={pg.connection?.url} mono />
                <Row label="数据库" value={pg.database?.name} />
                <Row label="库大小" value={pg.database?.size} />
                <Row label="Schema 版本" value={pg.database?.schemaVersion} />
                <Row label="服务端时间" value={pg.server?.serverTime && new Date(pg.server.serverTime).toLocaleString()} />
                <Row
                  label="连接数"
                  value={pg.connections && `活跃 ${pg.connections.active_connections} / 空闲 ${pg.connections.idle_connections} / 共 ${pg.connections.total_connections}`}
                />
                <Row
                  label="连接池"
                  value={pg.connection?.poolStats && `总 ${pg.connection.poolStats.totalCount} · 空闲 ${pg.connection.poolStats.idleCount} · 等待 ${pg.connection.poolStats.waitingCount}`}
                />
                <Row label="版本" value={pg.server?.version?.split(' ').slice(0, 2).join(' ')} mono />
              </>
            ) : (
              <div className="py-4 text-sm text-red-600 dark:text-red-400">
                {pg?.error || '无法连接'}
                <div className="mt-1 font-mono text-xs text-muted-foreground">{pg?.connection?.url}</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* R2 */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="size-4 text-primary" /> Cloudflare R2
              </CardTitle>
              <StatusBadge status={r2?.status} />
            </div>
            <CardDescription>{r2?.storageType === 's3' ? 'S3 兼容对象存储' : '本地文件系统'}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {r2?.storageType === 's3' ? (
              r2.status === 'error' ? (
                <div className="py-4 text-sm text-red-600 dark:text-red-400">
                  {r2.error}
                  {r2.errorCode && <span className="ml-1 font-mono text-xs">({r2.errorCode})</span>}
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{r2.endpoint?.url}</div>
                </div>
              ) : (
                <>
                  <Row label="端点" value={r2.endpoint?.url} mono />
                  <Row label="端口 / SSL" value={`${r2.endpoint?.port} / ${r2.endpoint?.useSSL ? '是' : '否'}`} />
                  <Row label="Region" value={r2.endpoint?.region} />
                  <Row label="存储桶" value={r2.bucket?.name} mono />
                  <Row label="桶状态" value={r2.bucket?.exists ? '存在' : '不存在'} />
                  <Row label="对象数（顶层）" value={r2.bucket?.objectCount} />
                  <Row label="Access Key" value={r2.credentials?.accessKey} mono />
                  <Row label="Secret Key" value={r2.credentials?.secretKeySet ? '已配置' : '未配置'} />
                </>
              )
            ) : (
              <>
                <Row label="模式" value="本地文件系统" />
                <Row label="路径" value={r2?.localPath} mono />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data + runtime */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={<FileText className="size-4" />} label="有效条目" value={stats?.items?.active_items ?? '—'} sub={`已删除 ${stats?.items?.deleted_items ?? 0}`} />
        <StatTile icon={<Paperclip className="size-4" />} label="附件" value={stats?.attachments?.total_attachments ?? '—'} />
        <StatTile icon={<Cpu className="size-4" />} label="Node" value={sys?.nodeVersion} sub={sys?.platform} />
        <StatTile icon={<Server className="size-4" />} label="运行时长" value={formatUptime(sys?.uptime)} sub={sys?.memory && `内存 ${formatBytes(sys.memory.rss)}`} />
      </div>

      {/* Table sizes */}
      {pg?.tables?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">表空间占用（Top 10）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y text-sm">
              {pg.tables.map((t) => (
                <div key={t.tablename} className="flex items-center justify-between py-1.5">
                  <span className="font-mono text-xs">{t.tablename}</span>
                  <Badge variant="secondary" className="font-mono text-xs">{t.size}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        采集于 {data?.timestamp && new Date(data.timestamp).toLocaleString()}
      </p>
    </div>
  );
}

function StatTile({ icon, label, value, sub }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-semibold tabular-nums">{value}</p>
          <p className="truncate text-xs text-muted-foreground">{sub || ' '}</p>
        </div>
      </CardContent>
    </Card>
  );
}
