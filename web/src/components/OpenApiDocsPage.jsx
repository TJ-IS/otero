import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePageMeta } from '@/hooks/usePageMeta';
import { webApiJsonLd } from '@/lib/seo';
import { PageHeader } from '@/components/PageHeader';

const ENDPOINTS = [
  {
    id: 'journals',
    endpointKey: 'journals',
    method: 'GET',
    path: '/api/open/v1/journals',
    curl: 'curl "$BASE/api/open/v1/journals"',
  },
  {
    id: 'articles',
    endpointKey: 'articles',
    method: 'GET',
    path: '/api/open/v1/articles',
    query: 'q, page, pageSize, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/articles?q=blockchain&yearFrom=2018&yearTo=2022&page=1&pageSize=20"',
  },
  {
    id: 'articles-export',
    endpointKey: 'exportArticles',
    method: 'GET',
    path: '/api/open/v1/articles/export',
    query: 'format=bibtex|ris, q, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl -OJ "$BASE/api/open/v1/articles/export?q=platform&format=bibtex"',
  },
  {
    id: 'facets',
    endpointKey: 'facets',
    method: 'GET',
    path: '/api/open/v1/facets',
    query: 'q, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/facets?q=platform&yearFrom=2020"',
  },
  {
    id: 'authors',
    endpointKey: 'authors',
    method: 'GET',
    path: '/api/open/v1/authors',
    query: 'q (required), page, pageSize, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/authors?q=Smith&page=1&pageSize=20"',
  },
  {
    id: 'author-items',
    endpointKey: 'authorItems',
    method: 'GET',
    path: '/api/open/v1/authors/:id/items',
    query: 'page, pageSize, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/authors/42/items?page=1&pageSize=20"',
  },
  {
    id: 'search',
    endpointKey: 'search',
    method: 'GET',
    path: '/api/open/v1/search',
    query: 'q (required), page, pageSize, + filters',
    curl: 'curl "$BASE/api/open/v1/search?q=platform&page=1&pageSize=10"',
  },
  {
    id: 'by-doi',
    endpointKey: 'doiItem',
    method: 'GET',
    path: '/api/open/v1/items/by-doi',
    query: 'doi',
    curl: 'curl --get "$BASE/api/open/v1/items/by-doi" --data-urlencode "doi=10.1234/example"',
  },
  {
    id: 'by-doi-md',
    endpointKey: 'doiMarkdown',
    method: 'GET',
    path: '/api/open/v1/items/by-doi/markdown',
    query: 'doi',
    curl: 'curl --get "$BASE/api/open/v1/items/by-doi/markdown" --data-urlencode "doi=10.1234/example"',
  },
  {
    id: 'by-doi-pdf',
    endpointKey: 'doiPdf',
    method: 'GET',
    path: '/api/open/v1/items/by-doi/pdf-url',
    query: 'doi',
    curl: 'curl --get "$BASE/api/open/v1/items/by-doi/pdf-url" --data-urlencode "doi=10.1234/example"',
  },
  {
    id: 'by-key',
    endpointKey: 'item',
    method: 'GET',
    path: '/api/open/v1/items/:key',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234"',
  },
  {
    id: 'by-key-md',
    endpointKey: 'itemMarkdown',
    method: 'GET',
    path: '/api/open/v1/items/:key/markdown',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/markdown"',
  },
  {
    id: 'by-key-pdf',
    endpointKey: 'itemPdf',
    method: 'GET',
    path: '/api/open/v1/items/:key/pdf-url',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/pdf-url"',
  },
  {
    id: 'by-key-structure',
    endpointKey: 'itemStructure',
    method: 'GET',
    path: '/api/open/v1/items/:key/structure',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/structure"',
  },
  {
    id: 'by-key-export',
    endpointKey: 'itemExport',
    method: 'GET',
    path: '/api/open/v1/items/:key/export',
    query: 'format=bibtex|ris',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/export?format=ris"',
  },
  {
    id: 'stats-overview',
    endpointKey: 'statsOverview',
    method: 'GET',
    path: '/api/open/v1/stats/overview',
    curl: 'curl "$BASE/api/open/v1/stats/overview"',
  },
  {
    id: 'stats-timeline',
    endpointKey: 'statsTimeline',
    method: 'GET',
    path: '/api/open/v1/stats/timeline',
    query: 'q, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/stats/timeline?journal=MIS%20Quarterly"',
  },
  {
    id: 'skill',
    endpointKey: 'skill',
    method: 'GET',
    path: '/api/open/v1/SKILL.md',
    curl: 'curl "$BASE/api/open/v1/SKILL.md"',
  },
];

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function CodeBlock({ children, className }) {
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-sm border border-border/80 bg-muted/30 px-3 py-2 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all',
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function OpenApiDocsPage() {
  const { t } = useTranslation(['docs', 'common']);
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  usePageMeta({
    title: t('common:seo.docsApiTitle'),
    description: t('common:seo.docsApiDescription'),
    canonicalPath: '/docs/api',
    jsonLd: webApiJsonLd(),
  });

  const filterRows = useMemo(() => [
    { param: 'journal', descKey: 'filterJournal' },
    { param: 'journals', descKey: 'filterJournals' },
    { param: 'year', descKey: 'filterYear' },
    { param: 'yearFrom / yearTo', descKey: 'filterYearRange' },
    { param: 'type', descKey: 'filterType' },
  ], []);

  const handleCopyCurl = async (curl) => {
    const text = curl.replaceAll('$BASE', base);
    try {
      await copyText(text);
      toast.success(t('api.copiedCurl'));
    } catch {
      toast.error(t('api.copyFailed'));
    }
  };

  return (
    <main className="mx-auto w-full max-w-page space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={t('common:nav.openApi')}
        title={t('api.answerHeading')}
        description={t('api.answer')}
      />

      <section className="space-y-3">
        <p className="max-w-measure text-sm leading-relaxed text-muted-foreground">
          {t('api.intro')}
          {' '}
          {t('api.baseUrl')}
        </p>
        <CodeBlock>{`${base}/api/open/v1`}</CodeBlock>
        <ul className="max-w-measure list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('api.ruleWhitelist')}</li>
          <li>{t('api.ruleKey')}</li>
          <li>{t('api.rulePaging')}</li>
          <li>
            {t('api.listResponse')}
            <code className="text-xs">{'{ items, total, page, pageSize, totalPages }'}</code>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">{t('api.filterTitle')}</h2>
        <p className="max-w-measure text-sm text-muted-foreground">
          {t('api.filterApplies')}
        </p>
        <div className="overflow-x-auto border border-border/80">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">{t('api.colParam')}</th>
                <th className="px-3 py-2 font-medium">{t('api.colDesc')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filterRows.map((row) => (
                <tr key={row.param}>
                  <td className="px-3 py-2 font-mono text-xs">{row.param}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t(`api.${row.descKey}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CodeBlock>
          {`${base}/api/open/v1/articles?yearFrom=2018&yearTo=2022&journals=${encodeURIComponent('MIS Quarterly,Information Systems Research')}`}
        </CodeBlock>
      </section>

      <section className="space-y-5">
        <h2 className="text-base font-semibold tracking-tight">{t('api.endpointsTitle')}</h2>
        <div className="divide-y border-y border-border/80">
          {ENDPOINTS.map((ep) => (
          <article key={ep.id} className="space-y-2 py-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                {ep.method}
              </span>
              <code className="text-sm font-mono break-all">{ep.path}</code>
            </div>
            <p className="text-sm text-muted-foreground">{t(`api.endpoints.${ep.endpointKey}`)}</p>
            {ep.query && (
              <p className="text-xs text-muted-foreground">
                {t('api.queryLabel')}<code className="font-mono">{ep.query}</code>
              </p>
            )}
            <div className="flex items-start gap-2">
              <CodeBlock className="flex-1">{ep.curl.replaceAll('$BASE', base)}</CodeBlock>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => handleCopyCurl(ep.curl)}
                title={t('api.copyCurl')}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </article>
          ))}
        </div>
      </section>
    </main>
  );
}
