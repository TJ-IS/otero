import { useMemo } from 'react';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { SINGLE_SERIES_COLOR } from '@/lib/chartColors';

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1 font-medium text-popover-foreground">{label}年</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span>{p.name}: {formatter ? formatter(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardTimeline() {
  const { data: years, error, loading } = useAsync(() => api.getStatsYears(), []);

  const total = useMemo(() => (years || []).reduce((sum, y) => sum + y.count, 0), [years]);
  const span = years && years.length > 0 ? `${years[0].year} – ${years[years.length - 1].year}` : null;
  const peak = useMemo(() => {
    if (!years || years.length === 0) return null;
    return years.reduce((best, y) => (y.count > best.count ? y : best), years[0]);
  }, [years]);

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

      {years && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">发文总数</p>
                <p className="text-lg font-semibold tabular-nums leading-tight">{total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">年份跨度</p>
                <p className="text-lg font-semibold tabular-nums leading-tight">{span || '—'}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">发文峰值年</p>
                <p className="text-lg font-semibold tabular-nums leading-tight">
                  {peak ? `${peak.year} (${peak.count})` : '—'}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">发表年份分布</CardTitle>
              <CardDescription>
                按出版年份统计的条目数量（已剔除 1990 年前及超前年份的异常噪声数据）
              </CardDescription>
            </CardHeader>
            <CardContent>
              {years.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={years} margin={{ left: 0, right: 16, top: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="year"
                        tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                        interval="preserveStartEnd"
                        minTickGap={16}
                      />
                      <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={40} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="count" name="条目数" fill={SINGLE_SERIES_COLOR} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Accessible table fallback */}
                  <div className="mt-4 max-h-56 overflow-y-auto rounded-md border sm:hidden">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 bg-background text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                        <tr>
                          <th className="px-4 py-2 font-medium">年份</th>
                          <th className="px-4 py-2 font-medium text-right">条目数</th>
                        </tr>
                      </thead>
                      <tbody>
                        {years.map(y => (
                          <tr key={y.year} className="border-b last:border-0 hover:bg-accent/40">
                            <td className="px-4 py-2 tabular-nums">{y.year}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{y.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
