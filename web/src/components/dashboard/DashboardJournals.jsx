import { useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { UNFILED } from '@/lib/items';
import { CATEGORICAL_COLORS, SINGLE_SERIES_COLOR } from '@/lib/chartColors';
import { BasketCoveragePanel } from '@/components/dashboard/BasketCoveragePanel';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="max-h-72 overflow-y-auto rounded-md border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1.5 font-medium text-popover-foreground">{label} 年</div>}
      {sorted.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: p.color }} />
          <span className="truncate max-w-[200px]">{p.name}</span>
          <span className="ml-auto tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardJournals() {
  const { data: journals, error, loading } = useAsync(() => api.getStatsJournals(), []);

  const chartData = useMemo(() => {
    if (!journals) return [];
    return journals
      .map(j => ({ name: j.name, count: j.itemCount, isUnfiled: j.name === UNFILED }))
      .sort((a, b) => b.count - a.count);
  }, [journals]);

  // Journals to show in the year trend (excluding the UNFILED catchall)
  const trendJournals = useMemo(() => {
    if (!journals) return [];
    return journals.filter(j => j.name !== UNFILED);
  }, [journals]);

  // Pivot to wide format: [{year, "MIS Quarterly": N, "ISR": M, ...}]
  const trendData = useMemo(() => {
    if (!trendJournals.length) return [];
    const yearSet = new Set();
    for (const j of trendJournals) {
      for (const y of j.years) yearSet.add(y.year);
    }
    const years = [...yearSet].sort((a, b) => a - b);
    return years.map(year => {
      const row = { year };
      for (const j of trendJournals) {
        const entry = j.years.find(y => y.year === year);
        row[j.name] = entry ? entry.count : 0;
      }
      return row;
    });
  }, [trendJournals]);

  const barHeight = Math.max(240, chartData.length * 32);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      {loading && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> 加载中…
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-destructive">
          <AlertCircle className="size-8" />
          <p>加载失败: {error.message}</p>
        </div>
      )}

      {!loading && !error && <BasketCoveragePanel />}

      {journals && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">各期刊条目数</CardTitle>
              <CardDescription>AIS Senior Scholars&apos; Basket 11 个期刊 + 待归档条目数量</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={220}
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="条目数" radius={[0, 4, 4, 0]} barSize={18}>
                    {chartData.map((d) => (
                      <Cell
                        key={d.name}
                        fill={d.isUnfiled ? 'hsl(var(--muted-foreground))' : SINGLE_SERIES_COLOR}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Accessible table fallback */}
              <div className="mt-4 overflow-x-auto rounded-md border sm:hidden">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-background text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                    <tr>
                      <th className="px-4 py-2 font-medium">期刊</th>
                      <th className="px-4 py-2 font-medium text-right">条目数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map(d => (
                      <tr key={d.name} className="border-b last:border-0 hover:bg-accent/40">
                        <td className="px-4 py-2">{d.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">各期刊逐年发文趋势</CardTitle>
              <CardDescription>11 个 Basket 期刊历年发文数量对比（悬停查看详情）</CardDescription>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">暂无年度数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={trendData} margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                      interval="preserveStartEnd"
                      minTickGap={20}
                    />
                    <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: 11 }}
                      formatter={(value) => (
                        <span className="text-muted-foreground" style={{ fontSize: 11 }}>{value}</span>
                      )}
                    />
                    {trendJournals.map((j, i) => (
                      <Line
                        key={j.name}
                        type="monotone"
                        dataKey={j.name}
                        stroke={CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]}
                        strokeWidth={2}
                        strokeDasharray={i >= CATEGORICAL_COLORS.length ? '5 3' : undefined}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
