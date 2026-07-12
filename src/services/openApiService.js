import { Items, Item } from '../models/Item.js';
import {
  listJournals,
  findItemByDoi,
  findPdfAttachmentByItemId,
} from '../repositories/itemRepo.js';
import { searchAuthors, listAuthorItems } from '../repositories/authorRepo.js';
import { getFullText } from './fulltextService.js';
import { JOURNAL_WHITELIST, UNFILED } from './journalWhitelist.js';
import { normalizeDoi } from '../utils/doi.js';

const WHITELIST_SET = new Set(JOURNAL_WHITELIST);

export class OpenApiError extends Error {
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isInteger(n) ? n : NaN;
}

/**
 * Parse shared open-API filter query params.
 * @throws {OpenApiError}
 */
export function parseOpenFilters(query = {}) {
  const hasJournal = query.journal != null && String(query.journal).trim() !== '';
  const hasJournals = query.journals != null && String(query.journals).trim() !== '';
  if (hasJournal && hasJournals) {
    throw new OpenApiError(400, 'use either journal or journals, not both');
  }

  let journal = null;
  let journals = null;

  if (hasJournal) {
    journal = String(query.journal).trim();
    if (journal === UNFILED) {
      throw new OpenApiError(400, 'journal "待归档" is not available on the open API');
    }
    if (!WHITELIST_SET.has(journal)) {
      throw new OpenApiError(400, `unknown journal: ${journal}`);
    }
  } else if (hasJournals) {
    journals = String(query.journals)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (journals.length === 0) {
      throw new OpenApiError(400, 'journals must list at least one journal name');
    }
    for (const name of journals) {
      if (!WHITELIST_SET.has(name)) {
        throw new OpenApiError(400, `unknown journal: ${name}`);
      }
    }
  }

  const year = query.year != null && query.year !== '' ? parsePositiveInt(query.year) : null;
  let yearFrom = query.yearFrom != null && query.yearFrom !== '' ? parsePositiveInt(query.yearFrom) : null;
  let yearTo = query.yearTo != null && query.yearTo !== '' ? parsePositiveInt(query.yearTo) : null;

  if (year != null && Number.isNaN(year)) throw new OpenApiError(400, 'invalid year');
  if (yearFrom != null && Number.isNaN(yearFrom)) throw new OpenApiError(400, 'invalid yearFrom');
  if (yearTo != null && Number.isNaN(yearTo)) throw new OpenApiError(400, 'invalid yearTo');

  // Intersect explicit year into the from/to window.
  if (year != null) {
    yearFrom = yearFrom == null ? year : Math.max(yearFrom, year);
    yearTo = yearTo == null ? year : Math.min(yearTo, year);
  }

  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    throw new OpenApiError(400, 'yearFrom cannot be greater than yearTo');
  }

  const type = query.type ? String(query.type).trim() : null;
  const page = Math.max(1, parsePositiveInt(query.page, 1) || 1);
  const pageSize = Math.min(100, Math.max(1, parsePositiveInt(query.pageSize, 20) || 20));

  return {
    journal,
    journals,
    yearFrom: yearFrom ?? undefined,
    yearTo: yearTo ?? undefined,
    type: type || undefined,
    page,
    pageSize,
    basketOnly: true,
  };
}

export async function listOpenJournals() {
  const journals = await listJournals();
  return { journals: journals.filter((j) => j.name !== UNFILED) };
}

function toArticlePage(result) {
  return {
    items: result.items.map((it) => it.toJSON()),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  };
}

export async function searchOpenArticles({ q, ...filters }) {
  const search = q != null && String(q).trim() ? String(q).trim() : undefined;
  const result = await Items.list({
    search,
    type: filters.type,
    journal: filters.journal,
    journals: filters.journals,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    basketOnly: true,
    includeDeleted: false,
    page: filters.page,
    pageSize: filters.pageSize,
    sortField: search ? 'dateModified' : 'date',
    sortDir: 'desc',
  });
  return toArticlePage(result);
}

export async function searchOpenAuthors({ q, ...filters }) {
  const needle = q != null ? String(q).trim() : '';
  if (!needle) throw new OpenApiError(400, 'q is required');
  return searchAuthors({
    q: needle,
    page: filters.page,
    pageSize: filters.pageSize,
    journal: filters.journal,
    journals: filters.journals,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    type: filters.type,
    basketOnly: true,
  });
}

export async function getOpenAuthorItems(creatorId, filters) {
  const detail = await listAuthorItems({
    creatorId,
    page: filters.page,
    pageSize: filters.pageSize,
    journal: filters.journal,
    journals: filters.journals,
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    type: filters.type,
    basketOnly: true,
  });
  if (!detail) throw new OpenApiError(404, 'author not found');

  const loaded = await Promise.all(detail.itemIds.map((id) => Item.loadById(id)));
  const items = loaded.filter(Boolean).map((it) => it.toJSON());

  return {
    id: detail.id,
    name: detail.name,
    items,
    total: detail.total,
    page: detail.page,
    pageSize: detail.pageSize,
    totalPages: detail.totalPages,
  };
}

export async function unifiedOpenSearch({ q, ...filters }) {
  const needle = q != null ? String(q).trim() : '';
  if (!needle) throw new OpenApiError(400, 'q is required');
  const [articles, authors] = await Promise.all([
    searchOpenArticles({ q: needle, ...filters }),
    searchOpenAuthors({ q: needle, ...filters }),
  ]);
  return { q: needle, articles, authors };
}

async function loadItemByDoiOrThrow(doiRaw) {
  const doi = normalizeDoi(doiRaw);
  if (!doi) throw new OpenApiError(400, 'doi is required');
  const row = await findItemByDoi(doi);
  if (!row) throw new OpenApiError(404, 'item not found for doi');
  const item = await Item.loadById(row.itemID);
  if (!item) throw new OpenApiError(404, 'item not found for doi');
  return { doi, item };
}

export async function getItemByDoi(doiRaw) {
  const { doi, item } = await loadItemByDoiOrThrow(doiRaw);
  return { doi, item: item.toJSON() };
}

export async function getMarkdownByDoi(doiRaw) {
  const { doi, item } = await loadItemByDoiOrThrow(doiRaw);
  const ft = await getFullText(item.key);
  if (!ft || ft.state !== 'done' || !ft.markdown) {
    throw new OpenApiError(404, 'markdown not available for doi', {
      doi,
      itemKey: item.key,
      state: ft?.state ?? null,
    });
  }
  return {
    doi,
    itemKey: item.key,
    state: ft.state,
    markdown: ft.markdown,
  };
}

export async function getPdfUrlByDoi(doiRaw) {
  const { doi, item } = await loadItemByDoiOrThrow(doiRaw);
  const attachmentKey = await findPdfAttachmentByItemId(item.id);
  if (!attachmentKey) {
    throw new OpenApiError(404, 'pdf not available for doi', {
      doi,
      itemKey: item.key,
    });
  }
  return {
    doi,
    itemKey: item.key,
    attachmentKey,
    url: `/api/attachments/${attachmentKey}/file`,
  };
}

export function buildSkillMarkdown({ baseUrl }) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return `---
name: otero-open-api
description: Read-only access to the Otero AIS Senior Scholars' Basket literature library via HTTP APIs. Use when searching papers or authors, listing Basket journals, filtering by year/journal, resolving DOIs, or fetching markdown/PDF download URLs.
---

# Otero Open API

Read-only HTTP API for the Otero literature corpus (AIS Senior Scholars' Basket of Journals).

## When to use

- Search papers by keyword (title, abstract, DOI, authors, full text)
- Search authors by name
- List an author's papers
- List Basket journals and filter by journal / year range
- Resolve a DOI to metadata, MinerU markdown, or a PDF download URL

## Base URL

\`${base}/api/open/v1\`

All endpoints are **GET** and **read-only**. Do not attempt POST/PATCH/DELETE against this namespace.

## Visibility

- Only non-deleted top-level items in the 11 Basket journals
- The internal "待归档" (unfiled) bucket is never exposed

## Pagination

- \`page\` (default 1)
- \`pageSize\` (default 20, max 100)
- List responses: \`{ items, total, page, pageSize, totalPages }\`

## Shared filters

Use on \`/articles\`, \`/authors\`, \`/authors/:id/items\`, and \`/search\`:

| Param | Description |
|-------|-------------|
| \`journal\` | Exact Basket journal name |
| \`journals\` | Comma-separated journal names (mutually exclusive with \`journal\`) |
| \`year\` | Exact publication year |
| \`yearFrom\` / \`yearTo\` | Inclusive year range |
| \`type\` | Item type, e.g. \`journalArticle\` |

## Endpoints

### Journals

\`GET ${base}/api/open/v1/journals\`

### Search articles

\`GET ${base}/api/open/v1/articles?q=blockchain&yearFrom=2018&yearTo=2022&journal=MIS%20Quarterly&page=1&pageSize=20\`

\`q\` is optional (filter-only browsing is allowed).

### Search authors

\`GET ${base}/api/open/v1/authors?q=Smith&page=1&pageSize=20\`

\`q\` is required.

### Author items

\`GET ${base}/api/open/v1/authors/{id}/items?page=1&pageSize=20\`

### Unified search

\`GET ${base}/api/open/v1/search?q=platform&page=1&pageSize=10\`

Returns \`{ q, articles, authors }\` (each bucket paginated).

### By DOI

\`GET ${base}/api/open/v1/items/by-doi?doi=10.1234/example\`

\`GET ${base}/api/open/v1/items/by-doi/markdown?doi=10.1234/example\`

\`GET ${base}/api/open/v1/items/by-doi/pdf-url?doi=10.1234/example\`

DOI may include an \`https://doi.org/\` prefix. PDF URL is relative (\`/api/attachments/{key}/file\`); prepend the site origin to download.

## Errors

- \`400\` invalid parameters
- \`404\` not found / markdown or PDF unavailable

## Agent tips

1. Call \`/journals\` first if you need exact journal names for filters.
2. Prefer \`/search\` when the user query could match either papers or people.
3. For full text, use \`/items/by-doi/markdown\` after confirming the DOI via \`/items/by-doi\`.
`;
}
