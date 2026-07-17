const SITE_NAME = 'Otero';
const DEFAULT_TITLE = 'Otero | AIS Basket Literature API';
const DEFAULT_DESCRIPTION =
  "Otero is a read-only literature library and Open API for the AIS Senior Scholars' Basket of Journals — search articles, authors, and corpus statistics.";

export const SEO_DEFAULTS = {
  siteName: SITE_NAME,
  title: DEFAULT_TITLE,
  description: DEFAULT_DESCRIPTION,
};

function ensureMeta(attr, key, content) {
  if (content == null || content === '') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function ensureLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function ensureJsonLd(data) {
  const id = 'otero-jsonld';
  let el = document.getElementById(id);
  if (!data) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

export function absoluteUrl(pathname = '/') {
  if (typeof window === 'undefined') return pathname;
  const origin = window.location.origin;
  if (!pathname || pathname === '/') return `${origin}/`;
  return `${origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/**
 * Apply document head SEO fields for the current SPA route.
 */
export function applyPageMeta({
  title,
  description,
  canonicalPath,
  robots = 'index, follow',
  ogType = 'website',
  jsonLd = null,
} = {}) {
  if (typeof document === 'undefined') return;

  const pageTitle = title || SEO_DEFAULTS.title;
  const pageDesc = description || SEO_DEFAULTS.description;
  const canonical = absoluteUrl(canonicalPath || window.location.pathname || '/');

  document.title = pageTitle;
  ensureMeta('name', 'description', pageDesc);
  ensureMeta('name', 'robots', robots);
  ensureLink('canonical', canonical);
  ensureMeta('property', 'og:type', ogType);
  ensureMeta('property', 'og:site_name', SEO_DEFAULTS.siteName);
  ensureMeta('property', 'og:title', pageTitle);
  ensureMeta('property', 'og:description', pageDesc);
  ensureMeta('property', 'og:url', canonical);
  ensureMeta('name', 'twitter:card', 'summary');
  ensureMeta('name', 'twitter:title', pageTitle);
  ensureMeta('name', 'twitter:description', pageDesc);
  ensureJsonLd(jsonLd);
}

export function truncateMeta(text, max = 160) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export function scholarlyArticleJsonLd(item) {
  if (!item) return null;
  const fields = item.fields || {};
  const authors = (item.creators || [])
    .map((c) => {
      const name = c.fieldMode === 1 || !c.firstName
        ? (c.lastName || c.name || '')
        : `${c.lastName || ''}, ${c.firstName || ''}`.trim().replace(/^,\s*/, '');
      return name ? { '@type': 'Person', name } : null;
    })
    .filter(Boolean);
  const doi = fields.DOI || fields.doi;
  const yearMatch = String(fields.date || '').match(/\b(1[5-9]|20)\d{2}\b/);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: fields.title || 'Untitled',
    url: absoluteUrl(`/items/${item.key}`),
    datePublished: yearMatch?.[0],
    abstract: fields.abstractNote || undefined,
    author: authors.length ? authors : undefined,
    isPartOf: fields.publicationTitle
      ? { '@type': 'Periodical', name: fields.publicationTitle }
      : undefined,
    identifier: doi
      ? { '@type': 'PropertyValue', propertyID: 'DOI', value: doi }
      : undefined,
  };
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v != null));
}

export function personJsonLd(author) {
  if (!author?.name) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name,
    url: absoluteUrl(`/authors/${author.id}`),
    description: `${author.name} — ${(author.items || []).length} Basket paper(s) in Otero.`,
  };
}

export function webApiJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: 'Otero Open API',
    description:
      "Read-only HTTP API for AIS Senior Scholars' Basket literature: search, metadata, structured full text, citation export, and corpus stats.",
    url: absoluteUrl('/docs/api'),
    documentation: absoluteUrl('/api/open/v1/SKILL.md'),
    provider: {
      '@type': 'Organization',
      name: 'Otero',
      url: absoluteUrl('/'),
    },
  };
}

export function websiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Otero',
    url: absoluteUrl('/'),
    description: SEO_DEFAULTS.description,
    publisher: {
      '@type': 'Organization',
      name: 'Otero',
      url: absoluteUrl('/'),
    },
  };
}
