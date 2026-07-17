import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { query } from '../db/connection.js';
import { appendItemScopeFilters, fieldIdByName } from '../repositories/itemRepo.js';
import { getAuthorDetail } from '../repositories/authorRepo.js';
import { Item } from '../models/Item.js';
import { getOpenItemByKey, OpenApiError } from './openApiService.js';
import { JOURNAL_WHITELIST } from './journalWhitelist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');
const WEB_INDEX_DEV = path.resolve(__dirname, '..', '..', 'web', 'index.html');

const SITEMAP_URL_LIMIT = 45000;

const STATIC_PAGES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
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

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function truncate(text, max = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
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
export function injectSpaShell(html, {
  title,
  description,
  canonicalPath,
  robots = 'index, follow',
  ogType = 'website',
  jsonLd = null,
  bodyHtml = '',
} = {}) {
  const canonical = absoluteUrl(canonicalPath || '/');
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
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${safeTitle}" />`,
    `<meta name="twitter:description" content="${safeDesc}" />`,
  ];
  if (jsonLd) {
    headBits.push(
      `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    );
  }

  let out = html;
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
  out = out.replace(/\n?\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi, '');

  const inject = headBits.slice(1).join('\n    ');
  out = out.replace(/<\/head>/i, `    ${inject}\n  </head>`);

  if (bodyHtml) {
    out = out.replace(
      /<div id="root"><\/div>/i,
      `<div id="root">${bodyHtml}</div>`,
    );
  }
  return out;
}

export function buildRobotsTxt() {
  const sitemap = absoluteUrl('/sitemap.xml');
  return `# Otero — https://wtf-is.eu.cc
User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

# AI search / citation crawlers (keep allowed)
User-agent: GPTBot
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: ChatGPT-User
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: OAI-SearchBot
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: PerplexityBot
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: ClaudeBot
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: anthropic-ai
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: Google-Extended
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: GoogleOther
Allow: /
Disallow: /admin
Disallow: /api/

User-agent: Bingbot
Allow: /
Disallow: /admin
Disallow: /api/

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
- [Agent skill (UI)](${base}/docs/agents): SKILL.md preview for agent install
- [Agent skill (raw)](${base}/api/open/v1/SKILL.md): Live Markdown skill for autonomous agents

## Site

- [Library](${base}/): Browse Basket literature
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
  const p = await appendItemScopeFilters(where, params, 1, { basketOnly: true });
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
  const body = locs.map((loc) => `  <sitemap>\n    <loc>${xmlEscape(loc)}</loc>\n  </sitemap>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/**
 * Build sitemap XML. When the corpus is large, return a sitemap index and
 * support /sitemap-static.xml, /sitemap-items.xml, /sitemap-authors.xml.
 */
export async function buildSitemapXml(which = 'index') {
  const staticEntries = STATIC_PAGES.map((p) => urlEntry({
    loc: absoluteUrl(p.path),
    changefreq: p.changefreq,
    priority: p.priority,
  }));

  if (which === 'static') return buildUrlset(staticEntries);

  const [items, authors] = await Promise.all([
    listSitemapItems(),
    listSitemapAuthors(),
  ]);

  const itemEntries = items.slice(0, SITEMAP_URL_LIMIT).map((row) => urlEntry({
    loc: absoluteUrl(`/items/${row.key}`),
    lastmod: formatW3cDate(row.dateModified),
    changefreq: 'monthly',
    priority: '0.7',
  }));

  const authorEntries = authors.slice(0, SITEMAP_URL_LIMIT).map((row) => urlEntry({
    loc: absoluteUrl(`/authors/${row.id}`),
    lastmod: formatW3cDate(row.dateModified),
    changefreq: 'monthly',
    priority: '0.6',
  }));

  if (which === 'items') return buildUrlset(itemEntries);
  if (which === 'authors') return buildUrlset(authorEntries);

  const total = staticEntries.length + itemEntries.length + authorEntries.length;
  if (total <= SITEMAP_URL_LIMIT) {
    return buildUrlset([...staticEntries, ...itemEntries, ...authorEntries]);
  }

  return buildSitemapIndex([
    absoluteUrl('/sitemap-static.xml'),
    absoluteUrl('/sitemap-items.xml'),
    absoluteUrl('/sitemap-authors.xml'),
  ]);
}

const DEFAULT_DESCRIPTION =
  'Otero is a read-only literature library and Open API for the AIS Senior Scholars\' Basket of Journals — search articles, authors, and corpus statistics.';

function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Otero',
    url: absoluteUrl('/'),
    description: DEFAULT_DESCRIPTION,
    publisher: {
      '@type': 'Organization',
      name: 'Otero',
      url: absoluteUrl('/'),
    },
  };
}

function webApiJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: 'Otero Open API',
    description:
      'Read-only HTTP API for AIS Senior Scholars\' Basket literature: search articles and authors, fetch metadata and structured full text, export citations, and query corpus stats.',
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
    isPartOf: journal
      ? { '@type': 'Periodical', name: journal }
      : undefined,
    identifier: doi
      ? { '@type': 'PropertyValue', propertyID: 'DOI', value: doi }
      : undefined,
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
  const parts = [
    `<article>`,
    `<h1>${escapeHtml(title)}</h1>`,
  ];
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
    title: 'Otero | AIS Basket Literature API',
    description: DEFAULT_DESCRIPTION,
    path: '/',
    body: `<article><h1>Otero</h1><p>${escapeHtml(DEFAULT_DESCRIPTION)}</p><p>Browse the <a href="/search">library search</a>, explore the <a href="/dashboard">dashboard</a>, or read the <a href="/docs/api">Open API docs</a>.</p></article>`,
    jsonLd: () => organizationJsonLd(),
  },
  search: {
    title: 'Search | Otero',
    description: 'Search AIS Senior Scholars\' Basket articles and metadata in Otero.',
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
      'Install Otero\'s agent skill (SKILL.md) so autonomous agents can discover and call the read-only Open API for AIS Basket literature.',
    path: '/docs/agents',
    body: `<article><h1>Otero for Agents</h1><p>Otero publishes a live SKILL.md that tells agents how to search the AIS Basket library, fetch items and full text, and export citations via the read-only Open API. Copy the skill or fetch <a href="/api/open/v1/SKILL.md">/api/open/v1/SKILL.md</a> directly.</p></article>`,
  },
  dashboard: {
    title: 'Dashboard | Otero',
    description: 'Corpus overview for the AIS Senior Scholars\' Basket library: coverage, journals, timeline, and author networks.',
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
    jsonLd: overrides.jsonLd !== undefined
      ? overrides.jsonLd
      : (typeof copy.jsonLd === 'function' ? copy.jsonLd() : null),
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
        fields.abstractNote
          || [creatorDisplay(item.creators?.[0]), fields.publicationTitle, yearOf(fields.date)]
            .filter(Boolean)
            .join(' · ')
          || title,
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
    const desc = truncate(
      `${detail.name} — ${items.length} AIS Basket paper(s) in Otero.`,
      160,
    );
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

  // Fallback: generic shell with default site meta (SPA client routes 404s)
  return {
    status: 200,
    html: injectSpaShell(html, {
      title: PAGE_COPY.home.title,
      description: PAGE_COPY.home.description,
      canonicalPath: urlPath,
      robots: 'index, follow',
      bodyHtml: '',
    }),
  };
}
