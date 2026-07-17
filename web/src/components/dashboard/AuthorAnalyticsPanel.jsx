import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, AlertCircle } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/api/client';
import { CATEGORICAL_COLORS, SINGLE_SERIES_COLOR } from '@/lib/chartColors';

function formatCount(n, lng) {
  return Number(n || 0).toLocaleString(lng || 'zh-CN');
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-lg">
      {label != null && <div className="mb-1 font-medium text-popover-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block size-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span>{p.name || p.payload?.label || p.dataKey}: {formatCount(p.value)}</span>
        </div>
      ))}
    </div>
  );
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

export function AuthorAnalyticsPanel() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation('dashboard');
  const lng = i18n.language;
  const { data, loading, error } = useAsync(() => api.getAuthorAnalytics({ topN: 25, coreN: 5 }), []);

  const typeData = useMemo(() => {
    if (!data?.creatorTypes) return [];
    return data.creatorTypes.map((row) => ({
      ...row,
      label: t(`authors.role.${row.type}`, { defaultValue: row.type }),
    }));
  }, [data, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t('authors.loadingStats')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-sm text-destructive">
        <AlertCircle className="size-6" />
        <p>{t('loadFailed', { message: error.message })}</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{t('authors.statsTitle')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('authors.authorTotal', { count: formatCount(data.authorTotal, lng) })}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t('authors.topAuthors')}</CardTitle>
            <CardDescription>{t('authors.topAuthorsDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-background text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium w-10">#</th>
                    <th className="px-3 py-2 font-medium">{t('authors.colScholar')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('authors.colPapers')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topAuthors.map((a, i) => (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={() => navigate(`/authors/${a.id}`)}
                        >
                          {a.name || t('authors.unnamed')}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{a.paperCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('authors.rolesTitle')}</CardTitle>
              <CardDescription>{t('authors.rolesDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={typeData}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={44}
                    outerRadius={72}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {typeData.map((_, i) => (
                      <Cell key={i} fill={CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {typeData.map((row, i) => (
                  <li key={row.type} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length] }}
                      />
                      {row.label}
                    </span>
                    <span className="tabular-nums">{formatCount(row.count, lng)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t('authors.productivityTitle')}</CardTitle>
              <CardDescription>{t('authors.productivityDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.papersPerAuthor} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={32} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name={t('authors.authorCount')} fill={SINGLE_SERIES_COLOR} radius={[4, 4, 0, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('authors.collabTitle')}</CardTitle>
          <CardDescription>{t('authors.collabDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.collabSize} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} allowDecimals={false} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name={t('authors.paperCountSeries')} fill={CATEGORICAL_COLORS[2]} radius={[4, 4, 0, 0]} barSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t('authors.coreAuthorsTitle')}</CardTitle>
          <CardDescription>{t('authors.coreAuthorsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(data.journalCores || []).map((jc) => (
              <div key={jc.journal} className="rounded-md border p-3">
                <p className="mb-2 text-xs font-medium leading-snug" title={jc.journal}>
                  <span className="sm:hidden">{JOURNAL_SHORT[jc.journal] || jc.journal}</span>
                  <span className="hidden sm:inline">{jc.journal}</span>
                </p>
                {jc.authors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('noData')}</p>
                ) : (
                  <ol className="space-y-1">
                    {jc.authors.map((a, i) => (
                      <li key={a.id} className="flex items-baseline justify-between gap-2 text-xs">
                        <button
                          type="button"
                          className="min-w-0 truncate text-left hover:underline"
                          onClick={() => navigate(`/authors/${a.id}`)}
                        >
                          <span className="mr-1 text-muted-foreground tabular-nums">{i + 1}.</span>
                          {a.name || t('authors.unnamed')}
                        </button>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{a.paperCount}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
