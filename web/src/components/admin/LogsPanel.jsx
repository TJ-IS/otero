import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/ui/async-states';

const PAGE_SIZE = 50;

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export function LogsPanel() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ address: '', action: '', path: '' });
  const [draft, setDraft] = useState({ address: '', action: '', path: '' });
  const { data, error, loading, refresh } = useAsync(
    () => api.getAdminLogs({ page, pageSize: PAGE_SIZE, ...filters }),
    [page, filters]
  );

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={t('common:nav.admin')}
        title={t('logs.title')}
        description={t('logs.desc')}
        actions={(
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {t('status.refresh')}
          </Button>
        )}
      />

      <form
        className="grid gap-2 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({
            address: draft.address.trim(),
            action: draft.action.trim(),
            path: draft.path.trim(),
          });
        }}
      >
        <Input value={draft.address} onChange={(e) => setDraft(d => ({ ...d, address: e.target.value }))} placeholder={t('logs.phAddress')} />
        <Input value={draft.action} onChange={(e) => setDraft(d => ({ ...d, action: e.target.value }))} placeholder={t('logs.phAction')} />
        <Input value={draft.path} onChange={(e) => setDraft(d => ({ ...d, path: e.target.value }))} placeholder={t('logs.phPath')} />
        <Button type="submit" size="sm" variant="outline">{t('common:nav.search')}</Button>
      </form>

      {error ? <ErrorState message={t('logs.loadFailed', { message: error.message })} onRetry={refresh} /> : null}

      <section className="overflow-hidden border border-border/80">
        {loading && !data ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">{t('common:loadingDots')}</div>
        ) : logs.length === 0 ? (
          <EmptyState title={t('logs.emptyTitle')} description={t('logs.emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('logs.colTime')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('logs.colAction')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('logs.colWho')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('logs.colPath')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('logs.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((log) => (
                  <tr key={log.logID} className="transition-colors hover:bg-accent/40">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(log.createdAt, i18n.language)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                    <td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs" title={log.address || ''}>
                      {log.address || t('logs.guest')}
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-3 font-mono text-xs" title={`${log.method || ''} ${log.path || ''}`}>
                      {log.method} {log.path}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{log.statusCode ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('logs.pageOf', { page, total: totalPages })}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
                {t('common:prevPage')}
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(p => p + 1)}>
                {t('common:nextPage')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
