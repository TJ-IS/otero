import { memo, useCallback, useEffect, useMemo, useState, Suspense, lazy } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
  ArrowLeft, BookOpen, ExternalLink, Copy, Check, FileText, Loader2, AlertCircle,
  Image as ImageIcon, Table2, Sigma, BarChart3, Quote, List, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAsync } from '@/hooks/useAsync';
import { ITEM_TYPE_LABELS, itemTitle, creatorsList } from '@/lib/items';
import { headingId } from '@/lib/fulltext';
import { cn } from '@/lib/utils';

const FulltextMarkdown = lazy(() => import('./FulltextMarkdown').then(m => ({ default: m.FulltextMarkdown })));

const POLL_INTERVAL_MS = 3000;
const ACTIVE_STATES = new Set(['submitting', 'pending', 'running', 'converting']);

const STATE_LABELS = {
  idle: '未解析',
  submitting: '待提交',
  pending: '排队中',
  running: '解析中',
  converting: '格式转换中',
  done: '已完成',
  failed: '解析失败',
};

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
  const map = {
    idle: 'secondary',
    pending: 'secondary',
    running: 'secondary',
    converting: 'secondary',
    done: 'default',
    failed: 'destructive',
  };
  return <Badge variant={map[state] || 'secondary'}>{STATE_LABELS[state] || state}</Badge>;
}

function Lightbox({ src, alt, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] max-h-[92vh] p-2 overflow-hidden flex flex-col items-center justify-center">
        <DialogTitle className="sr-only">{alt || '预览'}</DialogTitle>
        <img src={src} alt={alt || ''} className="max-w-full max-h-[85vh] object-contain rounded" />
        {alt && <p className="mt-2 text-xs text-muted-foreground text-center px-4">{alt}</p>}
      </DialogContent>
    </Dialog>
  );
}

function AssetCard({ imgUrl, caption, pageIdx, onPreview, children }) {
  return (
    <figure className="border rounded-lg overflow-hidden bg-background flex flex-col">
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
        <p className="opacity-70">第 {pageIdx + 1} 页</p>
      </figcaption>
    </figure>
  );
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
  const { key } = useParams();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [tocOpen, setTocOpen] = useState(true);
  const [assetTab, setAssetTab] = useState('figures');
  const [lightbox, setLightbox] = useState({ open: false, src: '', alt: '' });

  const { data: item, error: itemError, loading: itemLoading } = useAsync(() => api.getItem(key), [key]);
  const { data: attachments } = useAsync(() => api.getItemAttachments(key), [key]);
  const { data: fulltext, loading: fulltextLoading, refresh: refreshFulltext } = useAsync(() => api.getFulltext(key), [key]);
  const { data: structure, loading: structureLoading } = useAsync(() => api.getFulltextStructure(key), [key]);

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
      toast.success('已复制链接');
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const scrollToHeading = useCallback((text) => {
    const id = headingId(text);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (figures.length) tabs.push({ id: 'figures', label: '图', count: figures.length, icon: ImageIcon });
    if (charts.length) tabs.push({ id: 'charts', label: 'Chart', count: charts.length, icon: BarChart3 });
    if (tables.length) tabs.push({ id: 'tables', label: '表', count: tables.length, icon: Table2 });
    if (equations.length) tabs.push({ id: 'equations', label: '公式', count: equations.length, icon: Sigma });
    if (references.length) tabs.push({ id: 'references', label: '文献', count: references.length, icon: Quote });
    if (footnotes.length) tabs.push({ id: 'footnotes', label: '脚注', count: footnotes.length, icon: List });
    return tabs;
  }, [figures, charts, tables, equations, references, footnotes]);

  useEffect(() => {
    if (assetTabs.length && !assetTabs.some(t => t.id === assetTab)) {
      setAssetTab(assetTabs[0].id);
    }
  }, [assetTabs, assetTab]);

  if (itemLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" /> 加载中…
      </div>
    );
  }

  if (itemError) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-sm text-destructive">
        <AlertCircle className="size-8" />
        <p>加载失败: {itemError.message}</p>
        <Button variant="outline" size="sm" asChild>
          <a href="/">
            <ArrowLeft className="size-4 mr-1" /> 返回文库
          </a>
        </Button>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <FileText className="size-8 opacity-40" />
        <p>条目不存在</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/">返回文库</Link>
        </Button>
      </div>
    );
  }

  const title = itemTitle(item);
  const typeLabel = ITEM_TYPE_LABELS[item.itemType] || item.itemType;
  const authors = creatorsList(item.creators);
  const doi = item.fields?.DOI || structure?.publisherStamp?.doi || '';
  const url = item.fields?.url;
  const f = item.fields || {};

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Compact toolbar — no truncated title */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2 px-3 sm:px-4 h-12">
          <Button variant="ghost" size="icon" className="shrink-0" asChild title="返回文库">
            <a href="/">
              <ArrowLeft className="size-4" />
              <span className="sr-only">返回文库</span>
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 hidden md:inline-flex"
            onClick={() => setTocOpen(v => !v)}
            title={tocOpen ? '隐藏目录' : '显示目录'}
          >
            {tocOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
          </Button>
          <Badge variant="outline" className="shrink-0 text-[11px] font-normal">{typeLabel}</Badge>
          {state !== 'loading' && <StateBadge state={state} />}
          {structure?.pageCount > 0 && (
            <span className="hidden sm:inline text-xs text-muted-foreground">{structure.pageCount} 页</span>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 shrink-0">
            {pdfKey && (
              <Button size="sm" variant="outline" asChild>
                <a href={`/api/attachments/${pdfKey}/file`} target="_blank" rel="noreferrer">
                  <BookOpen className="size-3.5 sm:mr-1" />
                  <span className="hidden sm:inline">PDF</span>
                </a>
              </Button>
            )}
            {doi && (
              <Button size="sm" variant="outline" asChild title={`DOI: ${doi}`}>
                <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={copyLink} title="复制本页链接">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Collapsible TOC */}
        <aside
          className={cn(
            'hidden md:flex flex-col border-r bg-muted/15 shrink-0 transition-[width] duration-200',
            tocOpen ? 'w-56 xl:w-64' : 'w-0 border-r-0 overflow-hidden',
          )}
        >
          <div className="px-3 py-2.5 text-xs font-medium text-muted-foreground border-b shrink-0">目录</div>
          <ScrollArea className="flex-1">
            <nav className="p-2 space-y-0.5">
              {structureLoading ? (
                <p className="text-xs text-muted-foreground px-2 py-3 flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> 加载中…
                </p>
              ) : outline.length > 0 ? outline.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => scrollToHeading(o.text)}
                  className="w-full text-left text-[12px] leading-snug hover:bg-accent/70 rounded-md px-2 py-1.5 text-foreground/85"
                  style={{ paddingLeft: `${0.5 + Math.min(o.level - 1, 3) * 0.65}rem` }}
                  title={o.text}
                >
                  <span className="line-clamp-3">{o.text}</span>
                </button>
              )) : (
                <p className="text-xs text-muted-foreground px-2 py-3">暂无目录（需先完成全文解析）</p>
              )}
            </nav>
          </ScrollArea>
        </aside>

        {/* Reading column */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-6 sm:py-8 space-y-8">
            {/* Title block — full, no truncation */}
            <header className="space-y-3">
              <h1 className="text-xl sm:text-2xl font-semibold tracking-tight leading-snug text-balance">
                {title}
              </h1>
              {authors && (
                <p className="text-sm text-muted-foreground leading-relaxed">{authors}</p>
              )}
            </header>

            {/* Bibliographic metadata — dense but readable */}
            <section className="space-y-2.5 border-y py-4">
              <MetaRow label="期刊">
                {f.publicationTitle === '待归档' && stampLines[0]
                  ? (
                    <span>
                      <span className="text-muted-foreground">待归档</span>
                      <span className="mx-1.5 text-muted-foreground/50">·</span>
                      <span title="来自 MinerU 印记">{stampLines[0]}</span>
                    </span>
                  )
                  : f.publicationTitle}
              </MetaRow>
              <MetaRow label="卷 / 期 / 页">
                {[
                  f.volume && `Vol. ${f.volume}`,
                  f.issue && `No. ${f.issue}`,
                  f.pages && `pp. ${f.pages}`,
                ].filter(Boolean).join(' · ') || null}
              </MetaRow>
              <MetaRow label="日期">{f.date}</MetaRow>
              <MetaRow label="DOI">
                {doi ? (
                  <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">
                    {doi}
                  </a>
                ) : null}
              </MetaRow>
              <MetaRow label="URL">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all inline-flex items-center gap-1">
                    {url} <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : null}
              </MetaRow>
              <MetaRow label="ISSN">{f.ISSN}</MetaRow>
              <MetaRow label="语言">{f.language}</MetaRow>
              {stampLines.length > 0 && f.publicationTitle !== '待归档' && (
                <MetaRow label="印记">
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
                <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">摘要</h2>
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{f.abstractNote}</p>
              </section>
            )}

            {/* MinerU assets — tabbed gallery in main flow */}
            {structureLoading && (
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> 加载 MinerU 结构…
              </div>
            )}

            {!structureLoading && assetTabs.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    MinerU 提取资产
                  </h2>
                  <span className="text-[11px] text-muted-foreground">
                    {[
                      figures.length && `${figures.length} 图`,
                      tables.length && `${tables.length} 表`,
                      equations.length && `${equations.length} 公式`,
                      references.length && `${references.length} 文献`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <Tabs value={assetTab} onValueChange={setAssetTab}>
                  <TabsList className="h-auto flex-wrap justify-start gap-1">
                    {assetTabs.map(t => (
                      <TabsTrigger key={t.id} value={t.id} className="text-xs gap-1.5">
                        <t.icon className="size-3.5" />
                        {t.label}
                        <span className="opacity-60">{t.count}</span>
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
                    {tables.map(t => (
                      <AssetCard
                        key={t.id}
                        imgUrl={t.imgUrl}
                        caption={t.caption}
                        pageIdx={t.pageIdx}
                        onPreview={openPreview}
                      >
                        {t.html && (
                          <div
                            className="text-xs overflow-x-auto p-3 border-b fulltext-prose"
                            dangerouslySetInnerHTML={{ __html: t.html }}
                          />
                        )}
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
                        <li key={r.id} className="leading-relaxed pl-1">
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
                  <FileText className="size-3.5" /> 全文
                </h2>
                {isActive && fulltext?.totalPages && (
                  <span className="text-xs text-muted-foreground">
                    {fulltext.extractedPages ?? 0} / {fulltext.totalPages} 页
                  </span>
                )}
              </div>

              {(fulltextLoading || state === 'loading') && (
                <div className="rounded-lg border px-6 py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-7 animate-spin mx-auto mb-2 opacity-60" />
                  <p>加载全文…</p>
                </div>
              )}

              {!fulltextLoading && state === 'idle' && (
                <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  <FileText className="size-7 opacity-40 mx-auto mb-2" />
                  <p>PDF 尚未解析为全文。</p>
                  <p className="text-xs mt-1">在文库浮窗中点击「解析全文」后即可在此阅读。</p>
                </div>
              )}

              {!fulltextLoading && isActive && (
                <div className="rounded-lg border px-6 py-10 text-center text-sm text-muted-foreground">
                  <Loader2 className="size-7 animate-spin mx-auto mb-2 opacity-60" />
                  <p>{STATE_LABELS[state]}…</p>
                  <p className="text-xs mt-1">页面会自动刷新。</p>
                </div>
              )}

              {!fulltextLoading && state === 'failed' && (
                <div className="rounded-lg border px-6 py-10 text-center text-sm text-destructive">
                  <AlertCircle className="size-7 mx-auto mb-2" />
                  <p>解析失败</p>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1">{fulltext?.errMsg || '未知错误'}</p>
                </div>
              )}

              {!fulltextLoading && state === 'done' && fulltext?.markdown && (
                <Suspense fallback={<div className="text-sm text-muted-foreground py-6">加载渲染器…</div>}>
                  <FulltextMarkdown
                    markdown={fulltext.markdown}
                    imagesBaseUrl={fulltext.imagesBaseUrl}
                  />
                </Suspense>
              )}

              {!fulltextLoading && state === 'done' && !fulltext?.markdown && (
                <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                  已解析，但未找到 Markdown 文件。
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
    </div>
  );
});
