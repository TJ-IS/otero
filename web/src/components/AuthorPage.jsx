import { memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, FileText, BookOpen,
  GraduationCap, BookMarked, Presentation, File,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { usePageMeta } from '@/hooks/usePageMeta';
import { ITEM_TYPE_LABELS, itemTitle, yearOf, volumeIssuePages } from '@/lib/items';
import { personJsonLd } from '@/lib/seo';
import { AuthorLinks } from './AuthorLinks';
import { SiteHeader } from './SiteHeader';
import { PageHeader } from './PageHeader';

const TYPE_ICONS = {
  journalArticle: <FileText className="size-3.5 shrink-0" />,
  preprint: <File className="size-3.5 shrink-0" />,
  book: <BookOpen className="size-3.5 shrink-0" />,
  bookSection: <BookMarked className="size-3.5 shrink-0" />,
  conferencePaper: <Presentation className="size-3.5 shrink-0" />,
  thesis: <GraduationCap className="size-3.5 shrink-0" />,
  report: <File className="size-3.5 shrink-0" />,
  document: <FileText className="size-3.5 shrink-0" />,
};

export const AuthorPage = memo(function AuthorPage() {
  const { id } = useParams();
  const { t } = useTranslation(['item', 'common']);

  const { data, error, loading } = useAsync((signal) => api.getAuthor(id, { signal }), [id]);

  usePageMeta({
    title: data?.name
      ? t('common:seo.authorTitle', { name: data.name })
      : t('common:seo.siteTitle'),
    description: data?.name
      ? t('common:seo.authorDescription', { name: data.name, count: data.items?.length || 0 })
      : t('common:seo.siteDescription'),
    canonicalPath: id ? `/authors/${id}` : '/',
    robots: !loading && (error || !data) ? 'noindex, follow' : 'index, follow',
    ogType: 'profile',
    jsonLd: data ? personJsonLd(data) : null,
  });

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <SiteHeader />

      <main id="main-content" tabIndex={-1} className="flex-1">
        <div className="mx-auto w-full max-w-page px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {loading && (
            <LoadingSkeleton variant="lines" className="py-8" />
          )}

          {error && (
            <ErrorState
              message={t('common:loadFailed', { message: error.message })}
              action={(
                <Button variant="outline" size="sm" asChild>
                  <Link to="/dashboard/authors">
                    <ArrowLeft className="size-4" />
                    {t('page.backToGraph')}
                  </Link>
                </Button>
              )}
            />
          )}

          {data && (
            <>
              <PageHeader
                className="mb-6"
                eyebrow={t('page.author')}
                title={data.name}
                description={t('page.totalPapers', { count: data.items.length })}
                actions={(
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/dashboard/authors">
                      <ArrowLeft className="size-4" />
                      {t('page.backToGraph')}
                    </Link>
                  </Button>
                )}
              />

              {data.items.length === 0 ? (
                <EmptyState
                  className="rounded-sm border border-dashed border-border/80"
                  icon={FileText}
                  title={t('page.noPapers')}
                />
              ) : (
                <ul className="divide-y border border-border/80">
                  {data.items.map((it) => (
                    <li key={it.key} className="px-4 py-3 transition-colors hover:bg-accent/40">
                      <div className="text-sm font-medium leading-snug">
                        <Link
                          to={`/items/${it.key}`}
                          className="text-left text-foreground transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {itemTitle(it)}
                        </Link>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        <AuthorLinks creators={it.creators} />
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">{yearOf(it.fields?.date) || '—'}</span>
                        {(it.fields?.publicationTitle || it.fields?.proceedingsTitle) && (
                          <span className="truncate">
                            {it.fields.publicationTitle || it.fields.proceedingsTitle}
                          </span>
                        )}
                        <span className="tabular-nums">{volumeIssuePages(it.fields) || ''}</span>
                        <Badge variant="secondary" className="inline-flex items-center gap-1 font-normal">
                          {TYPE_ICONS[it.itemType]}
                          {ITEM_TYPE_LABELS[it.itemType] || it.itemType}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
});
