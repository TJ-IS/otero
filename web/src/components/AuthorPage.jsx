import { memo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Moon, Sun, Loader2, AlertCircle, FileText, BookOpen,
  GraduationCap, BookMarked, Presentation, File, Users,
} from 'lucide-react';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { ITEM_TYPE_LABELS, itemTitle, yearOf, volumeIssuePages } from '@/lib/items';
import { AuthorLinks } from './AuthorLinks';

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
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation(['item', 'common']);

  const { data, error, loading } = useAsync((signal) => api.getAuthor(id, { signal }), [id]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard/authors')}
          title={t('page.backToGraph')}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <span className="truncate text-sm font-medium">{data?.name || t('page.author')}</span>

        {data && (
          <Badge variant="secondary" className="shrink-0 font-normal">
            {t('page.nPapers', { count: data.items.length })}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            title={resolvedTheme === 'dark' ? t('common:themeToLight') : t('common:themeToDark')}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> {t('common:loading')}
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-destructive">
              <AlertCircle className="size-8" />
              <p>{t('common:loadFailed', { message: error.message })}</p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard/authors">
                  <ArrowLeft className="size-4 mr-1" /> {t('page.backToGraph')}
                </Link>
              </Button>
            </div>
          )}

          {data && (
            <>
              <header className="mb-6 flex items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Users className="size-6" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold tracking-tight">{data.name}</h1>
                  <p className="text-sm text-muted-foreground">{t('page.totalPapers', { count: data.items.length })}</p>
                </div>
              </header>

              {data.items.length === 0 ? (
                <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  {t('page.noPapers')}
                </div>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {data.items.map((it) => (
                    <li key={it.key} className="px-4 py-3 transition-colors hover:bg-accent/60">
                      <div className="text-sm font-medium leading-snug">
                        <button type="button" onClick={() => navigate(`/items/${it.key}`)} className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                          {itemTitle(it)}
                        </button>
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
