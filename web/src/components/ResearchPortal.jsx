import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpenText, Code2, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { usePageMeta } from '@/hooks/usePageMeta';
import { websiteJsonLd } from '@/lib/seo';
import { JOURNAL_META } from '@/lib/journal-meta';
import { cn } from '@/lib/utils';
import { SiteHeader } from '@/components/SiteHeader';
import { Skeleton } from '@/components/ui/skeleton';

function loadPortal(signal) {
  return Promise.all([
    api.getStatsOverview(),
    api.listJournals({ signal }),
    api.getStatsYears(),
  ]).then(([overview, journals, years]) => ({ overview, journals, years: years || [] }));
}

function fillYearSeries(years) {
  if (!years.length) return [];
  const byYear = new Map(years.map((row) => [row.year, row.count]));
  const start = years[0].year;
  const end = years[years.length - 1].year;
  const series = [];
  for (let year = start; year <= end; year += 1) {
    series.push({ year, count: byYear.get(year) || 0 });
  }
  return series;
}

function Stat({ label, value, detail }) {
  return (
    <div className="border-t border-border py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value ?? '—'}</p>
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

function PortalError({ message }) {
  const { t } = useTranslation('home');
  return (
    <div className="border-y border-brand/30 bg-brand/5 px-4 py-5 text-sm">
      <p className="font-medium text-brand">{t('loadFailed')}</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <Link className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline" to="/library">
        {t('openLibrary')} <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function PortalTimeline({ years }) {
  const { t } = useTranslation('home');
  const series = useMemo(() => fillYearSeries(years), [years]);
  const peak = useMemo(() => {
    if (!years.length) return null;
    return years.reduce((best, row) => (row.count > best.count ? row : best), years[0]);
  }, [years]);
  const dated = useMemo(() => years.reduce((sum, row) => sum + row.count, 0), [years]);
  const maxCount = peak?.count || 0;
  const start = series[0]?.year;
  const end = series[series.length - 1]?.year;
  const showPeakLabel = peak && peak.year !== start && peak.year !== end;

  if (!series.length) {
    return <p className="mt-5 border-t border-border py-4 text-sm text-muted-foreground">{t('noTimeline')}</p>;
  }

  return (
    <>
      <dl className="mt-5 grid grid-cols-3 gap-4 border-t border-border pt-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t('timelineSpan')}</dt>
          <dd className="mt-1 font-display text-lg font-semibold tabular-nums">{start} – {end}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('timelinePeak')}</dt>
          <dd className="mt-1 font-display text-lg font-semibold tabular-nums">
            {peak ? t('timelinePeakValue', { year: peak.year, count: peak.count.toLocaleString() }) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('timelineDated')}</dt>
          <dd className="mt-1 font-display text-lg font-semibold tabular-nums">{dated.toLocaleString()}</dd>
        </div>
      </dl>
      <div className="mt-6 flex h-40 items-end gap-px" role="img" aria-label={t('timelineTitle')}>
        {series.map((row) => {
          const height = row.count > 0 && maxCount
            ? Math.max((row.count / maxCount) * 100, 6)
            : 0;
          return (
            <Link
              key={row.year}
              to={`/library?year=${row.year}`}
              aria-label={t('yearBarLabel', { year: row.year, count: row.count })}
              title={t('yearBarLabel', { year: row.year, count: row.count })}
              className="group relative flex h-full min-w-0 flex-1 items-end outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  'block w-full origin-bottom rounded-t-[1px] transition-colors duration-200 group-hover:bg-brand group-active:scale-y-[0.98]',
                  row.count > 0 ? 'bg-brand/70' : 'bg-border',
                )}
                style={{ height: row.count > 0 ? `${height}%` : '2px' }}
              />
            </Link>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{start}</span>
        {showPeakLabel ? <span>{peak.year}</span> : null}
        <span>{end}</span>
      </div>
    </>
  );
}

export function ResearchPortal() {
  const { t } = useTranslation(['home', 'common']);
  const { data, loading, error } = useAsync(loadPortal, []);

  usePageMeta({
    title: t('common:seo.portalTitle'),
    description: t('common:seo.portalDescription'),
    canonicalPath: '/',
    jsonLd: websiteJsonLd(),
  });

  const years = useMemo(() => data?.years || [], [data?.years]);
  const overview = data?.overview;
  const journalCounts = useMemo(
    () => new Map((data?.journals || []).map((row) => [row.name, row.itemCount])),
    [data?.journals],
  );

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-page px-4 pb-20 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <section className="grid gap-10 border-b border-border pb-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)] lg:gap-16">
          <div className="max-w-3xl">
            <p className="mb-4 text-xs font-medium text-brand">{t('eyebrow')}</p>
            <h1 className="font-display text-4xl font-semibold leading-[1.08] text-balance sm:text-5xl lg:text-6xl">
              {t('title')}<span className="ml-2 inline-block size-2.5 rounded-sm bg-brand align-baseline" aria-hidden="true" />
            </h1>
            <p className="mt-5 max-w-[50ch] text-base leading-relaxed text-foreground/80 sm:text-lg">{t('intro')}</p>
            <form action="/search" method="get" className="mt-8 flex max-w-2xl items-center gap-2 border-b border-foreground/30 pb-2 focus-within:border-brand">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input name="q" aria-label={t('searchPlaceholder')} placeholder={t('searchPlaceholder')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/80" />
              <button type="submit" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-brand transition-transform hover:translate-x-0.5">
                {t('searchAction')} <ArrowRight className="size-3.5" />
              </button>
            </form>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/library" className="inline-flex items-center gap-2 rounded-sm bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-transform hover:-translate-y-0.5 active:translate-y-px">
                {t('openLibrary')} <ArrowRight className="size-3.5" />
              </Link>
              <Link to="/journals" className="inline-flex items-center gap-2 rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:border-brand hover:text-brand">
                {t('viewJournals')} <ArrowRight className="size-3.5" />
              </Link>
              <Link to="/docs/api" className="inline-flex items-center gap-2 rounded-sm border border-border px-4 py-2 text-sm font-medium text-foreground/80 transition-colors hover:border-brand hover:text-brand">
                {t('openApi')} <ArrowUpRight className="size-3.5" />
              </Link>
            </div>
          </div>
          <aside className="self-end border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pl-8">
            <p className="text-xs font-medium text-brand">{t('aboutLabel')}</p>
            <p className="mt-3 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">{t('aboutBody')}</p>
            <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpenText className="size-4 text-brand" />
              <span>{t('basketNote')}</span>
            </div>
          </aside>
        </section>

        {error && !data ? <div className="pt-6"><PortalError message={error.message} /></div> : null}

        <section className="grid gap-x-8 gap-y-5 border-b border-border py-10 sm:grid-cols-3 lg:grid-cols-5">
          {loading && !data ? (
            Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)
          ) : (
            <>
              <Stat label={t('stats.items')} value={overview?.totalItems?.toLocaleString()} />
              <Stat label={t('stats.journals')} value={overview?.journalCount} />
              <Stat label={t('stats.authors')} value={overview?.totalCreators?.toLocaleString()} />
              <Stat label={t('stats.doi')} value={overview?.withDoi?.toLocaleString()} detail={overview ? `${Math.round((overview.withDoi / Math.max(1, overview.totalItems)) * 100)}% ${t('stats.covered')}` : undefined} />
              <Stat label={t('stats.fulltext')} value={overview?.withAttachment?.toLocaleString()} />
            </>
          )}
        </section>

        <section className="grid gap-10 border-b border-border py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] lg:gap-16">
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-2xl font-semibold">
                <Link to="/journals" className="transition-colors hover:text-brand">{t('journalsTitle')}</Link>
              </h2>
              <Link to="/dashboard/journals" className="text-xs font-medium text-muted-foreground hover:text-brand">{t('fullBreakdown')}</Link>
            </div>
            <ul className="mt-5 divide-y divide-border border-t border-border">
              {JOURNAL_META.map((journal) => {
                const itemCount = journalCounts.get(journal.name);
                return (
                  <li key={journal.name}>
                    <Link to={`/library?journal=${encodeURIComponent(journal.name)}`} className="group flex items-baseline justify-between gap-4 py-3 text-sm">
                      <span className="min-w-0 truncate font-medium group-hover:text-brand">{journal.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                        {itemCount?.toLocaleString?.() ?? itemCount ?? '—'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-2xl font-semibold">{t('timelineTitle')}</h2>
              <Link to="/dashboard/timeline" className="text-xs font-medium text-muted-foreground hover:text-brand">{t('fullTimeline')}</Link>
            </div>
            {loading && !data ? <Skeleton className="mt-5 h-56" /> : <PortalTimeline years={years} />}
          </div>
        </section>

        <section className="flex flex-col gap-5 py-12 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <p className="text-xs font-medium text-brand">{t('apiEyebrow')}</p>
            <h2 className="mt-2 font-display text-2xl font-semibold">{t('apiTitle')}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('apiBody')}</p>
          </div>
          <Link to="/docs/api" className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-brand hover:underline">
            <Code2 className="size-4" /> {t('readApiDocs')} <ArrowUpRight className="size-3.5" />
          </Link>
        </section>
      </main>
    </div>
  );
}
