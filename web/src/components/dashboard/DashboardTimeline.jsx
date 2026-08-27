import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { SINGLE_SERIES_COLOR } from '@/lib/chartColors';
import { StatTile } from '@/components/ui/stat-tile';
import { ChartTooltip } from '@/components/ui/chart-tooltip';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { PageHeader } from '@/components/PageHeader';

export function DashboardTimeline() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { data: years, error, loading } = useAsync(() => api.getStatsYears(), []);

  const total = useMemo(() => (years || []).reduce((sum, y) => sum + y.count, 0), [years]);
  const span = years && years.length > 0 ? `${years[0].year} – ${years[years.length - 1].year}` : null;
  const peak = useMemo(() => {
    if (!years || years.length === 0) return null;
    return years.reduce((best, y) => (y.count > best.count ? y : best), years[0]);
  }, [years]);

  return (
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={t('common:nav.dashboard')} title={t('nav.timeline')} />
      {loading && <LoadingSkeleton variant="stats" className="py-8" />}
      {error && (
        <ErrorState message={t('loadFailed', { message: error.message })} />
      )}

      {years && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label={t('timeline.totalPubs')} value={total} />
            <StatTile label={t('timeline.yearSpan')} value={span || '—'} />
            <StatTile label={t('timeline.peakYear')} value={peak ? `${peak.year} (${peak.count})` : '—'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('timeline.distTitle')}</CardTitle>
              <CardDescription>
                {t('timeline.distDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {years.length === 0 ? (
                <EmptyState className="h-64 py-0" title={t('noData')} />
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
                      <Tooltip content={<ChartTooltip yearLabel={(y) => t('timeline.yearTooltip', { year: y })} />} />
                      <Bar dataKey="count" name={t('itemCount')} fill={SINGLE_SERIES_COLOR} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Accessible table fallback */}
                  <div className="mt-4 max-h-56 overflow-y-auto border border-border/80 sm:hidden">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10 border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">{t('timeline.colYear')}</th>
                          <th className="px-4 py-2 font-medium text-right">{t('timeline.colCount')}</th>
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
