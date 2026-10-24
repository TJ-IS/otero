import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { query } from '../db/connection.js';
import {
  appendDoiRequiredForArticles,
  appendItemScopeFilters,
  fieldIdByName,
} from '../repositories/itemRepo.js';
import { getAuthorDetail } from '../repositories/authorRepo.js';
import { Item } from '../models/Item.js';
import { getOpenItemByKey, OpenApiError } from './openApiService.js';
import { JOURNAL_WHITELIST } from './journalWhitelist.js';
import { JOURNAL_META } from './journalMeta.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');
const WEB_INDEX_DEV = path.resolve(__dirname, '..', '..', 'web', 'index.html');

const SITEMAP_URL_LIMIT = 45000;
const SITEMAP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const sitemapCache = new Map();

function sitemapCacheKey(which) {
  return `${publicBaseUrl()}::${which}`;
}

function getCachedSitemap(key) {
  const hit = sitemapCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SITEMAP_CACHE_TTL_MS) {
    sitemapCache.delete(key);
    return null;
  }
  return hit.xml;
}

function setCachedSitemap(key, xml) {
  sitemapCache.set(key, { at: Date.now(), xml });
  return xml;
}

const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/library', changefreq: 'daily', priority: '0.95' },
  { path: '/journals', changefreq: 'weekly', priority: '0.9' },
  { path: '/search', changefreq: 'weekly', priority: '0.8' },
  { path: '/docs/api', changefreq: 'weekly', priority: '0.9' },
  { path: '/docs/agents', changefreq: 'weekly', priority: '0.9' },
  { path: '/dashboard', changefreq: 'weekly', priority: '0.7' },
  { path: '/dashboard/journals', changefreq: 'weekly', priority: '0.6' },
  { path: '/dashboard/timeline', changefreq: 'weekly', priority: '0.6' },
  { path: '/dashboard/authors', changefreq: 'weekly', priority: '0.6' },
  { path: '/dashboard/authors/stats', changefreq: 'weekly', priority: '0.5' },
  { path: '/dashboard/merkle', changefreq: 'monthly', priority: '0.4' },
];

export function publicBaseUrl() {
  return config.publicBaseUrl;
}

export function absoluteUrl(pathname = '/') {
  const base = publicBaseUrl();
  if (!pathname || pathname === '/') return `${base}/`;
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export function ogImageUrl() {
  const img = (config.publicOgImage || '/og.png').trim();
  if (/^https?:\/\//i.test(img)) return img;
  return absoluteUrl(img.startsWith('/') ? img : `/${img}`);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(text, max = 160) {
  const s = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function creatorDisplay(c) {
  if (!c) return '';
  if (c.fieldMode === 1 || !c.firstName) return c.lastName || c.name || '';
  return `${c.lastName || ''}, ${c.firstName || ''}`.trim().replace(/^,\s*/, '');
}

function yearOf(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/\b(1[5-9]|20)\d{2}\b/);
  return m ? m[0] : '';
}

function readSpaIndexHtml() {
  const distIndex = path.join(WEB_DIST, 'index.html');
  if (fs.existsSync(distIndex)) return fs.readFileSync(distIndex, 'utf8');
  if (fs.existsSync(WEB_INDEX_DEV)) return fs.readFileSync(WEB_INDEX_DEV, 'utf8');
  return null;
}

/**
 * Inject title/meta/JSON-LD into the SPA index and optional crawlable body in #root.
 */
export function injectSpaShell(
  html,
  {
    title,
    description,
    canonicalPath,
    robots = 'index, follow',
    ogType = 'website',
    jsonLd = null,
    bodyHtml = '',
  } = {},
) {
  const canonical = absoluteUrl(canonicalPath || '/');
  const image = ogImageUrl();
  const safeTitle = escapeHtml(title || 'Otero');
  const safeDesc = escapeHtml(description || '');
  const headBits = [
    `<title>${safeTitle}</title>`,
    `<meta name="description" content="${safeDesc}" />`,
    `<meta name="robots" content="${escapeHtml(robots)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    `<meta property="og:type" content="${escapeHtml(ogType)}" />`,
    `<meta property="og:site_name" content="Otero" />`,
    `<meta property="og:title" content="${safeTitle}" />`,
    `<meta property="og:description" content="${safeDesc}" />`,
    `<meta property="og:url" content="${escapeHtml(canonical)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:locale:alternate" content="zh_CN" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ];
  if (config.googleSiteVerification) {
    headBits.push(
      `<meta name="google-site-verification" content="${escapeHtml(config.googleSiteVerification)}" />`,
    );
  }
  if (jsonLd) {
    headBits.push(
      `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    );
  }

  let out = html;
  if (/\blang="/i.test(out)) {
    out = out.replace(/\blang="[^"]*"/i, 'lang="en"');
  } else {
    out = out.replace(/<html\b/i, '<html lang="en"');
  }
  if (/<title>[^<]*<\/title>/i.test(out)) {
    out = out.replace(/<title>[^<]*<\/title>/i, headBits[0]);
  } else {
    out = out.replace(/<\/head>/i, `  ${headBits[0]}\n  </head>`);
  }

  // Strip prior injected SEO tags so rebuilds stay idempotent if ever re-injected.
  out = out.replace(/\n?\s*<meta name="description"[^>]*>/gi, '');
  out = out.replace(/\n?\s*<meta name="robots"[^>]*>/gi, '');
  out = out.replace(/\n?\s*<link rel="canonical"[^>]*>/gi, '');
  out = out.replace(/\n?\s*<meta property="og:[^"]+"[^>]*>/gi, '');
  out = out.replace(/\n?\s*<meta name="twitter:[^"]+"[^>]*>/gi, '');
  out = out.replace(/\n?\s*<meta name="google-site-verification"[^>]*>/gi, '');
  out = out.replace(/\n?\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');

  const inject = headBits.slice(1).join('\n    ');
  out = out.replace(/<\/head>/i, `    ${inject}\n  </head>`);

  if (bodyHtml) {
    // Keep #root empty: anything rendered there is painted before the SPA
    // bundle boots and then wiped on mount, which users see as a flash of
    // crawler copy. <noscript> is invisible to JS-enabled browsers but still
    // present in the served HTML for crawlers that never execute scripts.
    out = out.replace(
      /<div id="root"><\/div>/i,
      `<div id="root"></div>\n    <noscript>${bodyHtml}</noscript>`,
    );
  }
  return out;
}

// Do not blanket-Disallow /api/: the public SPA fetches /api/journals and
// /api/stats/* to render. Googlebot honors robots.txt during rendering, so
// blocking those URLs leaves #root empty and the homepage is classified as
// a soft 404. Only hide editor/auth/import surfaces.
const ROBOTS_CRAWL_POLICY = `Allow: /
Disallow: /admin
Disallow: /api/admin
Disallow: /api/auth
Disallow: /api/import`;

export function buildRobotsTxt() {
  const sitemap = absoluteUrl('/sitemap.xml');
  const agents = [
    '*',
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'PerplexityBot',
    'ClaudeBot',
    'anthropic-ai',
    'Google-Extended',
    'GoogleOther',
    'Bingbot',
  ];
  const blocks = agents.map((agent) => `User-agent: ${agent}\n${ROBOTS_CRAWL_POLICY}`).join('\n\n');
  return `# Otero — ${publicBaseUrl()}
${blocks}

# Training-oriented crawl (not search citation)
User-agent: CCBot
Disallow: /

Sitemap: ${sitemap}
`;
}

export function buildLlmsTxt() {
  const base = publicBaseUrl();
  return `# Otero

> Otero is a read-only literature library and Open API for the AIS Senior Scholars' Basket of Journals (11 information systems journals). Browse metadata, search articles and authors, view corpus stats, and fetch structured full text when available.

Otero does not modify the corpus via its public Open API. All open endpoints are GET-only. Only non-deleted, top-level items in the Basket whitelist are exposed.

## Docs

- [Open API reference](${base}/docs/api): Human-readable endpoint list and filter contract
- [Agent skill (UI)](${base}/docs/agents): Install with \`npx skills add ${base}\` (scheme required)
- [Agent skill (raw)](${base}/api/open/v1/SKILL.md): Live Markdown skill for autonomous agents
- [Agent skill discovery](${base}/.well-known/agent-skills/index.json): well-known index for the skills CLI

## Site

- [Research portal](${base}/): Overview, statistics, journals, and recently added literature
- [AIS Basket journals](${base}/journals): The 11 AIS Senior Scholars' Basket journals
- [Library](${base}/library): Browse Basket literature
- [Search](${base}/search): Full-text and metadata search
- [Dashboard](${base}/dashboard): Corpus overview, journals, timeline, author graph

## Optional

- [Sitemap](${base}/sitemap.xml)
`;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatW3cDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function urlEntry({ loc, lastmod, changefreq, priority }) {
  const parts = [`    <loc>${xmlEscape(loc)}</loc>`];
  if (lastmod) parts.push(`    <lastmod>${xmlEscape(lastmod)}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${xmlEscape(changefreq)}</changefreq>`);
  if (priority) parts.push(`    <priority>${xmlEscape(priority)}</priority>`);
  return `  <url>\n${parts.join('\n')}\n  </url>`;
}

async function listSitemapItems() {
  const where = ['i.deleted = 0', 'i."parentItemID" IS NULL'];
  const params = [];
  const p = await appendItemScopeFilters(where, params, 1, {
    basketOnly: true,
    requireDoiForArticles: true,
  });
  if (p == null) return [];
  const rows = await query(
    `SELECT i.key, i."dateModified" AS "dateModified"
     FROM items i
     WHERE ${where.join(' AND ')}
     ORDER BY i."dateModified" DESC`,
    params,
  );
  return rows;
}

async function listSitemapAuthors() {
  const jfid = await fieldIdByName('publicationTitle');
  if (!jfid) return [];
  const params = [jfid, ...JOURNAL_WHITELIST];
  const wl = JOURNAL_WHITELIST.map((_, i) => `$${i + 2}`).join(',');
  const extra = [];
  await appendDoiRequiredForArticles(extra, params, params.length + 1);
  const doiSql = extra.length ? `AND ${extra[0]}` : '';
  return query(
    `SELECT c."creatorID" AS id, MAX(i."dateModified") AS "dateModified"
     FROM creators c
     JOIN "itemCreators" ic ON ic."creatorID" = c."creatorID"
     JOIN items i ON i."itemID" = ic."itemID"
     WHERE i.deleted = 0
       AND i."parentItemID" IS NULL
       AND EXISTS (
         SELECT 1 FROM "itemData" d
         JOIN "itemDataValues" v ON v."valueID" = d."valueID"
         WHERE d."itemID" = i."itemID" AND d."fieldID" = $1 AND v.value IN (${wl})
       )
       ${doiSql}
     GROUP BY c."creatorID"
     ORDER BY MAX(i."dateModified") DESC`,
    params,
  );
}

function buildUrlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

function buildSitemapIndex(locs) {
  const body = locs
    .map((loc) => `  <sitemap>\n    <loc>${xmlEscape(loc)}</loc>\n  </sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/**
 * Build sitemap XML. `/sitemap.xml` is always a lightweight sitemap index
 * (no DB). Child sitemaps are cached in-memory to avoid regenerating multi-MB
 * XML on every Googlebot hit.
 */
export async function buildSitemapXml(which = 'index') {
  // Index must be instant — never query the corpus here.
  if (which === 'index') {
    return buildSitemapIndex([
      absoluteUrl('/sitemap-static.xml'),
      absoluteUrl('/sitemap-items.xml'),
      absoluteUrl('/sitemap-authors.xml'),
    ]);
  }

  const cached = getCachedSitemap(sitemapCacheKey(which));
  if (cached) return cached;

  const staticEntries = STATIC_PAGES.map((p) =>
    urlEntry({
      loc: absoluteUrl(p.path),
      changefreq: p.changefreq,
      priority: p.priority,
    }),
  );

  if (which === 'static') {
    return setCachedSitemap(sitemapCacheKey(which), buildUrlset(staticEntries));
  }

  if (which === 'items') {
    const items = await listSitemapItems();
    const itemEntries = items.slice(0, SITEMAP_URL_LIMIT).map((row) =>
      urlEntry({
        loc: absoluteUrl(`/items/${row.key}`),
        lastmod: formatW3cDate(row.dateModified),
        changefreq: 'monthly',
        priority: '0.7',
      }),
    );
    return setCachedSitemap(sitemapCacheKey(which), buildUrlset(itemEntries));
  }

  if (which === 'authors') {
    const authors = await listSitemapAuthors();
    const authorEntries = authors.slice(0, SITEMAP_URL_LIMIT).map((row) =>
      urlEntry({
        loc: absoluteUrl(`/authors/${row.id}`),
        lastmod: formatW3cDate(row.dateModified),
        changefreq: 'monthly',
        priority: '0.6',
      }),
    );
    return setCachedSitemap(sitemapCacheKey(which), buildUrlset(authorEntries));
  }

  throw new Error(`Unknown sitemap variant: ${which}`);
}

const PORTAL_DESCRIPTION =
  "Otero is a research portal for the AIS Senior Scholars' Basket of Journals: explore corpus statistics, browse 11 leading information systems journals, search literature, and use the read-only Open API.";

function websiteSearchAction() {
  return {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${absoluteUrl('/search')}?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  };
}

function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Otero',
    alternateName: ['AIS Basket', "AIS Senior Scholars' Basket of Journals"],
    url: absoluteUrl('/'),
    description: PORTAL_DESCRIPTION,
    publisher: {
      '@type': 'Organization',
      name: 'Otero',
      url: absoluteUrl('/'),
    },
    potentialAction: websiteSearchAction(),
  };
}

const JOURNALS_DESCRIPTION =
  "The 11 AIS Senior Scholars' Basket journals: official titles, abbreviations, publishers, and the AIS Basket literature indexed in Otero.";

function journalsJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: "AIS Senior Scholars' Basket of Journals",
    url: absoluteUrl('/journals'),
    description: JOURNALS_DESCRIPTION,
    isPartOf: {
      '@type': 'WebSite',
      name: 'Otero',
      url: absoluteUrl('/'),
    },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: JOURNAL_META.length,
      itemListElement: JOURNAL_META.map((journal, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Periodical',
          name: journal.name,
          alternateName: journal.abbr,
          url: journal.homepage,
          publisher: { '@type': 'Organization', name: journal.publisher },
        },
      })),
    },
  };
}

function journalsBodyHtml() {
  const items = JOURNAL_META.map(
    (journal) =>
      `<li><a href="/library?journal=${encodeURIComponent(journal.name)}">${escapeHtml(journal.name)}</a> (${escapeHtml(journal.abbr)})</li>`,
  ).join('');
  return [
    '<article>',
    "<h1>AIS Senior Scholars' Basket of Journals</h1>",
    `<p>${escapeHtml(JOURNALS_DESCRIPTION)}</p>`,
    `<ol>${items}</ol>`,
    '<p><a href="/library">Browse the literature library</a></p>',
    '</article>',
  ].join('\n');
}

function webApiJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: 'Otero Open API',
    description:
      "Read-only HTTP API for AIS Senior Scholars' Basket literature: search articles and authors, fetch metadata and structured full text, export citations, and query corpus stats.",
    url: absoluteUrl('/docs/api'),
    documentation: absoluteUrl('/api/open/v1/SKILL.md'),
    provider: {
      '@type': 'Organization',
      name: 'Otero',
      url: absoluteUrl('/'),
    },
  };
}

function scholarlyArticleJsonLd(item) {
  const fields = item.fields || {};
  const title = fields.title || 'Untitled';
  const authors = (item.creators || [])
    .filter((c) => !c.creatorType || c.creatorType === 'author')
    .map((c) => ({
      '@type': 'Person',
      name: creatorDisplay(c),
    }))
    .filter((a) => a.name);
  const doi = fields.DOI || fields.doi;
  const journal = fields.publicationTitle;
  const year = yearOf(fields.date);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: title,
    url: absoluteUrl(`/items/${item.key}`),
    datePublished: year || undefined,
    abstract: fields.abstractNote || undefined,
    author: authors.length ? authors : undefined,
    isPartOf: journal ? { '@type': 'Periodical', name: journal } : undefined,
    identifier: doi ? { '@type': 'PropertyValue', propertyID: 'DOI', value: doi } : undefined,
  };
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v != null));
}

function personJsonLd(author, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name,
    url: absoluteUrl(`/authors/${author.id}`),
    description: `${author.name} — ${items.length} Basket paper(s) in Otero.`,
  };
}

function itemBodyHtml(item) {
  const fields = item.fields || {};
  const title = fields.title || 'Untitled';
  const authors = (item.creators || []).map(creatorDisplay).filter(Boolean).join('; ');
  const journal = fields.publicationTitle || '';
  const year = yearOf(fields.date);
  const abstract = fields.abstractNote || '';
  const doi = fields.DOI || fields.doi || '';
  const parts = [`<article>`, `<h1>${escapeHtml(title)}</h1>`];
  if (authors) parts.push(`<p><strong>Authors:</strong> ${escapeHtml(authors)}</p>`);
  if (journal || year) {
    parts.push(
      `<p><strong>Journal:</strong> ${escapeHtml(journal)}${year ? ` (${escapeHtml(year)})` : ''}</p>`,
    );
  }
  if (doi) {
    parts.push(
      `<p><strong>DOI:</strong> <a href="https://doi.org/${escapeHtml(doi)}">${escapeHtml(doi)}</a></p>`,
    );
  }
  if (abstract) parts.push(`<p>${escapeHtml(truncate(abstract, 1200))}</p>`);
  parts.push(`<p><a href="${escapeHtml(absoluteUrl(`/items/${item.key}`))}">View in Otero</a></p>`);
  parts.push(`</article>`);
  return parts.join('\n');
}

function authorBodyHtml(author, items) {
  const list = items.slice(0, 25).map((it) => {
    const t = it.fields?.title || 'Untitled';
    const y = yearOf(it.fields?.date);
    const j = it.fields?.publicationTitle || '';
    return `<li><a href="${escapeHtml(absoluteUrl(`/items/${it.key}`))}">${escapeHtml(t)}</a>${y || j ? ` — ${escapeHtml([j, y].filter(Boolean).join(', '))}` : ''}</li>`;
  });
  return [
    `<article>`,
    `<h1>${escapeHtml(author.name)}</h1>`,
    `<p>${escapeHtml(author.name)} has ${items.length} paper(s) in the AIS Basket corpus on Otero.</p>`,
    list.length ? `<ol>${list.join('')}</ol>` : '',
    `</article>`,
  ].join('\n');
}

const PAGE_COPY = {
  home: {
    title: 'Otero | AIS Basket research portal',
    description: PORTAL_DESCRIPTION,
    path: '/',
    body: `<article><h1>AIS Senior Scholars' Basket of Journals</h1><p>${escapeHtml(PORTAL_DESCRIPTION)}</p><p>Otero indexes these 11 information systems journals:</p><ol>${JOURNAL_META.map((j) => `<li><a href="/library?journal=${encodeURIComponent(j.name)}">${escapeHtml(j.name)}</a> (${escapeHtml(j.abbr)})</li>`).join('')}</ol><p>See the <a href="/journals">AIS Basket journals list</a>, browse the <a href="/library">literature library</a>, use <a href="/search">search</a>, explore the <a href="/dashboard">dashboard</a>, or read the <a href="/docs/api">Open API docs</a>.</p></article>`,
    jsonLd: () => organizationJsonLd(),
  },
  library: {
    title: 'Literature library | Otero',
    description:
      "Browse and filter the AIS Senior Scholars' Basket of Journals literature collection in Otero.",
    path: '/library',
    body: `<article><h1>Otero literature library</h1><p>Browse non-deleted top-level literature items from the 11 AIS Senior Scholars' Basket journals. Filter by journal, type, collection, or search phrase.</p><p><a href="/">Back to the research portal</a> · <a href="/journals">AIS Basket journals</a> · <a href="/search">Search the library</a></p></article>`,
  },
  journals: {
    title: "AIS Senior Scholars' Basket of Journals | Otero",
    description: JOURNALS_DESCRIPTION,
    path: '/journals',
    body: journalsBodyHtml(),
    jsonLd: () => journalsJsonLd(),
  },
  search: {
    title: 'Search | Otero',
    description: "Search AIS Senior Scholars' Basket articles and metadata in Otero.",
    path: '/search',
    body: `<article><h1>Search Otero</h1><p>Search AIS Senior Scholars' Basket articles by title, abstract, authors, and full text when available.</p></article>`,
  },
  docsApi: {
    title: 'Open API | Otero',
    description:
      'Otero Open API is a read-only HTTP interface to the AIS Basket literature library: search, metadata, structured full text, citation export, and corpus stats.',
    path: '/docs/api',
    body: `<article><h1>Otero Open API</h1><p>Otero Open API is a read-only HTTP interface to the AIS Senior Scholars' Basket literature library. Use it to search articles and authors, resolve DOIs or item keys, fetch structured full text when available, export BibTeX/RIS, and query corpus statistics. All endpoints are GET-only.</p><p><a href="/api/open/v1/SKILL.md">Agent SKILL.md</a> · <a href="/docs/agents">Agents docs</a></p></article>`,
    jsonLd: () => webApiJsonLd(),
  },
  docsAgents: {
    title: 'Agent Skill | Otero',
    description:
      "Install Otero's Open API skill with npx skills add https://ais-basket.xyz so agents can search AIS Basket literature.",
    path: '/docs/agents',
    body: `<article><h1>Otero for Agents</h1><p>Install the Otero Open API skill with <code>npx skills add https://ais-basket.xyz</code> (the https:// prefix is required). Agents can then search the AIS Basket library, fetch items and full text, and export citations. Discovery lives at <a href="/.well-known/agent-skills/index.json">/.well-known/agent-skills/index.json</a>; the live skill is also at <a href="/api/open/v1/SKILL.md">/api/open/v1/SKILL.md</a>.</p></article>`,
  },
  dashboard: {
    title: 'Dashboard | Otero',
    description:
      "Corpus overview for the AIS Senior Scholars' Basket library: coverage, journals, timeline, and author networks.",
    path: '/dashboard',
    body: `<article><h1>Otero Dashboard</h1><p>Explore AIS Basket corpus coverage, journals, publication timeline, and author collaboration graphs.</p></article>`,
  },
  admin: {
    title: 'Admin | Otero',
    description: 'Otero administration (editors only).',
    path: '/admin',
    robots: 'noindex, nofollow',
    body: `<article><h1>Admin</h1><p>Editor-only administration area.</p></article>`,
  },
  notFound: {
    title: 'Not found | Otero',
    description: 'The requested page was not found on Otero.',
    path: '/',
    robots: 'noindex, follow',
    body: `<article><h1>Not found</h1><p>The requested resource was not found.</p><p><a href="/">Back to library</a></p></article>`,
  },
};

function shellFromCopy(key, overrides = {}) {
  const copy = PAGE_COPY[key];
  const html = readSpaIndexHtml();
  if (!html) return null;
  return injectSpaShell(html, {
    title: overrides.title || copy.title,
    description: overrides.description || copy.description,
    canonicalPath: overrides.canonicalPath || copy.path,
    robots: overrides.robots || copy.robots || 'index, follow',
    ogType: overrides.ogType || 'website',
    jsonLd:
      overrides.jsonLd !== undefined
        ? overrides.jsonLd
        : typeof copy.jsonLd === 'function'
          ? copy.jsonLd()
          : null,
    bodyHtml: overrides.bodyHtml || copy.body || '',
  });
}

export async function renderSpaShellForRequest(req) {
  const urlPath = (req.path || '/').split('?')[0] || '/';
  const html = readSpaIndexHtml();
  if (!html) return null;

  // Admin — always noindex
  if (urlPath === '/admin' || urlPath.startsWith('/admin/')) {
    return { status: 200, html: shellFromCopy('admin', { canonicalPath: '/admin' }) };
  }

  // Item detail
  const itemMatch = urlPath.match(/^\/items\/([^/]+)\/?$/);
  if (itemMatch) {
    const key = decodeURIComponent(itemMatch[1]);
    try {
      const { item } = await getOpenItemByKey(key);
      const fields = item.fields || {};
      const title = fields.title || 'Untitled';
      const desc = truncate(
        fields.abstractNote ||
          [creatorDisplay(item.creators?.[0]), fields.publicationTitle, yearOf(fields.date)]
            .filter(Boolean)
            .join(' · ') ||
          title,
        160,
      );
      return {
        status: 200,
        html: injectSpaShell(html, {
          title: `${title} | Otero`,
          description: desc,
          canonicalPath: `/items/${item.key}`,
          ogType: 'article',
          jsonLd: scholarlyArticleJsonLd(item),
          bodyHtml: itemBodyHtml(item),
        }),
      };
    } catch (err) {
      if (err instanceof OpenApiError && err.status === 404) {
        return { status: 404, html: shellFromCopy('notFound') };
      }
      throw err;
    }
  }

  // Author detail
  const authorMatch = urlPath.match(/^\/authors\/(\d+)\/?$/);
  if (authorMatch) {
    const creatorId = parseInt(authorMatch[1], 10);
    const detail = await getAuthorDetail(creatorId);
    if (!detail) {
      return { status: 404, html: shellFromCopy('notFound') };
    }
    const loaded = await Promise.all(detail.itemIds.map((id) => Item.loadById(id)));
    const whitelist = new Set(JOURNAL_WHITELIST);
    const items = loaded
      .filter(Boolean)
      .map((it) => it.toJSON())
      .filter((it) => whitelist.has(it.fields?.publicationTitle))
      .sort((a, b) => (b.fields?.date || '').localeCompare(a.fields?.date || ''));
    const desc = truncate(`${detail.name} — ${items.length} AIS Basket paper(s) in Otero.`, 160);
    return {
      status: 200,
      html: injectSpaShell(html, {
        title: `${detail.name} | Otero`,
        description: desc,
        canonicalPath: `/authors/${detail.id}`,
        ogType: 'profile',
        jsonLd: personJsonLd(detail, items),
        bodyHtml: authorBodyHtml(detail, items),
      }),
    };
  }

  if (urlPath === '/docs' || urlPath === '/docs/') {
    return { status: 200, html: shellFromCopy('docsApi', { canonicalPath: '/docs/api' }) };
  }
  if (urlPath === '/docs/api') {
    return { status: 200, html: shellFromCopy('docsApi') };
  }
  if (urlPath === '/docs/agents') {
    return { status: 200, html: shellFromCopy('docsAgents') };
  }

  if (urlPath === '/search') {
    const hasQuery = Boolean(req.query && Object.keys(req.query).length);
    return {
      status: 200,
      html: shellFromCopy('search', {
        robots: hasQuery ? 'noindex, follow' : 'index, follow',
        canonicalPath: '/search',
      }),
    };
  }

  if (urlPath === '/library' || urlPath === '/library/') {
    return { status: 200, html: shellFromCopy('library') };
  }

  if (urlPath === '/journals' || urlPath === '/journals/') {
    return { status: 200, html: shellFromCopy('journals') };
  }

  if (urlPath === '/' || urlPath === '') {
    return { status: 200, html: shellFromCopy('home') };
  }

  if (urlPath === '/dashboard' || urlPath.startsWith('/dashboard/')) {
    const dashTitles = {
      '/dashboard': PAGE_COPY.dashboard,
      '/dashboard/journals': {
        title: 'Journals | Otero Dashboard',
        description: 'AIS Basket journal coverage and counts in Otero.',
      },
      '/dashboard/timeline': {
        title: 'Timeline | Otero Dashboard',
        description: 'Publication timeline for the AIS Basket corpus in Otero.',
      },
      '/dashboard/authors': {
        title: 'Author graph | Otero Dashboard',
        description: 'Co-authorship network for AIS Basket authors in Otero.',
      },
      '/dashboard/authors/stats': {
        title: 'Author stats | Otero Dashboard',
        description: 'Author analytics for the AIS Basket corpus in Otero.',
      },
      '/dashboard/merkle': {
        title: 'Merkle tree | Otero Dashboard',
        description: 'Corpus integrity Merkle tree view in Otero.',
      },
    };
    const meta = dashTitles[urlPath] || PAGE_COPY.dashboard;
    return {
      status: 200,
      html: shellFromCopy('dashboard', {
        title: meta.title,
        description: meta.description,
        canonicalPath: urlPath,
        bodyHtml: `<article><h1>${escapeHtml(meta.title)}</h1><p>${escapeHtml(meta.description)}</p></article>`,
      }),
    };
  }

  return { status: 404, html: shellFromCopy('notFound') };
}
