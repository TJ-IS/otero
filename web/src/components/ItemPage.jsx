import { memo, useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogTitle,
} from '@/components/ui/dialog';
import {
  ArrowLeft, BookOpen, ExternalLink, Copy, Check, FileText, AlertCircle,
  Image as ImageIcon, Table2, Sigma, BarChart3, Quote, List, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/async-states';
import { toast } from 'sonner';
import DOMPurify from 'dompurify';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { usePageMeta } from '@/hooks/usePageMeta';
import { ITEM_TYPE_LABELS, itemTitle, UNFILED, creatorsList, yearOf } from '@/lib/items';
import { scholarlyArticleJsonLd, truncateMeta } from '@/lib/seo';
import { AuthorLinks } from './AuthorLinks';
import { headingId } from '@/lib/fulltext';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';
import { SiteHeader } from './SiteHeader';

const FulltextMarkdown = lazy(() => import('./FulltextMarkdown').then(m => ({ default: m.FulltextMarkdown })));

const POLL_INTERVAL_MS = 3000;
const ACTIVE_STATES = new Set(['submitting', 'pending', 'running', 'converting']);

/** Drop OCR noise from publisher stamp (single letters, JSTOR boilerplate fragments). */
function cleanStampLines(lines = []) {
  const cleaned = lines
    .map(l => String(l).replace(/\s+/g, ' ').trim())
    .filter(l => {
      if (!l || l.length < 12) return false;
      if (/^(mis|j|rc|jstor|mis quarterly|research article)$/i.test(l)) return false;
      if (/collaborating with jstor/i.test(l)) return false;
      if (/^this content downloaded/i.test(l)) return false;
      if (/^all use subject to/i.test(l)) return false;
      return true;
    });
  // Prefer the citation-like line (contains Vol./pp./year); keep at most 2 lines.
  const citation = cleaned.filter(l => /\bVol\.?\s*\d+/i.test(l) || /\bpp\.?\s*\d/i.test(l));
  if (citation.length) return citation.slice(0, 2);
  return cleaned.slice(0, 2);
}

function StateBadge({ state }) {
  const { t } = useTranslation('item');
  const map = {
    idle: 'secondary',
    pending: 'secondary',
    running: 'secondary',
    converting: 'secondary',
    done: 'default',
    failed: 'destructive',
  };
  return <Badge variant={map[state] || 'secondary'}>{t(`fulltextStatus.${state}`, { defaultValue: state })}</Badge>;
}

function Lightbox({ src, alt, open, onOpenChange }) {
  const { t } = useTranslation('item');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] max-h-[92vh] p-2 overflow-hidden flex flex-col items-center justify-center">
        <DialogTitle className="sr-only">{alt || t('page.preview')}</DialogTitle>
        <img src={src} alt={alt || ''} className="max-h-[85vh] max-w-full rounded-sm object-contain" />
        {alt && <p className="mt-2 text-xs text-muted-foreground text-center px-4">{alt}</p>}
      </DialogContent>
    </Dialog>
  );
}

function AssetCard({ imgUrl, caption, pageIdx, onPreview, children }) {
  const { t } = useTranslation('item');
  return (
    <figure className="flex flex-col overflow-hidden rounded-sm border bg-background">
      {imgUrl ? (
        <button
          type="button"
          className="block w-full bg-muted/40 hover:bg-muted/60 transition-colors cursor-zoom-in"
          onClick={() => onPreview?.(imgUrl, caption)}
        >
          <img
            src={imgUrl}
            alt={caption || ''}
            loading="lazy"
            className="w-full max-h-56 object-contain mx-auto"
          />
        </button>
      ) : null}
      {children}
      <figcaption className="px-3 py-2 text-xs text-muted-foreground border-t space-y-0.5">
        {caption ? <p className="text-foreground/90 leading-snug">{caption}</p> : null}
        <p className="opacity-70">{t('fulltext.pageN', { n: pageIdx + 1 })}</p>
      </figcaption>
    </figure>
  );
}

function SafeExtractedTable({ html }) {
  const safeHtml = useMemo(() => DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col', 'br', 'span', 'strong', 'em', 'sup', 'sub'],
    ALLOWED_ATTR: ['colspan', 'rowspan', 'scope'],
  }), [html]);

  return <div className="text-xs overflow-x-auto p-3 border-b fulltext-prose" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}

function MetaRow({ label, children }) {
  if (children == null || children === '') return null;
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export const ItemPage = memo(function ItemPage() {
  const { t } = useTranslation(['item', 'common']);
  const { key } = useParams();
  const [copied, setCopied] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const [assetTab, setAssetTab] = useState('figures');
  const [lightbox, setLightbox] = useState({ open: false, src: '', alt: '' });
  const readerScrollRef = useRef(null);

  const { data: item, error: itemError, loading: itemLoading } = useAsync((signal) => api.getItem(key, { signal }), [key]);
  const { data: attachments } = useAsync((signal) => api.getItemAttachments(key, { signal }), [key]);
  const { data: fulltext, loading: fulltextLoading, refresh: refreshFulltext } = useAsync((signal) => api.getFulltext(key, { signal }), [key]);
  const { data: structure, loading: structureLoading } = useAsync((signal) => api.getFulltextStructure(key, { signal }), [key]);

  const seoTitle = item
    ? t('common:seo.itemTitle', { title: itemTitle(item) })
    : t('common:seo.siteTitle');
  const seoDescription = item
    ? truncateMeta(
      item.fields?.abstractNote
        || [creatorsList(item.creators), item.fields?.publicationTitle, yearOf(item.fields?.date)]
          .filter(Boolean)
          .join(' · ')
        || itemTitle(item),
    )
    : t('common:seo.siteDescription');
  usePageMeta({
    title: seoTitle,
    description: seoDescription,
    canonicalPath: key ? `/items/${key}` : '/',
    robots: !itemLoading && (itemError || !item) ? 'noindex, follow' : 'index, follow',
    ogType: 'article',
    jsonLd: item ? scholarlyArticleJsonLd(item) : null,
  });

  const state = fulltext?.state || (fulltextLoading ? 'loading' : 'idle');
  const isActive = ACTIVE_STATES.has(state);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(refreshFulltext, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isActive, refreshFulltext]);

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      toast.success(t('page.linkCopied'));
      setTimeout(() => setCopied(false), 1500);
    });
  }, [t]);

  const scrollToHeading = useCallback((text) => {
    const id = headingId(text);
    const el = document.getElementById(id);
    const container = readerScrollRef.current;
    if (!el || !container) return;

    const top = el.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);

  const openPreview = useCallback((src, alt) => {
    setLightbox({ open: true, src, alt: alt || '' });
  }, []);

  const pdfKey = useMemo(() => {
    return (attachments || []).find(a => (a.contentType || '').includes('pdf'))?.key;
  }, [attachments]);

  const stampLines = useMemo(
    () => cleanStampLines(structure?.publisherStamp?.lines),
    [structure?.publisherStamp?.lines],
  );

  const figures = structure?.figures || [];
  const tables = structure?.tables || [];
  const equations = structure?.equations || [];
  const charts = structure?.charts || [];
  const references = structure?.references || [];
  const footnotes = structure?.footnotes || [];
  const outline = structure?.outline || [];

  const assetTabs = useMemo(() => {
    const tabs = [];
    if (figures.length) tabs.push({ id: 'figures', label: t('page.figures'), count: figures.length, icon: ImageIcon });
    if (charts.length) tabs.push({ id: 'charts', label: 'Chart', count: charts.length, icon: BarChart3 });
    if (tables.length) tabs.push({ id: 'tables', label: t('page.tables'), count: tables.length, icon: Table2 });
    if (equations.length) tabs.push({ id: 'equations', label: t('page.equations'), count: equations.length, icon: Sigma });
    if (references.length) tabs.push({ id: 'references', label: t('page.references'), count: references.length, icon: Quote });
    if (footnotes.length) tabs.push({ id: 'footnotes', label: t('page.footnotes'), count: footnotes.length, icon: List });
    return tabs;
  }, [figures, charts, tables, equations, references, footnotes, t]);

  useEffect(() => {
    if (assetTabs.length && !assetTabs.some(tab => tab.id === assetTab)) {
      setAssetTab(assetTabs[0].id);
    }
  }, [assetTabs, assetTab]);

  if (itemLoading) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-page px-4 py-8 sm:px-6 lg:px-8">
          <LoadingSkeleton variant="lines" />
        </main>
      </div>
    );
  }

  if (itemError) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <SiteHeader />
        <main id="main-content" tabIndex={-1}>
          <ErrorState
            message={t('common:loadFailed', { message: itemError.message })}
            action={(
              <Button variant="outline" size="sm" asChild>
                <Link to="/library">
                  <ArrowLeft className="size-4" />
                  {t('common:backToLibrary')}
                </Link>
              </Button>
            )}
          />
        </main>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background">
        <SiteHeader />
        <main id="main-content" tabIndex={-1}>
          <EmptyState
            icon={FileText}
            title={t('page.notFound')}
            action={(
              <Button variant="outline" size="sm" asChild>
                <Link to="/library">{t('common:backToLibrary')}</Link>
              </Button>
            )}
          />
        </main>
      </div>
    );
  }

  const title = itemTitle(item);
  const typeLabel = ITEM_TYPE_LABELS[item.itemType] || item.itemType;
  const authors = item.creators || [];
  const doi = item.fields?.DOI || structure?.publisherStamp?.doi || '';
  const url = item.fields?.url;
  const f = item.fields || {};

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-background">
      {/* Reader controls live in the single global header — never a second bar. */}
      <SiteHeader
        className="shrink-0"
        actions={(
          <>
            <Button
              variant="ghost"
              size="icon"
              className="hidden shrink-0 md:inline-flex"
              onClick={() => setTocOpen(v => !v)}
              title={tocOpen ? t('page.hideToc') : t('page.showToc')}
            >
              {tocOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
            </Button>
            {pdfKey && (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/attachments/${pdfKey}/file`} target="_blank" rel="noreferrer">
                  <BookOpen className="size-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">PDF</span>
                </a>
              </Button>
            )}
            {doi && (
              <Button size="sm" variant="outline" className="hidden sm:inline-flex" asChild title={`DOI: ${doi}`}>
                <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={copyLink} title={t('page.copyLink')}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </>
        )}
      />

      <div className="mx-auto flex min-h-0 w-full max-w-page flex-1 px-4 sm:px-6 lg:px-8">
        {/* Collapsible TOC */}
        <aside
          className={cn(
            'hidden md:flex md:h-full flex-col border-r border-border/80 bg-muted/10 shrink-0 overflow-hidden motion-toc',
            tocOpen ? 'w-56 xl:w-64' : 'w-0 border-r-0',
          )}
        >
          <div className="flex h-full w-56 xl:w-64 shrink-0 flex-col">
            <div className="shrink-0 border-b border-border/80 px-3 py-3 font-display text-sm font-semibold">{t('page.toc')}</div>
            <ScrollArea className="flex-1">
              <nav className="p-2 space-y-0.5">
                {structureLoading ? (
                  <LoadingSkeleton variant="list" className="px-2 py-3" />
                ) : outline.length > 0 ? outline.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => scrollToHeading(o.text)}
                    className="w-full border-l-2 border-transparent px-2 py-1.5 text-left text-[12px] leading-snug text-foreground/80 hover:border-brand hover:text-brand"
                    style={{ paddingLeft: `${0.5 + Math.min(o.level - 1, 3) * 0.65}rem` }}
                    title={o.text}
                  >
                    <span className="line-clamp-3">{o.text}</span>
                  </button>
                )) : (
                  <EmptyState className="px-2 py-6" title={t('page.tocEmpty')} />
                )}
              </nav>
            </ScrollArea>
          </div>
        </aside>

        {/* Reading column */}
        <main
          id="main-content"
          tabIndex={-1}
          ref={readerScrollRef}
          data-reader-scroll
          className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain"
        >
          <div className="mx-auto w-full min-w-0 max-w-measure space-y-9 px-6 py-7 sm:py-10">
            <header className="space-y-3 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[11px] font-normal">{typeLabel}</Badge>
                {state !== 'loading' && <StateBadge state={state} />}
                {structure?.pageCount > 0 && (
                  <span className="text-xs text-muted-foreground">{t('fulltext.pagesShort', { count: structure.pageCount })}</span>
                )}
              </div>
              <h1 className="font-display text-2xl font-semibold leading-tight text-balance sm:text-3xl">
                {title}
              </h1>
              {authors.length > 0 && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  <AuthorLinks creators={authors} />
                </p>
              )}
            </header>

            {/* Bibliographic metadata — dense but readable */}
            <section className="space-y-2.5 border-y border-border/80 py-5">
              <MetaRow label={t('field.publicationTitle')}>
                {f.publicationTitle === UNFILED && stampLines[0]
                  ? (
                    <span>
                      <span className="text-muted-foreground">{t('common:unfiled')}</span>
                      <span className="mx-1.5 text-muted-foreground/50">·</span>
                      <span title={t('detail.stampFromMineru')}>{stampLines[0]}</span>
                    </span>
                  )
                  : f.publicationTitle === UNFILED
                    ? t('common:unfiled')
                    : f.publicationTitle}
              </MetaRow>
              <MetaRow label={t('detail.volumeIssuePages')}>
                {[
                  f.volume && `Vol. ${f.volume}`,
                  f.issue && `No. ${f.issue}`,
                  f.pages && `pp. ${f.pages}`,
                ].filter(Boolean).join(' · ') || null}
              </MetaRow>
              <MetaRow label={t('field.date')}>{f.date}</MetaRow>
              <MetaRow label={t('field.DOI')}>
                {doi ? (
                  <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all">
                    {doi}
                  </a>
                ) : null}
              </MetaRow>
              <MetaRow label={t('field.url')}>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all inline-flex items-center gap-1">
                    {url} <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : null}
              </MetaRow>
              <MetaRow label={t('field.ISSN')}>{f.ISSN}</MetaRow>
              <MetaRow label={t('field.language')}>{f.language}</MetaRow>
              {stampLines.length > 0 && f.publicationTitle !== UNFILED && (
                <MetaRow label={t('detail.stamp')}>
                  <ul className="space-y-1 text-muted-foreground">
                    {stampLines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </MetaRow>
              )}
            </section>

            {f.abstractNote && (
              <section>
                <h2 className="mb-3 font-display text-lg font-semibold">{t('detail.abstract')}</h2>
                <p className="whitespace-pre-wrap font-serif text-[15px] leading-7 text-foreground/90">{f.abstractNote}</p>
              </section>
            )}

            {/* MinerU assets — tabbed gallery in main flow */}
            {structureLoading && (
              <LoadingSkeleton variant="chart" label={t('page.loadingStructure')} />
            )}

            {!structureLoading && assetTabs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold">
                    {t('page.assets')}
                  </h2>
                  <span className="text-[11px] text-muted-foreground">
                    {[
                      figures.length && t('page.nFigures', { count: figures.length }),
                      tables.length && t('page.nTables', { count: tables.length }),
                      equations.length && t('page.nEquations', { count: equations.length }),
                      references.length && t('page.nReferences', { count: references.length }),
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Tabs value={assetTab} onValueChange={setAssetTab}>
                  <TabsList className="h-auto w-full flex-wrap justify-start gap-5 rounded-none border-b border-border bg-transparent p-0">
                    {assetTabs.map(tab => (
                      <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5 rounded-none border-b-2 border-transparent px-0 py-2 text-xs shadow-none data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-brand data-[state=active]:shadow-none">
                        <tab.icon className="size-3.5" />
                        {tab.label}
                        <span className="opacity-60">{tab.count}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value="figures" className="mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {figures.map(fig => (
                        <AssetCard
                          key={fig.id}
                          imgUrl={fig.imgUrl}
                          caption={fig.caption}
                          pageIdx={fig.pageIdx}
                          onPreview={openPreview}
                        />
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="charts" className="mt-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {charts.map(c => (
                        <AssetCard
                          key={c.id}
                          imgUrl={c.imgUrl}
                          caption={c.caption}
                          pageIdx={c.pageIdx}
                          onPreview={openPreview}
                        />
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="tables" className="mt-3 space-y-3">
                    {tables.map(tbl => (
                      <AssetCard
                        key={tbl.id}
                        imgUrl={tbl.imgUrl}
                        caption={tbl.caption}
                        pageIdx={tbl.pageIdx}
                        onPreview={openPreview}
                      >
                        {tbl.html && <SafeExtractedTable html={tbl.html} />}
                      </AssetCard>
                    ))}
                  </TabsContent>

                  <TabsContent value="equations" className="mt-3">
                    <div className="grid grid-cols-1 gap-2">
                      {equations.map(e => (
                        <AssetCard
                          key={e.id}
                          imgUrl={e.imgUrl}
                          caption={e.text}
                          pageIdx={e.pageIdx}
                          onPreview={openPreview}
                        >
                          {!e.imgUrl && e.text && (
                            <pre className="px-3 py-2 text-xs whitespace-pre-wrap font-mono overflow-x-auto">{e.text}</pre>
                          )}
                        </AssetCard>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="references" className="mt-3">
                    <ol className="text-sm space-y-2 list-decimal pl-5 marker:text-muted-foreground">
                      {references.map(r => (
                        <li key={r.id} id={`ref-${r.id}`} className="leading-relaxed pl-1 scroll-mt-16 rounded-sm transition-colors">
                          <span className="text-foreground/90">{r.text}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">p.{r.pageIdx + 1}</span>
                        </li>
                      ))}
                    </ol>
                  </TabsContent>

                  <TabsContent value="footnotes" className="mt-3">
                    <ul className="text-sm space-y-2 list-disc pl-5 marker:text-muted-foreground">
                      {footnotes.map(n => (
                        <li key={n.id} className="leading-relaxed pl-1">
                          <span className="text-foreground/90">{n.text}</span>
                          <span className="ml-1.5 text-xs text-muted-foreground">p.{n.pageIdx + 1}</span>
                        </li>
                      ))}
                    </ul>
                  </TabsContent>
                </Tabs>
              </section>
            )}

            <Separator />

            {/* Full text */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <FileText className="size-3.5" /> {t('detail.tabFulltext')}
                </h2>
                {isActive && fulltext?.totalPages && (
                  <span className="text-xs text-muted-foreground">
                    {t('fulltext.pages', { extracted: fulltext.extractedPages ?? 0, total: fulltext.totalPages })}
                  </span>
                )}
              </div>

              {(fulltextLoading || state === 'loading') && (
                <LoadingSkeleton variant="chart" className="rounded-sm border border-border/80 px-6 py-8" label={t('fulltext.loadingMd')} />
              )}

              {!fulltextLoading && state === 'idle' && (
                <EmptyState
                  className="rounded-sm border border-dashed border-border/80"
                  icon={FileText}
                  title={t('fulltext.notParsed')}
                  description={t('fulltext.notParsedHint')}
                />
              )}

              {!fulltextLoading && isActive && (
                <EmptyState
                  className="rounded-sm border border-border/80"
                  title={`${t(`fulltextStatus.${state}`)}…`}
                  description={t('fulltext.autoRefreshShort')}
                />
              )}

              {!fulltextLoading && state === 'failed' && (
                <div className="rounded-sm border px-6 py-10 text-center text-sm text-destructive">
                  <AlertCircle className="size-7 mx-auto mb-2" />
                  <p>{t('fulltext.parseFailed')}</p>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">{fulltext?.errMsg || t('common:unknownError')}</p>
                </div>
              )}

              {!fulltextLoading && state === 'done' && fulltext?.markdown && (
                <Suspense fallback={<div className="text-sm text-muted-foreground py-6">{t('fulltext.loadingRenderer')}</div>}>
                  <FulltextMarkdown
                    markdown={fulltext.markdown}
                    imagesBaseUrl={fulltext.imagesBaseUrl}
                    references={references}
                  />
                </Suspense>
              )}

              {!fulltextLoading && state === 'done' && !fulltext?.markdown && (
                <div className="rounded-sm border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  {t('fulltext.mdMissing')}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      <Lightbox
        src={lightbox.src}
        alt={lightbox.alt}
        open={lightbox.open}
        onOpenChange={(open) => setLightbox(s => ({ ...s, open }))}
      />

      <ChatPanel itemKey={key} />
    </div>
  );
});
