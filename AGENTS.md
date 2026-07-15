# Otero Agent Guide

Otero is a read-only literature API for the AIS Senior Scholars' Basket of Journals. Agents should use the stable `/api/open/v1` namespace instead of internal `/api` routes.

## Discovery

- Fetch `/api/open/v1/SKILL.md` for the complete live endpoint reference.
- Call `/api/open/v1/journals` before applying journal filters; journal names are exact.
- Only non-deleted, top-level items in the 11 Basket journals are visible. Never attempt to access the internal `待归档` bucket.

## Recommended workflow

1. Use `/search?q=...` when a name or phrase may refer to either an article or an author.
2. Use `/articles` for metadata/full-text search and filter-only browsing.
3. Reuse the returned item `key` with `/items/{key}`, `/markdown`, `/pdf-url`, `/structure`, or `/export`.
4. Use `/facets` to discover journal, year, type, and resource-availability counts before narrowing a large result set.
5. Use `/stats/overview` and `/stats/timeline` for corpus-level questions; do not approximate these values from one result page.

## Query contract

- Pagination: `page` defaults to 1; `pageSize` defaults to 20 and is capped at 100.
- Shared filters: `journal`, `journals`, `year`, `yearFrom`, `yearTo`, and `type`.
- `journal` and `journals` are mutually exclusive.
- Citation export formats are `bibtex` and `ris`.
- Treat `404` from markdown or PDF endpoints as “not available,” not as proof that the metadata item is absent.

All open endpoints are GET-only. Do not send write requests or use internal administration, ingestion, extraction, calibration, or chat endpoints.
