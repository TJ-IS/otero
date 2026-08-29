import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState, ErrorState } from '@/components/ui/async-states';
import { toast } from 'sonner';

const PAGE_SIZE = 50;

function formatDate(value, locale) {
  if (!value) return '—';
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export function AccountsPanel() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const { data, error, loading, refresh } = useAsync(
    () => api.getAdminAccounts({ page, pageSize: PAGE_SIZE, q }),
    [page, q]
  );

  const accounts = data?.accounts || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function changeRole(address, role) {
    try {
      await api.patchAdminAccount(address, role);
      toast.success(t('accounts.roleUpdated'));
      refresh();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={t('common:nav.admin')}
        title={t('accounts.title')}
        description={t('accounts.desc')}
      />

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(draftQ.trim());
        }}
      >
        <Input
          value={draftQ}
          onChange={(e) => setDraftQ(e.target.value)}
          placeholder={t('accounts.searchPh')}
          className="max-w-xs"
        />
        <Button type="submit" size="sm" variant="outline">{t('common:nav.search')}</Button>
      </form>

      {error ? <ErrorState message={t('accounts.loadFailed', { message: error.message })} onRetry={refresh} /> : null}

      <section className="overflow-hidden border border-border/80">
        {loading && !data ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">{t('common:loadingDots')}</div>
        ) : accounts.length === 0 ? (
          <EmptyState title={t('accounts.emptyTitle')} description={t('accounts.emptyDesc')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('accounts.colAddress')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('accounts.colRole')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('accounts.colCreated')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('accounts.colLogin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {accounts.map((account) => (
                  <tr key={account.accountID} className="transition-colors hover:bg-accent/40">
                    <td className="px-4 py-3 font-mono text-xs">
                      {account.address}
                      {account.bootstrap ? (
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">{t('accounts.bootstrap')}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        value={account.role}
                        disabled={account.bootstrap}
                        onValueChange={(role) => changeRole(account.address, role)}
                      >
                        <SelectTrigger className="h-8 w-32 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">{t('accounts.roleUser')}</SelectItem>
                          <SelectItem value="admin">{t('accounts.roleAdmin')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(account.createdAt, i18n.language)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {formatDate(account.lastLoginAt, i18n.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-xs text-muted-foreground">{t('accounts.pageOf', { page, total: totalPages })}</p>
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
