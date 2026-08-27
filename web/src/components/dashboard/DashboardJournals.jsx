import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, LineChart, Line, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { UNFILED } from '@/lib/items';
import { CATEGORICAL_COLORS, SINGLE_SERIES_COLOR } from '@/lib/chartColors';
import { BasketCoveragePanel } from '@/components/dashboard/BasketCoveragePanel';
import { ChartTooltip } from '@/components/ui/chart-tooltip';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { PageHeader } from '@/components/PageHeader';

function displayJournalName(name, t) {
  return name === UNFILED ? t('common:unfiled') : name;
}

export function DashboardJournals() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { data: journals, error, loading } = useAsync(() => api.getStatsJournals(), []);

  const chartData = useMemo(() => {
    if (!journals) return [];
    return journals
      .map(j => ({
        name: displayJournalName(j.name, t),
        count: j.itemCount,
        isUnfiled: j.name === UNFILED,
      }))
      .sort((a, b) => b.count - a.count);
  }, [journals, t]);

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
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={t('common:nav.dashboard')} title={t('nav.journals')} />
      {loading && <LoadingSkeleton variant="chart" className="py-8" />}
      {error && (
        <ErrorState message={t('loadFailed', { message: error.message })} />
      )}

      {!loading && !error && <BasketCoveragePanel />}

      {journals && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('journals.countTitle')}</CardTitle>
              <CardDescription>{t('journals.countDesc')}</CardDescription>
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
                  <Tooltip content={<ChartTooltip sort yearLabel={(y) => t('journals.yearLabel', { year: y })} />} />
                  <Bar dataKey="count" name={t('itemCount')} radius={[0, 4, 4, 0]} barSize={18}>
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
              <div className="mt-4 overflow-x-auto border border-border/80 sm:hidden">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t('journals.colJournal')}</th>
                      <th className="px-4 py-2 font-medium text-right">{t('journals.colCount')}</th>
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
              <CardTitle>{t('journals.trendTitle')}</CardTitle>
              <CardDescription>{t('journals.trendDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <EmptyState className="h-64 py-0" title={t('journals.noYearData')} />
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
                    <Tooltip content={<ChartTooltip sort yearLabel={(y) => t('journals.yearLabel', { year: y })} />} />
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
