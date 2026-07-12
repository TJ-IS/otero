import { useMemo } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, AlertCircle, FileText, Users, BookMarked, Link2, Paperclip, Hash } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import {
  colorForItemType, colorForFulltextState, FULLTEXT_STATE_LABELS,
} from '@/lib/chartColors';
import { DoiCoverageVenn } from '@/components/dashboard/DoiCoverageVenn';

function shortHash(hash) {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function StatCard({ icon, label, value, sub, valueTitle, mono }) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex h-full items-center gap-3 p-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p
            className={`truncate leading-tight tracking-tight tabular-nums ${
              mono ? 'font-mono text-sm font-semibold' : 'text-lg font-semibold'
            }`}
            title={valueTitle ?? (value != null ? String(value) : undefined)}
          >
            {value}
          </p>
          {/* Reserve one line so cards with/without sub stay the same height */}
          <p className="truncate text-xs leading-4 text-muted-foreground">
            {sub || '\u00A0'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1 font-medium text-popover-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span>{p.name}: {formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardOverview() {
  const { data: overview, error: overviewError, loading: overviewLoading } = useAsync(() => api.getStatsOverview(), []);
  const { data: itemTypes, loading: itemTypesLoading } = useAsync(() => api.getStatsItemTypes(), []);
  const { data: fulltext, loading: fulltextLoading } = useAsync(() => api.getStatsFulltext(), []);
  const { data: coverage, loading: coverageLoading } = useAsync(() => api.getStatsDoiCoverage(), []);
  const { data: merkleRoot } = useAsync(() => api.getMerkleRoot(), []);

  const itemTypeData = useMemo(() => (itemTypes || []).map(t => ({
    itemType: t.itemType,
    label: ITEM_TYPE_LABELS[t.itemType] || t.itemType,
    count: t.count,
    color: colorForItemType(t.itemType),
  })), [itemTypes]);

  const fulltextData = useMemo(() => {
    if (!fulltext) return [];
    const order = ['done', 'running', 'converting', 'pending', 'submitting', 'idle', 'failed'];
    return order
      .filter(state => fulltext[state] != null)
      .map(state => ({
        state,
        label: FULLTEXT_STATE_LABELS[state] || state,
        count: fulltext[state],
        color: colorForFulltextState(state),
      }));
  }, [fulltext]);

  const failedCount = fulltext?.failed || 0;

  const fulltextDoneRatio = overview && fulltext
    ? Math.round(((fulltext.done || 0) / Math.max(1, overview.totalItems)) * 100)
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      {overviewLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> 加载中…
        </div>
      )}
      {overviewError && (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-destructive">
          <AlertCircle className="size-8" />
          <p>加载失败: {overviewError.message}</p>
        </div>
      )}

      {overview && (
        <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard icon={<FileText className="size-4" />} label="文献总数" value={overview.totalItems} />
          <StatCard icon={<BookMarked className="size-4" />} label="收录期刊数" value={overview.journalCount} />
          <StatCard icon={<Users className="size-4" />} label="学者/创作者数" value={overview.totalCreators} />
          <StatCard
            icon={<Link2 className="size-4" />}
            label="含 DOI"
            value={overview.withDoi}
            sub={`${Math.round((overview.withDoi / Math.max(1, overview.totalItems)) * 100)}%`}
          />
          <StatCard
            icon={<Paperclip className="size-4" />}
            label="含全文附件"
            value={overview.withAttachment}
            sub={fulltextDoneRatio != null ? `解析完成 ${fulltextDoneRatio}%` : undefined}
          />
          <StatCard
            icon={<Hash className="size-4" />}
            label="Merkle Root"
            value={merkleRoot ? shortHash(merkleRoot.root) : '—'}
            valueTitle={merkleRoot?.root}
            sub={merkleRoot ? `${merkleRoot.leafCount} 个 DOI 叶子` : undefined}
            mono
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AIS Basket 收录进度</CardTitle>
          <CardDescription>
            左侧为 target_dois.txt 目标清单，右侧为文库已有 DOI；重叠区域为已收录篇目。点击「目标未收录」可查看缺失 DOI 列表。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {coverageLoading ? (
            <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 加载中…
            </div>
          ) : !coverage ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
          ) : (
            <DoiCoverageVenn data={coverage} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">条目类型分布</CardTitle>
            <CardDescription>按文献类型统计的条目数量</CardDescription>
          </CardHeader>
          <CardContent>
            {itemTypesLoading ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : itemTypeData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={itemTypeData}
                      dataKey="count"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={92}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {itemTypeData.map((d) => (
                        <Cell key={d.itemType} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      iconType="circle"
                      formatter={(value, entry) => (
                        <span className="text-xs text-muted-foreground">
                          {value} <span className="tabular-nums">({entry?.payload?.count})</span>
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Accessible table fallback for the pie chart */}
                <table className="mt-2 w-full text-xs text-muted-foreground sm:hidden">
                  <tbody>
                    {itemTypeData.map(d => (
                      <tr key={d.itemType} className="border-b last:border-0">
                        <td className="py-1">{d.label}</td>
                        <td className="py-1 text-right tabular-nums">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">全文解析状态</CardTitle>
            <CardDescription>
              MinerU 全文解析管线各状态的条目数
              {failedCount > 0 && <span className="ml-1">· {failedCount} 条失败均为限流(429)</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fulltextLoading ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : fulltextData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={fulltextData} layout="vertical" margin={{ left: 16, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={64}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="条目数" radius={[0, 4, 4, 0]} barSize={18}>
                    {fulltextData.map((d) => (
                      <Cell key={d.state} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
