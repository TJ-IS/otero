import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, Scan, Search, SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/api/client';
import { AIS_BASKET_JOURNALS } from '@/lib/items';
import { AuthorGraphCanvas } from '@/components/AuthorGraphCanvas';

const DEFAULT_FILTERS = {
  minPapers: 10,
  minCollaborations: 1,
  journal: '',
  yearFrom: '',
  yearTo: '',
};

const SIZE_METRICS = [
  { id: 'paperCount', label: '发文量' },
  { id: 'degree', label: '合作者数' },
  { id: 'weightedDegree', label: '合作强度' },
  { id: 'betweenness', label: '拓扑桥梁度' },
];

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}

function parseYear(value) {
  if (value === '') return null;
  if (!/^\d{4}$/.test(String(value))) return undefined;
  const year = Number(value);
  return year >= 1500 && year <= 2099 ? year : undefined;
}

function LoadingGraph() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="w-72 space-y-4" aria-label="正在计算合作网络">
        <div className="flex items-center justify-center gap-4">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="size-9 rounded-full" />
        </div>
        <Skeleton className="mx-auto h-2 w-52" />
        <p className="text-center text-xs text-muted-foreground">正在计算合作社区与网络指标…</p>
      </div>
    </div>
  );
}

function CompactField({ label, children, className = '' }) {
  return (
    <label className={`grid shrink-0 gap-1 ${className}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function AuthorGraph() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const debouncedFilters = useDebouncedValue(filters, 280);
  const [sizeMetric, setSizeMetric] = useState('paperCount');
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [resetToken, setResetToken] = useState(0);
  const [focusToken, setFocusToken] = useState(0);

  const yearFrom = parseYear(debouncedFilters.yearFrom);
  const yearTo = parseYear(debouncedFilters.yearTo);
  const yearError = yearFrom === undefined || yearTo === undefined
    ? '年份应为 1500–2099 之间的四位数'
    : yearFrom != null && yearTo != null && yearFrom > yearTo
      ? '起始年份不能晚于结束年份'
      : null;

  useEffect(() => {
    if (yearError) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.getAuthorGraph({
      minPapers: debouncedFilters.minPapers,
      minCollaborations: debouncedFilters.minCollaborations,
      journal: debouncedFilters.journal,
      yearFrom,
      yearTo,
      signal: controller.signal,
    })
      .then((result) => setGraph(result))
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedFilters, yearError, yearFrom, yearTo]);

  const nodes = graph?.nodes || [];
  const searchMatches = useMemo(() => {
    const normalized = searchQuery.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return nodes
      .filter((node) => node.name.toLocaleLowerCase().includes(normalized))
      .slice(0, 7);
  }, [nodes, searchQuery]);

  const updateFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const chooseAuthor = useCallback((id) => {
    setSelectedId(id);
    setSearchOpen(false);
    setFocusToken((token) => token + 1);
  }, []);

  const openAuthor = useCallback((id) => {
    navigate(`/authors/${id}`);
  }, [navigate]);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery('');
    setSelectedId(null);
  }, []);

  const meta = graph?.meta;
  const visibleError = yearError || error?.message;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-background">
        <div className="flex min-h-12 flex-wrap items-center gap-2 px-3 py-2 sm:px-4">
          <div className="mr-1 min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">学者合作网络</h1>
            <p className="hidden text-[11px] text-muted-foreground lg:block">AIS Basket · 指标基于当前显示网络</p>
          </div>

          {meta ? (
            <div className="hidden items-center gap-1.5 md:flex">
              <Badge variant="secondary" className="font-normal tabular-nums">{meta.nodeCount} 位学者</Badge>
              <Badge variant="secondary" className="font-normal tabular-nums">{meta.edgeCount} 条关系</Badge>
              <Badge variant="outline" className="font-normal tabular-nums">{meta.communityCount} 个社区</Badge>
            </div>
          ) : null}

          <div
            className="relative ml-auto w-full sm:w-64"
            onFocus={() => setSearchOpen(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false);
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && searchMatches[0]) chooseAuthor(searchMatches[0].id);
                if (event.key === 'Escape') setSearchOpen(false);
              }}
              className="h-8 pl-8 text-xs"
              placeholder="搜索当前网络中的学者"
              aria-label="搜索当前网络中的学者"
            />
            {searchOpen && searchQuery.trim() ? (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 overflow-hidden rounded-md border bg-popover shadow-md">
                {searchMatches.length ? searchMatches.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-xs last:border-0 hover:bg-muted/60 focus:bg-muted/60 focus:outline-none"
                    onClick={() => chooseAuthor(node.id)}
                  >
                    <span className="min-w-0 truncate">{node.name}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{node.paperCount} 篇</span>
                  </button>
                )) : (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    当前筛选范围内没有匹配学者，可降低发文阈值
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => navigate('/dashboard/authors/stats')}
            title="学者统计"
          >
            <BarChart3 className="size-4" />
            <span className="hidden lg:inline">统计</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setResetToken((token) => token + 1)}
            title="适应画布"
            aria-label="适应画布"
          >
            <Scan className="size-4" />
          </Button>
        </div>

        <div className="overflow-x-auto border-t bg-muted/20 px-3 py-2 sm:px-4">
          <div className="flex min-w-max items-end gap-3">
            <CompactField label="期刊" className="w-64">
              <Select
                value={filters.journal || 'all'}
                onValueChange={(value) => updateFilter('journal', value === 'all' ? '' : value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部 Basket 期刊</SelectItem>
                  {AIS_BASKET_JOURNALS.map((journal) => (
                    <SelectItem key={journal} value={journal}>{journal}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CompactField>

            <CompactField label="年份从" className="w-24">
              <Input
                type="number"
                min="1500"
                max="2099"
                inputMode="numeric"
                value={filters.yearFrom}
                onChange={(event) => updateFilter('yearFrom', event.target.value)}
                className="h-8 text-xs tabular-nums"
                placeholder="不限"
              />
            </CompactField>
            <CompactField label="至" className="w-24">
              <Input
                type="number"
                min="1500"
                max="2099"
                inputMode="numeric"
                value={filters.yearTo}
                onChange={(event) => updateFilter('yearTo', event.target.value)}
                className="h-8 text-xs tabular-nums"
                placeholder="不限"
              />
            </CompactField>

            <CompactField label={`最少发文 · ${filters.minPapers}`} className="w-36">
              <input
                type="range"
                min="1"
                max="20"
                value={filters.minPapers}
                onChange={(event) => updateFilter('minPapers', Number(event.target.value))}
                className="h-8 w-full accent-primary"
                aria-label="最少发文数"
                aria-valuetext={`${filters.minPapers} 篇`}
              />
            </CompactField>

            <CompactField label={`最少共同论文 · ${filters.minCollaborations}`} className="w-36">
              <input
                type="range"
                min="1"
                max="5"
                value={filters.minCollaborations}
                onChange={(event) => updateFilter('minCollaborations', Number(event.target.value))}
                className="h-8 w-full accent-primary"
                aria-label="最少共同论文数"
                aria-valuetext={`${filters.minCollaborations} 篇`}
              />
            </CompactField>

            <CompactField label="节点大小" className="w-36">
              <Select value={sizeMetric} onValueChange={setSizeMetric}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_METRICS.map((metric) => (
                    <SelectItem key={metric.id} value={metric.id}>{metric.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CompactField>

            <Button variant="ghost" size="sm" className="h-8 active:scale-[0.98]" onClick={resetFilters}>
              <SlidersHorizontal className="size-4" />
              重置筛选
            </Button>
          </div>
        </div>
      </header>

      {visibleError ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {visibleError}
        </div>
      ) : null}

      {meta?.truncated ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          当前条件有 {meta.eligibleNodeCount.toLocaleString('zh-CN')} 位学者，仅分析发文量最高的 {meta.nodeCount} 位；提高最少发文数可获得完整网络。
        </div>
      ) : null}

      {!graph && loading ? <LoadingGraph /> : null}

      {!graph && !loading && error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertTriangle className="size-6 text-destructive" />
          <div>
            <p className="text-sm font-medium">合作网络加载失败</p>
            <p className="mt-1 text-xs text-muted-foreground">{error.message}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setFilters((current) => ({ ...current }))}>
            重试
          </Button>
        </div>
      ) : null}

      {graph && nodes.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium">当前条件下没有学者网络</p>
          <p className="text-xs text-muted-foreground">可扩大年份范围，或降低最少发文与共同论文阈值。</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={resetFilters}>重置筛选</Button>
        </div>
      ) : null}

      {graph && nodes.length > 0 ? (
        <AuthorGraphCanvas
          nodes={nodes}
          edges={graph.edges || []}
          communities={graph.communities || []}
          meta={meta}
          sizeMetric={sizeMetric}
          searchQuery={searchQuery}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpenAuthor={openAuthor}
          resetToken={resetToken}
          focusToken={focusToken}
        />
      ) : null}

      {loading && graph ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          正在更新网络…
        </div>
      ) : null}
    </div>
  );
}
