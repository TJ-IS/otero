import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { CATEGORICAL_COLORS, STATUS_COLORS } from '@/lib/chartColors';
import { MissingDoisModal } from '@/components/dashboard/MissingDoisModal';

const UNRECOGNIZED = '未识别';

function formatCount(n, lng) {
  return Number(n || 0).toLocaleString(lng || 'zh-CN');
}

const JOURNAL_SHORT = {
  'MIS Quarterly': 'MISQ',
  'Information Systems Research': 'ISR',
  'Journal of Management Information Systems': 'JMIS',
  'Journal of the Association for Information Systems': 'JAIS',
  'European Journal of Information Systems': 'EJIS',
  'Information Systems Journal': 'ISJ',
  'Information and Organization': 'I&O',
  'Decision Support Systems': 'DSS',
  'Journal of Information Technology': 'JIT',
  'The Journal of Strategic Information Systems': 'JSIS',
  'Information & Management': 'I&M',
};

function displayJournalName(name, t) {
  return name === UNRECOGNIZED ? t('basket.unrecognized') : name;
}

function shortName(name, t) {
  if (name === UNRECOGNIZED) return t('basket.unrecognized');
  return JOURNAL_SHORT[name] || name;
}

function CoverageTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span>{p.name}</span>
          <span className="ml-auto tabular-nums">{formatCount(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function BasketCoveragePanel() {
  const { t, i18n } = useTranslation('dashboard');
  const lng = i18n.language;
  const { data, loading, error } = useAsync(() => api.getStatsDoiCoverageBreakdown(), []);
  const [missingFilter, setMissingFilter] = useState(null); // { journal, year } | null
  const [selectedJournal, setSelectedJournal] = useState(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = [...(data.journals || [])];
    if (data.unattributed) list.push(data.unattributed);
    return list.sort((a, b) => b.missing - a.missing || b.target - a.target);
  }, [data]);

  const selected = useMemo(() => {
    if (!selectedJournal || !data) return null;
    return rows.find((r) => r.name === selectedJournal) || null;
  }, [selectedJournal, rows, data]);

  const yearChartData = useMemo(() => {
    if (!selected?.years?.length) return [];
    // Focus recent years for readability
    return selected.years.filter((y) => y.year >= 2000);
  }, [selected]);

  const barHeight = Math.max(280, rows.length * 28);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('basket.title')}</CardTitle>
          <CardDescription>
            {t('basket.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('loading')}
            </div>
          ) : error ? (
            <div className="flex h-48 items-center justify-center text-sm text-destructive">
              {t('loadFailed', { message: error.message })}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t('basket.colJournal')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('basket.colTarget')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('basket.colCollected')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('basket.colMissing')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('basket.colCoverage')}</th>
                      <th className="px-3 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const active = selectedJournal === r.name;
                      return (
                        <tr
                          key={r.name}
                          className={`border-b last:border-0 transition-colors ${
                            active ? 'bg-muted/50' : 'hover:bg-muted/30'
                          }`}
                        >
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-left font-medium hover:underline"
                              onClick={() => setSelectedJournal(active ? null : r.name)}
                            >
                              <span className="hidden sm:inline">{displayJournalName(r.name, t)}</span>
                              <span className="sm:hidden">{shortName(r.name, t)}</span>
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.target, lng)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[hsl(var(--chart-good))]">
                            {formatCount(r.collected, lng)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              className="tabular-nums text-[hsl(var(--chart-1))] hover:underline disabled:no-underline disabled:opacity-40"
                              disabled={!r.missing}
                              onClick={() => setMissingFilter({ journal: r.name, year: null })}
                            >
                              {formatCount(r.missing, lng)}
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex min-w-[4.5rem] flex-col items-end gap-1">
                              <span className="tabular-nums font-medium">{r.coveragePct}%</span>
                              <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                                <span
                                  className="block h-full rounded-full bg-[hsl(var(--chart-good))]"
                                  style={{ width: `${Math.min(100, r.coveragePct)}%` }}
                                />
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {r.missing > 0 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setMissingFilter({ journal: r.name, year: null })}
                              >
                                {t('basket.view')}
                                <ExternalLink className="size-3" />
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <ResponsiveContainer width="100%" height={barHeight}>
                <BarChart
                  data={rows.map((r) => ({
                    name: shortName(r.name, t),
                    fullName: r.name,
                    collected: r.collected,
                    missing: r.missing,
                  }))}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={56}
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <Tooltip content={<CoverageTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="collected"
                    name={t('basket.colCollected')}
                    stackId="a"
                    fill={STATUS_COLORS.good}
                    radius={[0, 0, 0, 0]}
                    barSize={16}
                  />
                  <Bar
                    dataKey="missing"
                    name={t('basket.colMissing')}
                    stackId="a"
                    fill={CATEGORICAL_COLORS[0]}
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                    cursor="pointer"
                    onClick={(barData) => {
                      const row = barData?.payload || barData;
                      if (row?.fullName && row.missing > 0) {
                        setMissingFilter({ journal: row.fullName, year: null });
                      }
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>

              {selected ? (
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{displayJournalName(selected.name, t)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t('basket.yearBreakdown')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!selected.missing}
                      onClick={() => setMissingFilter({ journal: selected.name, year: null })}
                    >
                      {t('basket.allMissing', { count: formatCount(selected.missing, lng) })}
                    </Button>
                  </div>
                  {yearChartData.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">{t('basket.noYearSplit')}</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={yearChartData} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                          dataKey="year"
                          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          interval="preserveStartEnd"
                          minTickGap={16}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                          allowDecimals={false}
                          width={36}
                        />
                        <Tooltip content={<CoverageTooltip />} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="collected" name={t('basket.colCollected')} stackId="y" fill={STATUS_COLORS.good} barSize={14} />
                        <Bar
                          dataKey="missing"
                          name={t('basket.colMissing')}
                          stackId="y"
                          fill={CATEGORICAL_COLORS[0]}
                          barSize={14}
                          cursor="pointer"
                          onClick={(barData) => {
                            const row = barData?.payload || barData;
                            if (row?.year != null && row.missing > 0) {
                              setMissingFilter({ journal: selected.name, year: row.year });
                            }
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              ) : (
                <p className="text-center text-xs text-muted-foreground">{t('basket.clickJournal')}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <MissingDoisModal
        open={!!missingFilter}
        onOpenChange={(open) => { if (!open) setMissingFilter(null); }}
        journal={missingFilter?.journal || null}
        year={missingFilter?.year ?? null}
      />
    </>
  );
}
