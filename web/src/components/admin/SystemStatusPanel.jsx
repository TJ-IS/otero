import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Database, HardDrive, Server, RefreshCw, AlertCircle,
  CheckCircle2, XCircle, Cpu, FileText, Paperclip,
} from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';

function StatusBadge({ status }) {
  const { t } = useTranslation('admin');
  const map = {
    connected: { label: t('status.connState.connected'), cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
    not_configured: { label: t('status.connState.not_configured'), cls: 'bg-muted text-muted-foreground', icon: HardDrive },
    bucket_not_found: { label: t('status.connState.bucket_not_found'), cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', icon: AlertCircle },
    error: { label: t('status.connState.error'), cls: 'bg-red-500/15 text-red-600 dark:text-red-400', icon: XCircle },
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

function formatUptime(sec, t) {
  if (sec == null) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return [
    d && t('status.uptimeDays', { n: d }),
    h && t('status.uptimeHours', { n: h }),
    t('status.uptimeMinutes', { n: m }),
  ].filter(Boolean).join(' ');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

export function SystemStatusPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const { data, error, loading, refresh } = useAsync(() => api.getAdminStatus(), []);

  if (loading && !data) {
    return <StatusSkeleton />;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 p-4 text-red-600 dark:text-red-400">
            <AlertCircle className="size-5" /> {t('status.loadFailed', { message: error.message })}
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
        <h2 className="text-lg font-semibold">{t('status.title')}</h2>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('status.refresh')}
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
            <CardDescription>{t('status.pgDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {pg?.status === 'connected' ? (
              <>
                <Row label={t('status.connUrl')} value={pg.connection?.url} mono />
                <Row label={t('status.database')} value={pg.database?.name} />
                <Row label={t('status.dbSize')} value={pg.database?.size} />
                <Row label={t('status.schemaVersion')} value={pg.database?.schemaVersion} />
                <Row label={t('status.serverTime')} value={pg.server?.serverTime && new Date(pg.server.serverTime).toLocaleString()} />
                <Row
                  label={t('status.connections')}
                  value={pg.connections && t('status.connectionsValue', {
                    active: pg.connections.active_connections,
                    idle: pg.connections.idle_connections,
                    total: pg.connections.total_connections,
                  })}
                />
                <Row
                  label={t('status.pool')}
                  value={pg.connection?.poolStats && t('status.poolValue', {
                    total: pg.connection.poolStats.totalCount,
                    idle: pg.connection.poolStats.idleCount,
                    waiting: pg.connection.poolStats.waitingCount,
                  })}
                />
                <Row label={t('status.version')} value={pg.server?.version?.split(' ').slice(0, 2).join(' ')} mono />
              </>
            ) : (
              <div className="py-4 text-sm text-red-600 dark:text-red-400">
                {pg?.error || t('status.cannotConnect')}
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
            <CardDescription>{r2?.storageType === 's3' ? t('status.r2S3') : t('status.r2Local')}</CardDescription>
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
                  <Row label={t('status.endpoint')} value={r2.endpoint?.url} mono />
                  <Row label={t('status.portSsl')} value={`${r2.endpoint?.port} / ${r2.endpoint?.useSSL ? t('common:yes') : t('common:no')}`} />
                  <Row label="Region" value={r2.endpoint?.region} />
                  <Row label={t('status.bucket')} value={r2.bucket?.name} mono />
                  <Row label={t('status.bucketStatus')} value={r2.bucket?.exists ? t('status.bucketExists') : t('status.bucketMissing')} />
                  <Row label={t('status.bucketAccess')} value={r2.bucket?.exists ? t('status.accessOk') : t('status.accessBad')} />
                  <Row label="Access Key" value={r2.credentials?.accessKey} mono />
                  <Row label={t('status.secretKey')} value={r2.credentials?.secretKeySet ? t('status.configured') : t('status.notConfigured')} />
                </>
              )
            ) : (
              <>
                <Row label={t('status.mode')} value={t('status.r2Local')} />
                <Row label={t('status.path')} value={r2?.localPath} mono />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Data + runtime */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={<FileText className="size-4" />} label={t('status.activeItems')} value={stats?.items?.active_items ?? '—'} sub={t('status.deletedItems', { count: stats?.items?.deleted_items ?? 0 })} />
        <StatTile icon={<Paperclip className="size-4" />} label={t('status.attachments')} value={stats?.attachments?.total_attachments ?? '—'} />
        <StatTile icon={<Cpu className="size-4" />} label="Node" value={sys?.nodeVersion} sub={sys?.platform} />
        <StatTile icon={<Server className="size-4" />} label={t('status.uptime')} value={formatUptime(sys?.uptime, t)} sub={sys?.memory && t('status.memory', { size: formatBytes(sys.memory.rss) })} />
      </div>

      {/* Table sizes */}
      {pg?.tables?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('status.tableSpace')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y text-sm">
              {pg.tables.map((tbl) => (
                <div key={tbl.tablename} className="flex items-center justify-between py-1.5">
                  <span className="font-mono text-xs">{tbl.tablename}</span>
                  <Badge variant="secondary" className="font-mono text-xs">{tbl.size}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {t('status.collectedAt', { time: data?.timestamp && new Date(data.timestamp).toLocaleString() })}
      </p>
    </div>
  );
}

function StatusSkeleton() {
  const { t } = useTranslation('admin');
  return (
    <div
      className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6"
      aria-busy="true"
      aria-label={t('status.loadingAria')}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((column) => (
          <Card key={column}>
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-5 w-16" />
              </div>
              <Skeleton className="h-3 w-32" />
            </CardHeader>
            <CardContent className="space-y-3">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="flex items-center justify-between gap-6">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className={`h-3 ${row % 2 ? 'w-28' : 'w-40'}`} />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <Card key={tile}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
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
