import { query, queryOne } from '../db/connection.js';
import { appendDoiRequiredForArticles } from './itemRepo.js';
import { JOURNAL_WHITELIST } from '../services/journalWhitelist.js';

function placeholders(values, params) {
  return values.map((value) => {
    params.push(value);
    return `$${params.length}`;
  }).join(',');
}

async function buildOpenWhere({ q, journal, journals, yearFrom, yearTo, type } = {}) {
  const params = [];
  const basketParams = placeholders(JOURNAL_WHITELIST, params);
  const where = [
    'i.deleted = 0',
    'i."parentItemID" IS NULL',
    `EXISTS (
      SELECT 1 FROM "itemData" scope_d
      JOIN fields scope_f ON scope_f."fieldID" = scope_d."fieldID" AND scope_f."fieldName" = 'publicationTitle'
      JOIN "itemDataValues" scope_v ON scope_v."valueID" = scope_d."valueID"
      WHERE scope_d."itemID" = i."itemID" AND scope_v.value IN (${basketParams})
    )`,
  ];

  const journalList = journal ? [journal] : (journals || []);
  if (journalList.length) {
    const journalParams = placeholders(journalList, params);
    where.push(`EXISTS (
      SELECT 1 FROM "itemData" journal_d
      JOIN fields journal_f ON journal_f."fieldID" = journal_d."fieldID" AND journal_f."fieldName" = 'publicationTitle'
      JOIN "itemDataValues" journal_v ON journal_v."valueID" = journal_d."valueID"
      WHERE journal_d."itemID" = i."itemID" AND journal_v.value IN (${journalParams})
    )`);
  }

  if (type) {
    params.push(type);
    where.push(`EXISTS (
      SELECT 1 FROM "itemTypes" filter_type
      WHERE filter_type."itemTypeID" = i."itemTypeID" AND filter_type."typeName" = $${params.length}
    )`);
  }

  if (yearFrom != null || yearTo != null) {
    const clauses = [];
    if (yearFrom != null) {
      params.push(String(yearFrom));
      clauses.push(`substring(year_v.value from '(1[5-9][0-9]{2}|20[0-9]{2})') >= $${params.length}`);
    }
    if (yearTo != null) {
      params.push(String(yearTo));
      clauses.push(`substring(year_v.value from '(1[5-9][0-9]{2}|20[0-9]{2})') <= $${params.length}`);
    }
    where.push(`EXISTS (
      SELECT 1 FROM "itemData" year_d
      JOIN fields year_f ON year_f."fieldID" = year_d."fieldID" AND year_f."fieldName" = 'date'
      JOIN "itemDataValues" year_v ON year_v."valueID" = year_d."valueID"
      WHERE year_d."itemID" = i."itemID" AND ${clauses.join(' AND ')}
    )`);
  }

  const needle = q == null ? '' : String(q).trim();
  if (needle) {
    params.push(`%${needle}%`);
    const likeParam = `$${params.length}`;
    params.push(needle);
    const ftsParam = `$${params.length}`;
    where.push(`(
      EXISTS (
        SELECT 1 FROM "itemData" search_d
        JOIN fields search_f ON search_f."fieldID" = search_d."fieldID"
        JOIN "itemDataValues" search_v ON search_v."valueID" = search_d."valueID"
        WHERE search_d."itemID" = i."itemID"
          AND search_f."fieldName" IN ('title','abstractNote','publicationTitle','DOI')
          AND search_v.value ILIKE ${likeParam}
      )
      OR EXISTS (
        SELECT 1 FROM "itemCreators" search_ic
        JOIN creators search_c ON search_c."creatorID" = search_ic."creatorID"
        WHERE search_ic."itemID" = i."itemID"
          AND (COALESCE(search_c."firstName", '') || ' ' || COALESCE(search_c."lastName", '')) ILIKE ${likeParam}
      )
      OR EXISTS (
        SELECT 1 FROM "itemFullText" search_ft
        WHERE search_ft."itemID" = i."itemID" AND search_ft.state = 'done'
          AND search_ft.tsv @@ plainto_tsquery('simple', ${ftsParam})
      )
    )`);
  }

  await appendDoiRequiredForArticles(where, params, params.length + 1);
  return { sql: where.join(' AND '), params };
}

export async function getOpenFacets(filters = {}) {
  const { sql, params } = await buildOpenWhere(filters);
  const bundled = await queryOne(`
    WITH matched AS MATERIALIZED (
      SELECT i."itemID", i."itemTypeID"
      FROM items i
      WHERE ${sql}
    ),
    field_rows AS (
      SELECT COALESCE(json_agg(json_build_object('field', field, 'value', value, 'count', count)), '[]'::json) AS rows
      FROM (
        SELECT f."fieldName" AS field, v.value, COUNT(*)::int AS count
        FROM matched i
        JOIN "itemData" d ON d."itemID" = i."itemID"
        JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" IN ('publicationTitle', 'date')
        JOIN "itemDataValues" v ON v."valueID" = d."valueID"
        GROUP BY f."fieldName", v.value
      ) t
    ),
    type_rows AS (
      SELECT COALESCE(
        json_agg(json_build_object('value', value, 'count', count) ORDER BY count DESC, value ASC),
        '[]'::json
      ) AS rows
      FROM (
        SELECT it."typeName" AS value, COUNT(*)::int AS count
        FROM matched i
        JOIN "itemTypes" it ON it."itemTypeID" = i."itemTypeID"
        GROUP BY it."typeName"
      ) t
    ),
    availability AS (
      SELECT json_build_object(
        'withDoi', COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "itemData" d JOIN fields f ON f."fieldID" = d."fieldID"
          WHERE d."itemID" = i."itemID" AND f."fieldName" = 'DOI'
        )),
        'withPdf', COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "itemAttachments" a WHERE a."parentItemID" = i."itemID" AND a.path IS NOT NULL
            AND (lower(COALESCE(a."contentType", '')) LIKE '%pdf%' OR lower(a.path) LIKE '%.pdf')
        )),
        'withMarkdown', COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "itemFullText" ft WHERE ft."itemID" = i."itemID" AND ft.state = 'done'
        ))
      ) AS obj
      FROM matched i
    )
    SELECT field_rows.rows AS "fieldRows",
           type_rows.rows AS "typeRows",
           availability.obj AS availability
    FROM field_rows, type_rows, availability
  `, params);

  const fieldRows = bundled?.fieldRows || [];
  const typeRows = bundled?.typeRows || [];
  const availability = bundled?.availability || { withDoi: 0, withPdf: 0, withMarkdown: 0 };

  const journals = fieldRows
    .filter((row) => row.field === 'publicationTitle' && JOURNAL_WHITELIST.includes(row.value))
    .sort((a, b) => JOURNAL_WHITELIST.indexOf(a.value) - JOURNAL_WHITELIST.indexOf(b.value))
    .map(({ value, count }) => ({ value, count }));
  const yearCounts = new Map();
  for (const row of fieldRows) {
    if (row.field !== 'date') continue;
    const match = String(row.value).match(/\b(1[5-9]|20)\d{2}\b/);
    if (!match) continue;
    const year = Number(match[0]);
    if (year < 1990 || year > new Date().getFullYear() + 1) continue;
    yearCounts.set(year, (yearCounts.get(year) || 0) + row.count);
  }

  return {
    journals,
    years: [...yearCounts].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count })),
    types: typeRows,
    availability,
  };
}

export async function getOpenOverviewStats() {
  const { sql, params } = await buildOpenWhere();
  const row = await queryOne(`
    WITH matched AS MATERIALIZED (
      SELECT i."itemID"
      FROM items i
      WHERE ${sql}
    )
    SELECT
      COUNT(DISTINCT m."itemID")::int AS "totalItems",
      COUNT(DISTINCT ic."creatorID") FILTER (WHERE ct."creatorType" = 'author')::int AS "totalAuthors",
      COUNT(DISTINCT m."itemID") FILTER (WHERE doi_d."itemID" IS NOT NULL)::int AS "withDoi",
      COUNT(DISTINCT m."itemID") FILTER (WHERE pdf."parentItemID" IS NOT NULL)::int AS "withPdf",
      COUNT(DISTINCT m."itemID") FILTER (WHERE ft."itemID" IS NOT NULL)::int AS "withMarkdown"
    FROM matched m
    LEFT JOIN "itemCreators" ic ON ic."itemID" = m."itemID"
    LEFT JOIN "creatorTypes" ct ON ct."creatorTypeID" = ic."creatorTypeID"
    LEFT JOIN "itemData" doi_d ON doi_d."itemID" = m."itemID"
      AND doi_d."fieldID" = (SELECT "fieldID" FROM fields WHERE "fieldName" = 'DOI')
    LEFT JOIN (SELECT DISTINCT "parentItemID" FROM "itemAttachments" WHERE path IS NOT NULL
      AND (lower(COALESCE("contentType", '')) LIKE '%pdf%' OR lower(path) LIKE '%.pdf')) pdf
      ON pdf."parentItemID" = m."itemID"
    LEFT JOIN "itemFullText" ft ON ft."itemID" = m."itemID" AND ft.state = 'done'
  `, params);
  return { ...row, journalCount: JOURNAL_WHITELIST.length };
}

export async function getOpenTimeline(filters = {}) {
  const { sql, params } = await buildOpenWhere(filters);
  const rows = await query(`
    SELECT substring(v.value from '(1[5-9][0-9]{2}|20[0-9]{2})') AS year,
           COUNT(DISTINCT i."itemID")::int AS count
    FROM items i
    JOIN "itemData" d ON d."itemID" = i."itemID"
    JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" = 'date'
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE ${sql}
    GROUP BY year
    HAVING substring(v.value from '(1[5-9][0-9]{2}|20[0-9]{2})') IS NOT NULL
    ORDER BY year ASC
  `, params);
  const maxYear = new Date().getFullYear() + 1;
  return rows.map((row) => ({ year: Number(row.year), count: row.count }))
    .filter((row) => row.year >= 1990 && row.year <= maxYear);
}
