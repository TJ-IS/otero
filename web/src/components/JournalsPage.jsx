import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { usePageMeta } from '@/hooks/usePageMeta';
import { journalsJsonLd } from '@/lib/seo';
import { JOURNAL_META } from '@/lib/journal-meta';
import { SiteHeader } from '@/components/SiteHeader';
import { Skeleton } from '@/components/ui/skeleton';

function loadJournalCounts(signal) {
  return api.listJournals({ signal });
}

export function JournalsPage() {
  const { t } = useTranslation(['journals', 'common']);
  const { data, loading, error } = useAsync(loadJournalCounts, []);

  usePageMeta({
    title: t('common:seo.journalsTitle'),
    description: t('common:seo.journalsDescription'),
    canonicalPath: '/journals',
    jsonLd: journalsJsonLd(),
  });

  const counts = new Map((data || []).map((row) => [row.name, row.itemCount]));

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-page px-4 pb-20 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <header className="max-w-3xl border-b border-border pb-10">
          <p className="mb-4 text-xs font-medium text-brand">{t('eyebrow')}</p>
          <h1 className="font-display text-4xl font-semibold leading-[1.08] text-balance sm:text-5xl">
            {t('title')}
          </h1>
          <p className="mt-5 max-w-[62ch] text-base leading-relaxed text-foreground/80 sm:text-lg">{t('lead')}</p>
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">{t('why')}</p>
        </header>

        {error && !data ? (
          <p className="mt-6 border-y border-brand/30 bg-brand/5 px-4 py-4 text-sm text-muted-foreground">
            {t('loadFailed')}
          </p>
        ) : null}

        <ol className="mt-2 divide-y divide-border border-b border-border">
          {JOURNAL_META.map((journal, index) => {
            const count = counts.get(journal.name);
            const libraryTo = `/library?journal=${encodeURIComponent(journal.name)}`;
            return (
              <li key={journal.name} className="grid gap-3 py-6 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-6">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      to={libraryTo}
                      className="font-display text-xl font-semibold leading-snug transition-colors hover:text-brand"
                    >
                      {journal.name}
                    </Link>
                    <span className="font-mono text-xs text-muted-foreground">{journal.abbr}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    <span className="sr-only">{t('publisher')}: </span>
                    {journal.publisher}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <Link
                      to={libraryTo}
                      className="inline-flex items-center gap-1 font-medium text-brand transition-transform hover:translate-x-0.5"
                    >
                      {t('openInLibrary', { name: journal.abbr })}
                      <ArrowRight className="size-3.5" />
                    </Link>
                    <a
                      href={journal.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {t('homepage')}
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  </div>
                </div>
                <p className="text-sm tabular-nums text-muted-foreground sm:text-right">
                  {loading && count == null
                    ? <Skeleton className="inline-block h-4 w-24" />
                    : count == null
                      ? t('countUnknown')
                      : t('countLabel', { count: Number(count).toLocaleString() })}
                </p>
              </li>
            );
          })}
        </ol>

        <p className="mt-10">
          <Link
            to="/library"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
          >
            {t('browseLibrary')} <ArrowRight className="size-3.5" />
          </Link>
        </p>
      </main>
    </div>
  );
}
