import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { FileText, Users, BookMarked, Link2, Paperclip, Hash } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { ITEM_TYPE_LABELS } from '@/lib/items';
import {
  colorForItemType, colorForFulltextState, FULLTEXT_STATE_LABELS,
} from '@/lib/chartColors';
import { DoiCoverageVenn } from '@/components/dashboard/DoiCoverageVenn';
import { StatTile } from '@/components/ui/stat-tile';
import { ChartTooltip } from '@/components/ui/chart-tooltip';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { PageHeader } from '@/components/PageHeader';

function shortHash(hash) {
  if (!hash) return '—';
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export function DashboardOverview() {
  const { t } = useTranslation(['dashboard', 'common']);
  const { data: overview, error: overviewError, loading: overviewLoading } = useAsync(() => api.getStatsOverview(), []);
  const { data: itemTypes, loading: itemTypesLoading } = useAsync(() => api.getStatsItemTypes(), []);
  const { data: fulltext, loading: fulltextLoading } = useAsync(() => api.getStatsFulltext(), []);
  const { data: coverage, loading: coverageLoading } = useAsync(() => api.getStatsDoiCoverage(), []);
  const { data: merkleRoot } = useAsync(() => api.getMerkleRoot(), []);

  const itemTypeData = useMemo(() => (itemTypes || []).map(row => ({
    itemType: row.itemType,
    label: ITEM_TYPE_LABELS[row.itemType] || row.itemType,
    count: row.count,
    color: colorForItemType(row.itemType),
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
    <div className="mx-auto w-full max-w-page space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader eyebrow={t('common:nav.dashboard')} title={t('nav.overview')} />
      {overviewLoading && <LoadingSkeleton variant="stats" className="py-8" />}
      {overviewError && (
        <ErrorState message={t('loadFailed', { message: overviewError.message })} />
      )}

      {overview && (
        <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatTile icon={<FileText className="size-4" />} label={t('overview.totalItems')} value={overview.totalItems} />
          <StatTile icon={<BookMarked className="size-4" />} label={t('overview.journalCount')} value={overview.journalCount} />
          <StatTile icon={<Users className="size-4" />} label={t('overview.totalCreators')} value={overview.totalCreators} />
          <StatTile
            icon={<Link2 className="size-4" />}
            label={t('overview.withDoi')}
            value={overview.withDoi}
            sub={`${Math.round((overview.withDoi / Math.max(1, overview.totalItems)) * 100)}%`}
          />
          <StatTile
            icon={<Paperclip className="size-4" />}
            label={t('overview.withFulltext')}
            value={overview.withAttachment}
            sub={fulltextDoneRatio != null ? t('overview.parseDonePct', { pct: fulltextDoneRatio }) : undefined}
          />
          <StatTile
            icon={<Hash className="size-4" />}
            label="Merkle Root"
            value={merkleRoot ? shortHash(merkleRoot.root) : '—'}
            valueTitle={merkleRoot?.root}
            sub={merkleRoot ? t('overview.merkleLeaves', { count: merkleRoot.leafCount }) : undefined}
            mono
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('overview.coverageTitle')}</CardTitle>
          <CardDescription>
            {t('overview.coverageDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {coverageLoading ? (
            <LoadingSkeleton variant="chart" />
          ) : !coverage ? (
            <EmptyState className="h-64 py-0" title={t('noData')} />
          ) : (
            <DoiCoverageVenn data={coverage} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('overview.typeDistTitle')}</CardTitle>
            <CardDescription>{t('overview.typeDistDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {itemTypesLoading ? (
              <LoadingSkeleton variant="chart" />
            ) : itemTypeData.length === 0 ? (
              <EmptyState className="h-64 py-0" title={t('noData')} />
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
            <CardTitle>{t('overview.fulltextTitle')}</CardTitle>
            <CardDescription>
              {t('overview.fulltextDesc')}
              {failedCount > 0 && <span className="ml-1">{t('overview.fulltextFailed429', { count: failedCount })}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {fulltextLoading ? (
              <LoadingSkeleton variant="chart" />
            ) : fulltextData.length === 0 ? (
              <EmptyState className="h-64 py-0" title={t('noData')} />
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
                  <Bar dataKey="count" name={t('itemCount')} radius={[0, 4, 4, 0]} barSize={18}>
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
