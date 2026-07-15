import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const ENDPOINTS = [
  {
    id: 'journals',
    method: 'GET',
    path: '/api/open/v1/journals',
    summary: '本站 Basket 期刊列表（含 itemCount，不含待归档）',
    curl: 'curl "$BASE/api/open/v1/journals"',
  },
  {
    id: 'articles',
    method: 'GET',
    path: '/api/open/v1/articles',
    summary: '关键词搜文章；q 可选，可纯 filter 浏览',
    query: 'q, page, pageSize, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/articles?q=blockchain&yearFrom=2018&yearTo=2022&page=1&pageSize=20"',
  },
  {
    id: 'articles-export',
    method: 'GET',
    path: '/api/open/v1/articles/export',
    summary: '按文章检索条件批量导出 BibTeX 或 RIS',
    query: 'format=bibtex|ris, q, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl -OJ "$BASE/api/open/v1/articles/export?q=platform&format=bibtex"',
  },
  {
    id: 'facets',
    method: 'GET',
    path: '/api/open/v1/facets',
    summary: '返回当前查询的期刊、年份、类型和资源可用性聚合',
    query: 'q, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/facets?q=platform&yearFrom=2020"',
  },
  {
    id: 'authors',
    method: 'GET',
    path: '/api/open/v1/authors',
    summary: '关键词搜作者；q 必填；filter 收窄发文范围与 paperCount',
    query: 'q (required), page, pageSize, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/authors?q=Smith&page=1&pageSize=20"',
  },
  {
    id: 'author-items',
    method: 'GET',
    path: '/api/open/v1/authors/:id/items',
    summary: '某作者文章分页（可 filter）',
    query: 'page, pageSize, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/authors/42/items?page=1&pageSize=20"',
  },
  {
    id: 'search',
    method: 'GET',
    path: '/api/open/v1/search',
    summary: '统一搜索：同页返回 articles + authors 两桶',
    query: 'q (required), page, pageSize, + filters',
    curl: 'curl "$BASE/api/open/v1/search?q=platform&page=1&pageSize=10"',
  },
  {
    id: 'by-doi',
    method: 'GET',
    path: '/api/open/v1/items/by-doi',
    summary: 'DOI 精确查询条目元数据',
    query: 'doi',
    curl: 'curl --get "$BASE/api/open/v1/items/by-doi" --data-urlencode "doi=10.1234/example"',
  },
  {
    id: 'by-doi-md',
    method: 'GET',
    path: '/api/open/v1/items/by-doi/markdown',
    summary: '按 DOI 获取全文 Markdown（需已解析完成）',
    query: 'doi',
    curl: 'curl --get "$BASE/api/open/v1/items/by-doi/markdown" --data-urlencode "doi=10.1234/example"',
  },
  {
    id: 'by-doi-pdf',
    method: 'GET',
    path: '/api/open/v1/items/by-doi/pdf-url',
    summary: '按 DOI 获取 PDF 下载地址（url / absoluteUrl）',
    query: 'doi',
    curl: 'curl --get "$BASE/api/open/v1/items/by-doi/pdf-url" --data-urlencode "doi=10.1234/example"',
  },
  {
    id: 'by-key',
    method: 'GET',
    path: '/api/open/v1/items/:key',
    summary: '按搜索结果中的 item key 获取完整元数据',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234"',
  },
  {
    id: 'by-key-md',
    method: 'GET',
    path: '/api/open/v1/items/:key/markdown',
    summary: '按 item key 获取已解析的全文 Markdown',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/markdown"',
  },
  {
    id: 'by-key-pdf',
    method: 'GET',
    path: '/api/open/v1/items/:key/pdf-url',
    summary: '按 item key 获取 PDF 相对地址与绝对地址',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/pdf-url"',
  },
  {
    id: 'by-key-structure',
    method: 'GET',
    path: '/api/open/v1/items/:key/structure',
    summary: '获取目录、图表、公式、参考文献和脚注等结构化全文',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/structure"',
  },
  {
    id: 'by-key-export',
    method: 'GET',
    path: '/api/open/v1/items/:key/export',
    summary: '导出单篇 BibTeX 或 RIS',
    query: 'format=bibtex|ris',
    curl: 'curl "$BASE/api/open/v1/items/ABCD1234/export?format=ris"',
  },
  {
    id: 'stats-overview',
    method: 'GET',
    path: '/api/open/v1/stats/overview',
    summary: 'Basket 范围内的文章、作者、DOI、PDF 和全文覆盖概览',
    curl: 'curl "$BASE/api/open/v1/stats/overview"',
  },
  {
    id: 'stats-timeline',
    method: 'GET',
    path: '/api/open/v1/stats/timeline',
    summary: '按出版年份统计文章数，可附带查询和共享筛选条件',
    query: 'q, journal|journals, year, yearFrom, yearTo, type',
    curl: 'curl "$BASE/api/open/v1/stats/timeline?journal=MIS%20Quarterly"',
  },
  {
    id: 'skill',
    method: 'GET',
    path: '/api/open/v1/SKILL.md',
    summary: 'Agent Skill 原文（可直接 curl / 复制安装）',
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
        'overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all',
        className,
      )}
    >
      {children}
    </pre>
  );
}

export function OpenApiDocsPage() {
  const base = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyCurl = async (curl) => {
    const text = curl.replaceAll('$BASE', base);
    try {
      await copyText(text);
      toast.success('已复制 curl');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 space-y-10">
      <section className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Otero 开放只读 API，面向 AIS Senior Scholars&apos; Basket 文献库。
          支持从检索结果继续读取条目、结构化全文和引用导出，也提供聚合与时间线统计。
          所有接口均为 <code className="text-xs">GET</code>，不会修改数据库。
          Base URL：
        </p>
        <CodeBlock>{`${base}/api/open/v1`}</CodeBlock>
        <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
          <li>仅暴露白名单 11 刊内、未删除的顶层条目</li>
          <li>搜索结果中的 <code className="text-xs">key</code> 可直接用于条目、全文和导出接口</li>
          <li>
            分页：<code className="text-xs">page</code>（默认 1）、
            <code className="text-xs">pageSize</code>（默认 20，最大 100）
          </li>
          <li>
            列表响应：
            <code className="text-xs">{'{ items, total, page, pageSize, totalPages }'}</code>
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Filter 参数</h2>
        <p className="text-sm text-muted-foreground">
          适用于 <code className="text-xs">/articles</code>、<code className="text-xs">/authors</code>、
          <code className="text-xs">/authors/:id/items</code>、<code className="text-xs">/search</code>、
          <code className="text-xs">/facets</code> 和 <code className="text-xs">/stats/timeline</code>。
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">参数</th>
                <th className="px-3 py-2 font-medium">说明</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2 font-mono text-xs">journal</td>
                <td className="px-3 py-2 text-muted-foreground">单刊精确名（须为 Basket 白名单）</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">journals</td>
                <td className="px-3 py-2 text-muted-foreground">多刊，逗号分隔；与 journal 互斥</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">year</td>
                <td className="px-3 py-2 text-muted-foreground">精确年份</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">yearFrom / yearTo</td>
                <td className="px-3 py-2 text-muted-foreground">年份区间（含端点）</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-xs">type</td>
                <td className="px-3 py-2 text-muted-foreground">条目类型，如 journalArticle</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeBlock>
          {`${base}/api/open/v1/articles?yearFrom=2018&yearTo=2022&journals=${encodeURIComponent('MIS Quarterly,Information Systems Research')}`}
        </CodeBlock>
      </section>

      <section className="space-y-5">
        <h2 className="text-base font-semibold tracking-tight">接口一览</h2>
        {ENDPOINTS.map((ep) => (
          <article key={ep.id} className="rounded-md border px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                {ep.method}
              </span>
              <code className="text-sm font-mono break-all">{ep.path}</code>
            </div>
            <p className="text-sm text-muted-foreground">{ep.summary}</p>
            {ep.query && (
              <p className="text-xs text-muted-foreground">
                Query：<code className="font-mono">{ep.query}</code>
              </p>
            )}
            <div className="flex items-start gap-2">
              <CodeBlock className="flex-1">{ep.curl.replaceAll('$BASE', base)}</CodeBlock>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => handleCopyCurl(ep.curl)}
                title="复制 curl"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
