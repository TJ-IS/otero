import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Copy, FileSearch, Loader2, RefreshCw, Search, PanelRightOpen } from 'lucide-react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { ItemDetailDialog } from '@/components/ItemDetailDialog';
import { ItemDetail } from '@/components/ItemDetail';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';

function ItemKeyButton({ itemKey, onSelect }) {
  const { t } = useTranslation('admin');
  return (
    <button
      type="button"
      onClick={() => onSelect(itemKey)}
      className="inline-flex items-center gap-1 font-mono text-xs text-foreground hover:text-brand hover:underline"
      title={t('duplicates.openItem')}
    >
      {itemKey} <PanelRightOpen className="size-3" />
    </button>
  );
}

function DuplicateGroup({ label, count, keys, dates, titles, onSelectItem }) {
  const { t } = useTranslation('admin');
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{label}</span>
          <Badge variant="destructive" className="shrink-0">{t('duplicates.copies', { count })}</Badge>
        </div>
        <ul className="space-y-1">
          {keys?.map((key, i) => (
            <li key={key} className="flex items-center justify-between gap-2 text-sm">
              <ItemKeyButton itemKey={key} onSelect={onSelectItem} />
              <span className="truncate text-xs text-muted-foreground">
                {titles?.[i] || (dates?.[i] && new Date(dates[i].replace(' ', 'T') + 'Z').toLocaleDateString())}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AllDuplicates({ onSelectItem, version }) {
  const { t } = useTranslation('admin');
  const { data, error, loading, refresh } = useAsync(() => api.getAdminDuplicates(), [version]);

  if (loading && !data) {
    return <LoadingSkeleton variant="chart" className="h-48" label={t('duplicates.scanning')} />;
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={refresh} />;
  }

  const { duplicateDois = [], duplicateTitles = [], summary } = data || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Badge variant="secondary">{t('duplicates.doiGroups', { count: summary?.totalDoiDuplicates ?? 0 })}</Badge>
          <Badge variant="secondary">{t('duplicates.titleGroups', { count: summary?.totalTitleDuplicates ?? 0 })}</Badge>
          <Badge variant="outline">{t('duplicates.affected', { count: summary?.affectedItems ?? 0 })}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> {t('duplicates.rescan')}
        </Button>
      </div>

      {duplicateDois.length === 0 && duplicateTitles.length === 0 && (
        <EmptyState title={t('duplicates.noneFound')} />
      )}

      {duplicateDois.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 font-display text-base font-semibold">
            <Copy className="size-4" /> {t('duplicates.doiExact')}
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {duplicateDois.map((d) => (
              <DuplicateGroup
                key={d.doi}
                label={d.doi}
                count={d.count}
                keys={d.item_keys}
                dates={d.dates_added}
                onSelectItem={onSelectItem}
              />
            ))}
          </div>
        </section>
      )}

      {duplicateTitles.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 font-display text-base font-semibold">
            <Copy className="size-4" /> {t('duplicates.titleDup')}
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {duplicateTitles.map((d, i) => (
              <DuplicateGroup
                key={i}
                label={d.original_titles?.[0] || d.normalized_title}
                count={d.count}
                keys={d.item_keys}
                titles={d.original_titles}
                onSelectItem={onSelectItem}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function DuplicateSearch({ onSelectItem }) {
  const { t } = useTranslation('admin');
  const [form, setForm] = useState({ doi: '', title: '', author: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function onSearch(e) {
    e.preventDefault();
    if (!form.doi && !form.title && !form.author) return;
    setLoading(true);
    setErr(null);
    try {
      setResult(await api.checkAdminDuplicates(form));
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('duplicates.precheckTitle')}</CardTitle>
          <CardDescription>{t('duplicates.precheckDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSearch} className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="DOI" value={form.doi} onChange={(e) => setForm({ ...form, doi: e.target.value })} />
            <Input placeholder={t('duplicates.phTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input placeholder={t('duplicates.phAuthor')} value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={loading || (!form.doi && !form.title && !form.author)}>
                {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Search className="mr-1.5 size-3.5" />}
                {t('duplicates.query')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {err && <ErrorState className="py-8" message={err} />}

      {result && <SearchResult result={result} onSelectItem={onSelectItem} />}
    </div>
  );
}

function SearchResult({ result, onSelectItem }) {
  const { t } = useTranslation('admin');
  const doiHits = result.byDoi || [];
  const titleExact = result.byTitle?.exact || [];
  const titleFuzzy = result.byTitle?.fuzzy || [];
  const authorHits = result.byAuthor || [];
  const nothing = !doiHits.length && !titleExact.length && !titleFuzzy.length && !authorHits.length;

  if (nothing) {
    return (
      <Card>
        <CardContent>
          <EmptyState className="py-8" title={t('duplicates.safe')} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {doiHits.length > 0 && (
        <ResultBlock title={t('duplicates.doiHit')} tone="destructive" rows={doiHits.map((r) => ({ key: r.key, extra: r.doi }))} onSelectItem={onSelectItem} />
      )}
      {titleExact.length > 0 && (
        <ResultBlock title={t('duplicates.titleExact')} tone="destructive" rows={titleExact.map((r) => ({ key: r.key, extra: r.title }))} onSelectItem={onSelectItem} />
      )}
      {titleFuzzy.length > 0 && (
        <ResultBlock
          title={t('duplicates.titleSimilar')}
          tone="warning"
          rows={titleFuzzy.map((r) => ({ key: r.key, extra: `${r.title} (${Math.round(r.similarity_score * 100)}%)` }))}
          onSelectItem={onSelectItem}
        />
      )}
      {authorHits.length > 0 && (
        <ResultBlock
          title={t('duplicates.authorMatch')}
          tone="secondary"
          rows={authorHits.map((r) => ({ key: r.key, extra: `${r.firstName || ''} ${r.lastName || ''}`.trim() }))}
          onSelectItem={onSelectItem}
        />
      )}
    </div>
  );
}

function ResultBlock({ title, tone, rows, onSelectItem }) {
  const badgeVariant = tone === 'warning' ? 'warning' : tone;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Badge variant={badgeVariant}>{rows.length}</Badge> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((r, i) => (
            <li key={`${r.key}-${i}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <ItemKeyButton itemKey={r.key} onSelect={onSelectItem} />
              <span className="min-w-0 truncate text-xs text-muted-foreground">{r.extra}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function DuplicatesPanel() {
  const { t } = useTranslation(['admin', 'common']);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailDirty, setDetailDirty] = useState(false);
  const [pendingKey, setPendingKey] = useState(null);
  const [duplicatesVersion, setDuplicatesVersion] = useState(0);

  const selectItem = useCallback((key) => {
    if (key === selectedKey) return;
    if (detailDirty) {
      setPendingKey(key);
      return;
    }
    setSelectedKey(key);
  }, [detailDirty, selectedKey]);

  const closeDetail = useCallback(() => {
    if (detailDirty) {
      toast.message(t('common:unsavedChangesToast'), { description: t('common:unsavedCloseDesc') });
      return;
    }
    setSelectedKey(null);
  }, [detailDirty, t]);

  const confirmSwitch = useCallback(() => {
    setDetailDirty(false);
    setSelectedKey(pendingKey);
    setPendingKey(null);
  }, [pendingKey]);

  const handleDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDuplicatesVersion((version) => version + 1);
    toast.success(t('duplicates.itemDeleted'));
  }, [t]);

  const handleChanged = useCallback(() => {
    setDuplicatesVersion((version) => version + 1);
  }, []);

  return (
      <div className="relative h-full min-h-0 overflow-hidden">
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader
            eyebrow={t('common:nav.admin')}
            title={t('duplicates.title')}
            actions={<FileSearch className="size-5 text-brand" aria-hidden="true" />}
          />
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">{t('duplicates.tabAll')}</TabsTrigger>
              <TabsTrigger value="search">{t('duplicates.tabSearch')}</TabsTrigger>
            </TabsList>
            <TabsContent value="all" className="mt-4">
              <AllDuplicates onSelectItem={selectItem} version={duplicatesVersion} />
            </TabsContent>
            <TabsContent value="search" className="mt-4">
              <DuplicateSearch onSelectItem={selectItem} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ItemDetailDialog open={!!selectedKey} onClose={closeDetail}>
        {selectedKey ? (
          <ItemDetail
            itemKey={selectedKey}
            onDeleted={handleDeleted}
            onChanged={handleChanged}
            onDirtyChange={setDetailDirty}
          />
        ) : null}
      </ItemDetailDialog>

      <AlertDialog open={!!pendingKey} onOpenChange={(open) => { if (!open) setPendingKey(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('common:unsavedSwitchTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('common:unsavedSwitchDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:continueEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>{t('common:discardAndSwitch')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
