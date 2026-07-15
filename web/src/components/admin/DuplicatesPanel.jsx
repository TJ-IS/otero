import { useCallback, useState } from 'react';
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
import { Copy, FileSearch, Loader2, AlertCircle, RefreshCw, Search, PanelRightOpen } from 'lucide-react';
import { FloatingDetailPanel } from '@/components/FloatingDetailPanel';
import { ItemDetail } from '@/components/ItemDetail';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';

function ItemKeyButton({ itemKey, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(itemKey)}
      className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
      title="打开条目详情"
    >
      {itemKey} <PanelRightOpen className="size-3" />
    </button>
  );
}

function DuplicateGroup({ label, count, keys, dates, titles, onSelectItem }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">{label}</span>
          <Badge variant="destructive" className="shrink-0">{count} 份</Badge>
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
  const { data, error, loading, refresh } = useAsync(() => api.getAdminDuplicates(), [version]);

  if (loading && !data) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> 正在扫描重复条目...
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/40">
        <CardContent className="flex items-center gap-3 p-4 text-red-600 dark:text-red-400">
          <AlertCircle className="size-5" /> {error.message}
        </CardContent>
      </Card>
    );
  }

  const { duplicateDois = [], duplicateTitles = [], summary } = data || {};

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Badge variant="secondary">DOI 重复组 {summary?.totalDoiDuplicates ?? 0}</Badge>
          <Badge variant="secondary">标题重复组 {summary?.totalTitleDuplicates ?? 0}</Badge>
          <Badge variant="outline">受影响条目 {summary?.affectedItems ?? 0}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> 重新扫描
        </Button>
      </div>

      {duplicateDois.length === 0 && duplicateTitles.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            未发现重复条目 🎉
          </CardContent>
        </Card>
      )}

      {duplicateDois.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Copy className="size-4" /> DOI 完全重复
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
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Copy className="size-4" /> 标题重复（忽略大小写与首尾空格）
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
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">入库前查重</CardTitle>
          <CardDescription>按 DOI / 标题 / 作者查询库中是否已存在，避免重复收录。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSearch} className="grid gap-3 sm:grid-cols-3">
            <Input placeholder="DOI" value={form.doi} onChange={(e) => setForm({ ...form, doi: e.target.value })} />
            <Input placeholder="标题" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Input placeholder="作者姓氏" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            <div className="sm:col-span-3">
              <Button type="submit" size="sm" disabled={loading || (!form.doi && !form.title && !form.author)}>
                {loading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <Search className="mr-1.5 size-3.5" />}
                查询
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {err && (
        <Card className="border-red-500/40">
          <CardContent className="flex items-center gap-3 p-4 text-red-600 dark:text-red-400">
            <AlertCircle className="size-5" /> {err}
          </CardContent>
        </Card>
      )}

      {result && <SearchResult result={result} onSelectItem={onSelectItem} />}
    </div>
  );
}

function SearchResult({ result, onSelectItem }) {
  const doiHits = result.byDoi || [];
  const titleExact = result.byTitle?.exact || [];
  const titleFuzzy = result.byTitle?.fuzzy || [];
  const authorHits = result.byAuthor || [];
  const nothing = !doiHits.length && !titleExact.length && !titleFuzzy.length && !authorHits.length;

  if (nothing) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          未找到匹配条目，可安全入库。
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {doiHits.length > 0 && (
        <ResultBlock title="DOI 命中" tone="destructive" rows={doiHits.map((r) => ({ key: r.key, extra: r.doi }))} onSelectItem={onSelectItem} />
      )}
      {titleExact.length > 0 && (
        <ResultBlock title="标题完全匹配" tone="destructive" rows={titleExact.map((r) => ({ key: r.key, extra: r.title }))} onSelectItem={onSelectItem} />
      )}
      {titleFuzzy.length > 0 && (
        <ResultBlock
          title="标题相似"
          tone="warning"
          rows={titleFuzzy.map((r) => ({ key: r.key, extra: `${r.title} (${Math.round(r.similarity_score * 100)}%)` }))}
          onSelectItem={onSelectItem}
        />
      )}
      {authorHits.length > 0 && (
        <ResultBlock
          title="作者匹配"
          tone="secondary"
          rows={authorHits.map((r) => ({ key: r.key, extra: `${r.firstName || ''} ${r.lastName || ''}`.trim() }))}
          onSelectItem={onSelectItem}
        />
      )}
    </div>
  );
}

function ResultBlock({ title, tone, rows, onSelectItem }) {
  const badgeVariant = tone === 'warning' ? 'outline' : tone;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
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
      toast.message('当前条目有未保存的修改', { description: '请先保存或放弃修改后再关闭。' });
      return;
    }
    setSelectedKey(null);
  }, [detailDirty]);

  const confirmSwitch = useCallback(() => {
    setDetailDirty(false);
    setSelectedKey(pendingKey);
    setPendingKey(null);
  }, [pendingKey]);

  const handleDeleted = useCallback(() => {
    setSelectedKey(null);
    setDetailDirty(false);
    setDuplicatesVersion((version) => version + 1);
    toast.success('条目已删除');
  }, []);

  const handleChanged = useCallback(() => {
    setDuplicatesVersion((version) => version + 1);
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div className="h-full overflow-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FileSearch className="size-5" /> 文献条目查重
          </h2>
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">全库扫描</TabsTrigger>
              <TabsTrigger value="search">按条件查询</TabsTrigger>
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

      <FloatingDetailPanel open={!!selectedKey} onClose={closeDetail} width={520}>
        <div className="min-h-0 flex-1 overflow-hidden">
          {selectedKey ? (
            <ItemDetail
              itemKey={selectedKey}
              onDeleted={handleDeleted}
              onChanged={handleChanged}
              onDirtyChange={setDetailDirty}
            />
          ) : null}
        </div>
      </FloatingDetailPanel>

      <AlertDialog open={!!pendingKey} onOpenChange={(open) => { if (!open) setPendingKey(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>当前条目有未保存的修改，切换后将丢失这些改动。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>放弃并切换</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
