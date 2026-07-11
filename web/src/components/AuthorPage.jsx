import { memo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
  const { theme, setTheme } = useTheme();

  const { data, error, loading } = useAsync(() => api.getAuthor(id), [id]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/dashboard/authors')}
          title="返回学者关系图"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <span className="truncate text-sm font-medium">{data?.name || '学者'}</span>

        {data && (
          <Badge variant="secondary" className="shrink-0 font-normal">
            {data.items.length} 篇论文
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> 加载中…
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-destructive">
              <AlertCircle className="size-8" />
              <p>加载失败: {error.message}</p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/dashboard/authors">
                  <ArrowLeft className="size-4 mr-1" /> 返回学者关系图
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
                  <p className="text-sm text-muted-foreground">共 {data.items.length} 篇论文</p>
                </div>
              </header>

              {data.items.length === 0 ? (
                <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  暂无收录的论文
                </div>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {data.items.map((it) => (
                    <li
                      key={it.key}
                      onClick={() => navigate(`/items/${it.key}`)}
                      className="cursor-pointer px-4 py-3 transition-colors hover:bg-accent/60"
                    >
                      <div className="text-sm font-medium leading-snug">{itemTitle(it)}</div>
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
