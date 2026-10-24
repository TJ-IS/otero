import { query, queryOne, execute, withTransaction, nowUtc } from '../db/connection.js';
import { JOURNAL_WHITELIST, UNFILED } from '../services/journalWhitelist.js';
import { normalizeDoi } from '../utils/doi.js';

// ---------------------------------------------------------------------------
// Lookup helpers for schema names <-> IDs
// ---------------------------------------------------------------------------
const typeCache = new Map();
const fieldCache = new Map();
const creatorCache = new Map();
// itemTypeID -> Set<fieldID> of fields allowed for that type. Preloaded so
// Item.save() can check allowance from memory instead of a query per field.
const allowedFieldsCache = new Map();
let cachesLoaded = false;
let cachesLoading = null;

async function loadCaches() {
  if (cachesLoaded) return;
  if (cachesLoading) return cachesLoading;
  cachesLoading = populateCaches();
  try {
    await cachesLoading;
  } finally {
    cachesLoading = null;
  }
}

async function populateCaches() {
  // These lookup tables are independent. Fetch them concurrently so a remote
  // database costs one network round trip instead of four serial round trips.
  const [types, fields, creatorTypes, allowedFields] = await Promise.all([
    query('SELECT "itemTypeID", "typeName" FROM "itemTypes"'),
    query('SELECT "fieldID", "fieldName" FROM fields'),
    query('SELECT "creatorTypeID", "creatorType" FROM "creatorTypes"'),
    query('SELECT "itemTypeID", "fieldID" FROM "itemTypeFields"'),
  ]);

  for (const r of types) {
    typeCache.set(r.typeName, r.itemTypeID);
  }
  for (const r of fields) {
    fieldCache.set(r.fieldName, r.fieldID);
  }
  for (const r of creatorTypes) {
    creatorCache.set(r.creatorType, r.creatorTypeID);
  }
  for (const r of allowedFields) {
    if (!allowedFieldsCache.has(r.itemTypeID)) allowedFieldsCache.set(r.itemTypeID, new Set());
    allowedFieldsCache.get(r.itemTypeID).add(r.fieldID);
  }
  cachesLoaded = true;
}

/** Reset caches (e.g. after test wipe + reseed). */
export function clearSchemaCaches() {
  typeCache.clear();
  fieldCache.clear();
  creatorCache.clear();
  allowedFieldsCache.clear();
  cachesLoaded = false;
  cachesLoading = null;
}

export async function itemTypeIdByName(name) {
  await loadCaches();
  return typeCache.get(name) ?? null;
}

export async function itemNameById(id) {
  await loadCaches();
  for (const [n, i] of typeCache) if (i === id) return n;
  return null;
}

export async function fieldIdByName(name) {
  await loadCaches();
  return fieldCache.get(name) ?? null;
}

export async function fieldNameById(id) {
  await loadCaches();
  for (const [n, i] of fieldCache) if (i === id) return n;
  return null;
}

export async function creatorTypeIdByName(name) {
  await loadCaches();
  return creatorCache.get(name) ?? null;
}

export async function creatorTypeNameById(id) {
  await loadCaches();
  for (const [n, i] of creatorCache) if (i === id) return n;
  return null;
}

export async function isFieldAllowedForType(itemTypeId, fieldId) {
  await loadCaches();
  return allowedFieldsCache.get(itemTypeId)?.has(fieldId) ?? false;
}

// ---------------------------------------------------------------------------
// "itemDataValues" helpers
// ---------------------------------------------------------------------------
export async function getOrCreateValueId(value, client = null) {
  const existing = await queryOne(
    'SELECT "valueID" FROM "itemDataValues" WHERE md5(value) = md5($1)',
    [value],
    client,
  );
  if (existing) return existing.valueID;

  // Upsert so concurrent inserts of the same value never abort the
  // surrounding transaction and always return a valueID.
  const row = await queryOne(
    `
    INSERT INTO "itemDataValues"(value) VALUES ($1)
    ON CONFLICT ((md5(value))) DO UPDATE SET value = "itemDataValues".value
    RETURNING "valueID"
  `,
    [value],
    client,
  );
  if (!row?.valueID) {
    throw new Error(`getOrCreateValueId failed for value length=${String(value).length}`);
  }
  return row.valueID;
}

// ---------------------------------------------------------------------------
// Item CRUD
// ---------------------------------------------------------------------------
export async function insertItemRow(
  {
    itemTypeID,
    key,
    parentItemID = null,
    deleted = 0,
    inPublications = 0,
    dateAdded,
    dateModified,
    version = 0,
  },
  client = null,
) {
  const now = nowUtc();
  const row = await queryOne(
    `
    INSERT INTO items("itemTypeID", key, "dateAdded", "dateModified", version, "parentItemID", deleted, "inPublications")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING "itemID"
  `,
    [
      itemTypeID,
      key,
      dateAdded ?? now,
      dateModified ?? now,
      version,
      parentItemID,
      deleted,
      inPublications,
    ],
    client,
  );
  return row.itemID;
}

export async function updateItemModifiedDate(itemId, client = null) {
  await execute(
    'UPDATE items SET "dateModified" = $1 WHERE "itemID"=$2',
    [nowUtc(), itemId],
    client,
  );
}

export async function getItemRow(itemId) {
  return queryOne('SELECT * FROM items WHERE "itemID"=$1', [itemId]);
}

export async function getItemByKey(key) {
  return queryOne('SELECT * FROM items WHERE key=$1', [key]);
}

// Whitelisted ORDER BY column expressions. Never interpolate raw user input
// into SQL; callers pass a sortField key that maps to one of these fixed
// expression lists. The sort direction is applied to every column so that a
// multi-column sort (vip) reverses consistently, not just on its last key.
// `hydrate` runs after fields_agg exists. `prepage` uses slim field joins so
// we can LIMIT before building JSON / ts_headline.
const ITEM_SORT_FIELDS = {
  title: {
    hydrate: ["LOWER(fields_agg.fields->>'title')"],
    prepageFields: [{ alias: 'sort_title', field: 'title' }],
    prepage: ['LOWER(sort_title.value)'],
  },
  date: {
    hydrate: ["SUBSTRING(fields_agg.fields->>'date', 1, 4)"],
    prepageFields: [{ alias: 'sort_date', field: 'date' }],
    prepage: ['SUBSTRING(sort_date.value, 1, 4)'],
  },
  // Volume → issue → page-start, numeric. Only the leading digits of each are
  // used (fields may hold "3-4", "12A", etc.), and missing/non-numeric parts
  // sort last (999999). Matches the frontend's old numeric-first comparison.
  vip: {
    hydrate: [
      "COALESCE(NULLIF(SUBSTRING(fields_agg.fields->>'volume' FROM '^[0-9]+'),'')::INTEGER, 999999)",
      "COALESCE(NULLIF(SUBSTRING(fields_agg.fields->>'issue' FROM '^[0-9]+'),'')::INTEGER, 999999)",
      "COALESCE(NULLIF(SUBSTRING(fields_agg.fields->>'pages' FROM '^[0-9]+'),'')::INTEGER, 999999)",
    ],
    prepageFields: [
      { alias: 'sort_volume', field: 'volume' },
      { alias: 'sort_issue', field: 'issue' },
      { alias: 'sort_pages', field: 'pages' },
    ],
    prepage: [
      "COALESCE(NULLIF(SUBSTRING(sort_volume.value FROM '^[0-9]+'),'')::INTEGER, 999999)",
      "COALESCE(NULLIF(SUBSTRING(sort_issue.value FROM '^[0-9]+'),'')::INTEGER, 999999)",
      "COALESCE(NULLIF(SUBSTRING(sort_pages.value FROM '^[0-9]+'),'')::INTEGER, 999999)",
    ],
  },
  itemType: {
    hydrate: ['it."typeName"'],
    prepage: ['sort_it."typeName"'],
    prepageItemType: true,
  },
  dateModified: {
    hydrate: ['i."dateModified"'],
    prepage: ['i."dateModified"'],
  },
  dateAdded: {
    hydrate: ['i."dateAdded"'],
    prepage: ['i."dateAdded"'],
  },
};

const ITEM_HYDRATE_JOINS = `
       JOIN "itemTypes" it ON it."itemTypeID" = i."itemTypeID"
       LEFT JOIN LATERAL (
         SELECT json_object_agg(f."fieldName", v.value) AS fields
         FROM "itemData" d
         JOIN fields f ON f."fieldID" = d."fieldID"
         JOIN "itemDataValues" v ON v."valueID" = d."valueID"
         WHERE d."itemID" = i."itemID"
       ) fields_agg ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'id', c."creatorID", 'firstName', c."firstName", 'lastName', c."lastName",
           'fieldMode', c."fieldMode", 'creatorType', ct."creatorType", 'orderIndex', ic."orderIndex"
         ) ORDER BY ic."orderIndex") AS creators
         FROM "itemCreators" ic
         JOIN creators c ON c."creatorID" = ic."creatorID"
         JOIN "creatorTypes" ct ON ct."creatorTypeID" = ic."creatorTypeID"
         WHERE ic."itemID" = i."itemID"
       ) creators_agg ON true`;

function orderByClause(exprs, dir) {
  return `${exprs.map((c) => `${c} ${dir}`).join(', ')}, i."itemID" ${dir}`;
}

async function appendSlimSortJoins(sortSpec, params, p, itemAlias = 'i') {
  const joins = [];
  for (const { alias, field } of sortSpec.prepageFields || []) {
    const fid = await fieldIdByName(field);
    if (!fid) continue;
    const n = p++;
    params.push(fid);
    joins.push(`LEFT JOIN LATERAL (
      SELECT v.value
      FROM "itemData" d
      JOIN "itemDataValues" v ON v."valueID" = d."valueID"
      WHERE d."itemID" = ${itemAlias}."itemID" AND d."fieldID" = $${n}
    ) ${alias} ON true`);
  }
  if (sortSpec.prepageItemType) {
    joins.push(`JOIN "itemTypes" sort_it ON sort_it."itemTypeID" = ${itemAlias}."itemTypeID"`);
  }
  return { sql: joins.join('\n'), p };
}

/**
 * Match itemIDs by the same three predicates as the previous EXISTS search:
 * metadata ILIKE, author ILIKE, or full-text tsvector. Rank comes only from
 * the FTS branch; other hits contribute 0. Callers take MAX(rank) per item.
 */
async function appendSearchHitsCte(searchQuery, params, p) {
  const qParam = p++;
  const likeParam = p++;
  params.push(searchQuery, `%${searchQuery}%`);
  const fieldIds = [];
  for (const name of ['title', 'abstractNote', 'publicationTitle', 'DOI']) {
    const id = await fieldIdByName(name);
    if (id != null) fieldIds.push(id);
  }
  const fidSql = fieldIds.length
    ? fieldIds
        .map((id) => {
          params.push(id);
          return `$${p++}`;
        })
        .join(',')
    : 'NULL';
  const cte = `search_hits AS MATERIALIZED (
    SELECT u."itemID", MAX(u.rank)::float4 AS rank
    FROM (
      SELECT ft."itemID", ts_rank(ft.tsv, plainto_tsquery('simple', $${qParam})) AS rank
      FROM "itemFullText" ft
      WHERE ft.state = 'done'
        AND ft.tsv @@ plainto_tsquery('simple', $${qParam})
      UNION ALL
      SELECT d."itemID", 0::float4
      FROM "itemData" d
      JOIN "itemDataValues" v ON v."valueID" = d."valueID"
      WHERE d."fieldID" IN (${fidSql})
        AND v.value ILIKE $${likeParam}
      UNION ALL
      SELECT ic."itemID", 0::float4
      FROM "itemCreators" ic
      JOIN creators c ON c."creatorID" = ic."creatorID"
      WHERE COALESCE(c."firstName",'') || ' ' || COALESCE(c."lastName",'') ILIKE $${likeParam}
         OR c."lastName" ILIKE $${likeParam}
         OR c."firstName" ILIKE $${likeParam}
    ) u
    GROUP BY u."itemID"
  )`;
  return {
    cte,
    join: `JOIN search_hits sh ON sh."itemID" = i."itemID"`,
    p,
  };
}

/**
 * Append journal / year / basket-scope constraints. Mutates where + params.
 * Returns the next placeholder index, or null if the filter can never match.
 *
 * @param {object} opts
 * @param {string} [opts.journal] single journal or UNFILED
 * @param {string[]} [opts.journals] multi-journal allow-list (Basket names)
 * @param {number} [opts.yearFrom] inclusive start year
 * @param {number} [opts.yearTo] inclusive end year
 * @param {boolean} [opts.basketOnly] when true and no journal(s), restrict to whitelist
 * @param {boolean} [opts.requireDoiForArticles] journalArticle rows must have a non-empty DOI
 */
export async function appendDoiRequiredForArticles(where, params, p, itemAlias = 'i') {
  const articleTypeId = await itemTypeIdByName('journalArticle');
  if (articleTypeId == null) return p;
  const doiFid = await fieldIdByName('DOI');
  if (!doiFid) {
    where.push(`${itemAlias}."itemTypeID" <> $${p++}`);
    params.push(articleTypeId);
    return p;
  }
  const typeParam = p++;
  const doiParam = p++;
  where.push(`(
    ${itemAlias}."itemTypeID" <> $${typeParam}
    OR EXISTS (
      SELECT 1 FROM "itemData" doi_d
      JOIN "itemDataValues" doi_v ON doi_v."valueID" = doi_d."valueID"
      WHERE doi_d."itemID" = ${itemAlias}."itemID"
        AND doi_d."fieldID" = $${doiParam}
        AND BTRIM(doi_v.value) <> ''
    )
  )`);
  params.push(articleTypeId, doiFid);
  return p;
}

export async function appendItemScopeFilters(
  where,
  params,
  p,
  {
    journal,
    journals,
    yearFrom,
    yearTo,
    basketOnly = false,
    requireDoiForArticles = false,
    joinScope = false,
  } = {},
  joins = [],
) {
  const jfid = await fieldIdByName('publicationTitle');
  const journalList = Array.isArray(journals) ? journals.filter(Boolean) : [];

  const journalValues =
    journal && journal !== UNFILED
      ? [journal]
      : !journal && journalList.length > 0
        ? journalList
        : !journal && basketOnly
          ? JOURNAL_WHITELIST
          : null;

  if (journal === UNFILED) {
    if (!jfid) return null;
    const jParam = p++;
    const wlParams = JOURNAL_WHITELIST.map(() => `$${p++}`).join(',');
    where.push(`NOT EXISTS (
      SELECT 1 FROM "itemData" d
      JOIN "itemDataValues" v ON v."valueID"=d."valueID"
      WHERE d."itemID"=i."itemID" AND d."fieldID"=$${jParam} AND v.value IN (${wlParams})
    )`);
    params.push(jfid, ...JOURNAL_WHITELIST);
  } else if (journalValues) {
    if (!jfid) return null;
    if (joinScope) {
      const jParam = p++;
      const vParam = p++;
      joins.push(
        `JOIN "itemData" scope_jd ON scope_jd."itemID" = i."itemID" AND scope_jd."fieldID" = $${jParam}`,
      );
      joins.push(
        `JOIN "itemDataValues" scope_jv ON scope_jv."valueID" = scope_jd."valueID" AND scope_jv.value = ANY($${vParam}::text[])`,
      );
      params.push(jfid, journalValues);
    } else {
      const jParam = p++;
      const jlParams = journalValues.map(() => `$${p++}`).join(',');
      where.push(`EXISTS (
        SELECT 1 FROM "itemData" d
        JOIN "itemDataValues" v ON v."valueID"=d."valueID"
        WHERE d."itemID"=i."itemID" AND d."fieldID"=$${jParam} AND v.value IN (${jlParams})
      )`);
      params.push(jfid, ...journalValues);
    }
  }

  const hasYearFrom = Number.isInteger(yearFrom);
  const hasYearTo = Number.isInteger(yearTo);
  if (hasYearFrom || hasYearTo) {
    const dfid = await fieldIdByName('date');
    if (!dfid) return null;
    const dParam = p++;
    params.push(dfid);
    // Match the first plausible publication year anywhere in the date string
    // (e.g. "Spring 2020"), consistent with the open API and timeline stats.
    const yearValue = joinScope ? 'scope_yv.value' : 'v.value';
    const yearExpr = `SUBSTRING(${yearValue} FROM '(1[5-9][0-9]{2}|20[0-9]{2})')`;
    const yearConds = [];
    if (hasYearFrom) {
      yearConds.push(`${yearExpr}::int >= $${p++}`);
      params.push(yearFrom);
    }
    if (hasYearTo) {
      yearConds.push(`${yearExpr}::int <= $${p++}`);
      params.push(yearTo);
    }
    if (joinScope) {
      joins.push(
        `JOIN "itemData" scope_yd ON scope_yd."itemID" = i."itemID" AND scope_yd."fieldID" = $${dParam}`,
      );
      joins.push(
        `JOIN "itemDataValues" scope_yv ON scope_yv."valueID" = scope_yd."valueID" AND ${yearConds.join(' AND ')}`,
      );
    } else {
      where.push(`EXISTS (
        SELECT 1 FROM "itemData" d
        JOIN "itemDataValues" v ON v."valueID"=d."valueID"
        WHERE d."itemID"=i."itemID" AND d."fieldID"=$${dParam}
          AND ${yearConds.join(' AND ')}
      )`);
    }
  }

  if (requireDoiForArticles && joinScope) {
    const articleTypeId = await itemTypeIdByName('journalArticle');
    const doiFid = await fieldIdByName('DOI');
    if (articleTypeId == null) {
      /* no-op */
    } else if (!doiFid) {
      where.push(`i."itemTypeID" <> $${p++}`);
      params.push(articleTypeId);
    } else {
      const typeParam = p++;
      const doiParam = p++;
      joins.push(
        `LEFT JOIN "itemData" scope_doi ON scope_doi."itemID" = i."itemID" AND scope_doi."fieldID" = $${doiParam}`,
      );
      joins.push(
        `LEFT JOIN "itemDataValues" scope_doiv ON scope_doiv."valueID" = scope_doi."valueID"`,
      );
      where.push(`(
        i."itemTypeID" <> $${typeParam}
        OR (scope_doiv.value IS NOT NULL AND BTRIM(scope_doiv.value) <> '')
      )`);
      params.push(articleTypeId, doiFid);
    }
  } else if (requireDoiForArticles) {
    p = await appendDoiRequiredForArticles(where, params, p);
  }

  return p;
}

/**
 * Build the shared WHERE clause + params for item list/count/keys queries.
 * Returns { where, params, p } or null when a filter can never match
 * (e.g. an unknown type name), letting callers short-circuit to an empty result.
 */
async function _buildItemFilter({
  type,
  journal,
  journals,
  collection,
  search,
  includeDeleted = false,
  yearFrom,
  yearTo,
  basketOnly = false,
  requireDoiForArticles = false,
  joinScope = false,
} = {}) {
  const where = ['i."parentItemID" IS NULL'];
  const params = [];
  const joins = [];
  let p = 1;

  if (!includeDeleted) where.push('i.deleted = 0');

  if (type) {
    const typeId = await itemTypeIdByName(type);
    if (typeId == null) return null;
    where.push(`i."itemTypeID" = $${p++}`);
    params.push(typeId);
  }

  p = await appendItemScopeFilters(
    where,
    params,
    p,
    {
      journal,
      journals,
      yearFrom,
      yearTo,
      basketOnly,
      requireDoiForArticles,
      joinScope,
    },
    joins,
  );
  if (p == null) return null;

  if (collection) {
    where.push(`EXISTS (
      SELECT 1 FROM "collectionItems" ci
      JOIN collections c ON c."collectionID"=ci."collectionID"
      WHERE ci."itemID"=i."itemID" AND c.key=$${p++}
    )`);
    params.push(collection);
  }

  const searchQuery = search && search.trim() ? search.trim() : null;
  return { where, params, p, searchQuery, joins };
}

export async function listItems({
  type,
  journal,
  journals,
  collection,
  search,
  includeDeleted = false,
  yearFrom,
  yearTo,
  basketOnly = false,
  requireDoiForArticles = false,
  page = 1,
  pageSize = 100,
  sortField = 'dateModified',
  sortDir = 'desc',
} = {}) {
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const validPageSize = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 100));
  const validSortDir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const sortSpec = ITEM_SORT_FIELDS[sortField] || ITEM_SORT_FIELDS.dateModified;

  const empty = { items: [], total: 0, page: validPage, pageSize: validPageSize, totalPages: 0 };
  const filter = await _buildItemFilter({
    type,
    journal,
    journals,
    collection,
    search,
    includeDeleted,
    yearFrom,
    yearTo,
    basketOnly,
    requireDoiForArticles,
    joinScope: true,
  });
  if (!filter) return empty;
  const { where, params: scopeParams, searchQuery, joins } = filter;
  const whereSql = where.join(' AND ');
  const scopeJoins = joins.join('\n');
  const offset = (validPage - 1) * validPageSize;

  const listParams = [...scopeParams];
  let listP = filter.p;
  let searchHitsCte = '';
  let searchJoin = '';
  if (searchQuery) {
    const hits = await appendSearchHitsCte(searchQuery, listParams, listP);
    searchHitsCte = hits.cte;
    searchJoin = hits.join;
    listP = hits.p;
  }
  const slim = await appendSlimSortJoins(sortSpec, listParams, listP);
  listP = slim.p;

  const scopedOrderSql = searchQuery
    ? `sh.rank DESC, ${sortSpec.prepage.map((c) => `${c} ${validSortDir}`).join(', ')}, i."itemID" ${validSortDir}`
    : orderByClause(sortSpec.prepage, validSortDir);

  const limitParam = listP++;
  const offsetParam = listP++;
  listParams.push(validPageSize, offset);

  let ftsSelect = `NULL::text AS "fulltextSnippet", false AS "fulltextHit", 0::float4 AS "fulltextRank"`;
  let headlineJoin = '';
  if (searchQuery) {
    const qIdx = listP++;
    listParams.push(searchQuery);
    ftsSelect = `
       ft_hit."fulltextSnippet" AS "fulltextSnippet",
       COALESCE(ft_hit."fulltextHit", false) AS "fulltextHit",
       COALESCE(i.search_rank, 0)::float4 AS "fulltextRank"`;
    headlineJoin = `
     LEFT JOIN LATERAL (
       SELECT
         regexp_replace(
           ts_headline(
             'simple',
             ft."plainText",
             plainto_tsquery('simple', $${qIdx}),
             'MaxFragments=2, MaxWords=25, MinWords=5, FragmentDelimiter= … '
           ),
           '</?b>',
           '',
           'g'
         ) AS "fulltextSnippet",
         (ft.tsv @@ plainto_tsquery('simple', $${qIdx})) AS "fulltextHit"
       FROM "itemFullText" ft
       WHERE ft."itemID" = i."itemID"
         AND ft.state = 'done'
         AND ft.tsv IS NOT NULL
         AND ft."plainText" IS NOT NULL
     ) ft_hit ON true`;
  }

  const hydrateOrder = searchQuery
    ? `i.search_rank DESC, ${orderByClause(sortSpec.hydrate, validSortDir)}`
    : orderByClause(sortSpec.hydrate, validSortDir);

  const hydrateSql = (source, extraSelect = '') => `
       SELECT i.*, it."typeName" AS "itemTypeName",
       COALESCE(fields_agg.fields, '{}'::json) AS fields,
       COALESCE(creators_agg.creators, '[]'::json) AS creators,
       ${ftsSelect}${extraSelect}
       FROM ${source} i
       ${ITEM_HYDRATE_JOINS}
       ${headlineJoin}
       ORDER BY ${hydrateOrder}`;

  let rows;
  let total;
  if (searchQuery) {
    // One pass: rank every hit, count with a window, then hydrate only the page.
    // A separate COUNT would recompute search_hits and ts_rank.
    const sql = `WITH ${searchHitsCte},
      scoped AS MATERIALIZED (
        SELECT i.*, sh.rank AS search_rank, COUNT(*) OVER()::int AS _total,
          ROW_NUMBER() OVER (ORDER BY ${scopedOrderSql}) AS _rn
        FROM items i
        ${searchJoin}
        ${scopeJoins}
        ${slim.sql}
        WHERE ${whereSql}
      ),
      page_items AS MATERIALIZED (
        SELECT * FROM scoped
        WHERE _rn > $${offsetParam} AND _rn <= $${offsetParam} + $${limitParam}
      )
      ${hydrateSql('page_items')}`;
    rows = await query(sql, listParams);
    total = rows[0]?._total || 0;
  } else {
    const pageCte = `page_items AS MATERIALIZED (
         SELECT i.*
         FROM items i
         ${scopeJoins}
         ${slim.sql}
         WHERE ${whereSql}
         ORDER BY ${scopedOrderSql}
         LIMIT $${limitParam} OFFSET $${offsetParam}
       )`;
    const countParams = [...scopeParams];
    const [countRow, pageRows] = await Promise.all([
      queryOne(
        `SELECT COUNT(*)::int AS cnt FROM items i ${scopeJoins} WHERE ${whereSql}`,
        countParams,
      ),
      query(`WITH ${pageCte} ${hydrateSql('page_items')}`, listParams),
    ]);
    rows = pageRows;
    total = countRow?.cnt || 0;
  }

  return {
    items: rows,
    total,
    page: validPage,
    pageSize: validPageSize,
    totalPages: Math.ceil(total / validPageSize),
  };
}

/**
 * Return only the keys of items matching a filter (no field/creator joins).
 * Used by the "batch parse all" editor action, which needs every key in the
 * filtered set even though the paginated table only holds the loaded pages.
 * Payload is tiny (8-char keys) so this stays cheap even for large libraries.
 */
export async function listItemKeys({
  type,
  journal,
  journals,
  collection,
  search,
  includeDeleted = false,
  yearFrom,
  yearTo,
  basketOnly = false,
  requireDoiForArticles = false,
} = {}) {
  const filter = await _buildItemFilter({
    type,
    journal,
    journals,
    collection,
    search,
    includeDeleted,
    yearFrom,
    yearTo,
    basketOnly,
    requireDoiForArticles,
    joinScope: true,
  });
  if (!filter) return [];
  const { where, params, searchQuery, joins } = filter;
  let searchHitsCte = '';
  let searchJoin = '';
  if (searchQuery) {
    const hits = await appendSearchHitsCte(searchQuery, params, filter.p);
    searchHitsCte = `WITH ${hits.cte} `;
    searchJoin = hits.join;
  }
  const rows = await query(
    `${searchHitsCte}SELECT i.key FROM items i ${searchJoin} ${joins.join(' ')} WHERE ${where.join(' AND ')} ORDER BY i."dateAdded" DESC`,
    params,
  );
  return rows.map((r) => r.key);
}

/**
 * Exact DOI lookup (case-insensitive, normalized). Basket-scoped, top-level only.
 * When multiple items share a DOI, return the most recently modified.
 */
export async function findItemByDoi(doi) {
  const normalized = normalizeDoi(doi);
  if (!normalized) return null;

  const doiFieldId = await fieldIdByName('DOI');
  const jfid = await fieldIdByName('publicationTitle');
  if (!doiFieldId || !jfid) return null;

  // Also match DOI values that still carry a doi.org URL prefix in storage.
  const key = normalized.toLowerCase();
  const wlPlaceholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 4}`).join(',');
  return queryOne(
    `
    SELECT i.*
    FROM items i
    JOIN "itemData" d ON d."itemID" = i."itemID" AND d."fieldID" = $1
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE i.deleted = 0
      AND i."parentItemID" IS NULL
      AND lower(regexp_replace(
            trim(both FROM v.value),
            '^https?://(dx\\.)?doi\\.org/',
            '',
            'i'
          )) = $2
      AND EXISTS (
        SELECT 1 FROM "itemData" dj
        JOIN "itemDataValues" vj ON vj."valueID" = dj."valueID"
        WHERE dj."itemID" = i."itemID" AND dj."fieldID" = $3
          AND vj.value IN (${wlPlaceholders})
      )
    ORDER BY i."dateModified" DESC
    LIMIT 1
  `,
    [doiFieldId, key, jfid, ...JOURNAL_WHITELIST],
  );
}

/**
 * First PDF attachment key for a parent item, or null.
 */
export async function findPdfAttachmentByItemId(parentItemId) {
  const row = await queryOne(
    `
    SELECT i.key
    FROM "itemAttachments" a
    JOIN items i ON i."itemID" = a."itemID"
    WHERE a."parentItemID" = $1
      AND i.deleted = 0
      AND a.path IS NOT NULL
      AND (
        lower(COALESCE(a."contentType", '')) LIKE '%pdf%'
        OR lower(COALESCE(a.path, '')) LIKE '%.pdf'
      )
    ORDER BY i."dateAdded" ASC
    LIMIT 1
  `,
    [parentItemId],
  );
  return row?.key ?? null;
}

export async function listJournals() {
  const jfid = await fieldIdByName('publicationTitle');
  if (!jfid) return [];

  // Preserve whitelist order while calculating all journal buckets and the
  // virtual UNFILED bucket in one statement. The previous implementation ran
  // one COUNT per journal, which multiplied remote-database latency by 12.
  return query(
    `
    WITH targets AS (
      SELECT name, ord
      FROM unnest($2::text[]) WITH ORDINALITY AS target(name, ord)
    ), counts AS (
      SELECT t.name, t.ord, COUNT(i."itemID")::int AS "itemCount"
      FROM targets t
      LEFT JOIN "itemDataValues" v ON v.value = t.name
      LEFT JOIN "itemData" d
        ON d."valueID" = v."valueID" AND d."fieldID" = $1
      LEFT JOIN items i
        ON i."itemID" = d."itemID"
       AND i.deleted = 0
       AND i."parentItemID" IS NULL
      GROUP BY t.name, t.ord
    ), unfiled AS (
      SELECT COUNT(*)::int AS "itemCount"
      FROM items i
      WHERE i.deleted = 0
        AND i."parentItemID" IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "itemData" d
          JOIN "itemDataValues" v ON v."valueID" = d."valueID"
          WHERE d."itemID" = i."itemID"
            AND d."fieldID" = $1
            AND v.value = ANY($2::text[])
        )
    )
    SELECT name, "itemCount"
    FROM (
      SELECT name, "itemCount", ord FROM counts
      UNION ALL
      SELECT $3::text, "itemCount", 2147483647::bigint FROM unfiled
    ) buckets
    ORDER BY ord
  `,
    [jfid, JOURNAL_WHITELIST, UNFILED],
  );
}

export async function listUnfiledWithFulltextDone({ page = 1, pageSize = 100 } = {}) {
  const jfid = await fieldIdByName('publicationTitle');
  if (!jfid) return { items: [], total: 0 };

  const placeholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 2}`).join(',');
  const unfiledClause = `NOT EXISTS (
    SELECT 1 FROM "itemData" d
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE d."itemID" = i."itemID" AND d."fieldID" = $1 AND v.value IN (${placeholders})
  )`;
  const baseParams = [jfid, ...JOURNAL_WHITELIST];

  const totalRow = await queryOne(
    `
    SELECT COUNT(*)::int AS cnt
    FROM items i
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID" AND ft.state = 'done'
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${unfiledClause}
  `,
    baseParams,
  );

  const limit = Math.max(1, pageSize);
  const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
  const tfid = await fieldIdByName('title');
  const titleParam = baseParams.length + 1;
  const limitParam = baseParams.length + 2;
  const offsetParam = baseParams.length + 3;

  const rows = await query(
    `
    SELECT i."itemID", i.key, i."itemTypeID",
      (SELECT v.value FROM "itemData" d JOIN "itemDataValues" v ON v."valueID"=d."valueID"
       WHERE d."itemID"=i."itemID" AND d."fieldID"=$${titleParam}) AS title
    FROM items i
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID" AND ft.state = 'done'
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${unfiledClause}
    ORDER BY i."dateAdded" DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `,
    [...baseParams, tfid, limit, offset],
  );

  return { items: rows, total: totalRow.cnt };
}

export async function setItemDeleted(itemId, deleted) {
  await execute('UPDATE items SET deleted=$1, "dateModified"=$2 WHERE "itemID"=$3', [
    deleted ? 1 : 0,
    nowUtc(),
    itemId,
  ]);
}

// ---------------------------------------------------------------------------
// "itemData" (EAV)
// ---------------------------------------------------------------------------
export async function setItemField(itemId, fieldId, value, client = null) {
  const valueId = await getOrCreateValueId(String(value), client);
  await execute(
    `
    INSERT INTO "itemData"("itemID", "fieldID", "valueID") VALUES ($1, $2, $3)
    ON CONFLICT ("itemID", "fieldID") DO UPDATE SET "valueID" = EXCLUDED."valueID"
  `,
    [itemId, fieldId, valueId],
    client,
  );
}

export async function deleteItemField(itemId, fieldId, client = null) {
  await execute(
    'DELETE FROM "itemData" WHERE "itemID"=$1 AND "fieldID"=$2',
    [itemId, fieldId],
    client,
  );
}

export async function getItemFields(itemId) {
  return query(
    `
    SELECT f."fieldName" AS name, v.value AS value
    FROM "itemData" d
    JOIN fields f ON f."fieldID" = d."fieldID"
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE d."itemID" = $1
  `,
    [itemId],
  );
}

export async function getItemField(itemId, fieldName) {
  const fid = await fieldIdByName(fieldName);
  if (fid == null) return null;
  const row = await queryOne(
    `
    SELECT v.value FROM "itemData" d
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE d."itemID"=$1 AND d."fieldID"=$2
  `,
    [itemId, fid],
  );
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// creators
// ---------------------------------------------------------------------------
export async function findCreatorId({ firstName, lastName, fieldMode }, client = null) {
  const row = await queryOne(
    `SELECT "creatorID" FROM creators
     WHERE "firstName" IS NOT DISTINCT FROM $1
       AND "lastName" IS NOT DISTINCT FROM $2
       AND "fieldMode"=$3`,
    [firstName ?? null, lastName ?? null, fieldMode],
    client,
  );
  return row?.creatorID ?? null;
}

export async function getOrCreateCreatorId({ firstName, lastName, fieldMode }, client = null) {
  const existing = await findCreatorId({ firstName, lastName, fieldMode }, client);
  if (existing) return existing;
  const row = await queryOne(
    'INSERT INTO creators("firstName", "lastName", "fieldMode") VALUES ($1, $2, $3) RETURNING "creatorID"',
    [firstName ?? null, lastName ?? null, fieldMode],
    client,
  );
  return row.creatorID;
}

export async function setItemCreators(itemId, creators) {
  await withTransaction(async (client) => {
    await execute('DELETE FROM "itemCreators" WHERE "itemID"=$1', [itemId], client);
    const seen = new Set();
    for (const c of creators) {
      const cid = await getOrCreateCreatorId(
        {
          firstName: c.firstName ?? null,
          lastName: c.lastName ?? null,
          fieldMode: c.fieldMode ?? 0,
        },
        client,
      );
      const ctid =
        (await creatorTypeIdByName(c.creatorType)) ?? (await creatorTypeIdByName('author'));
      const key = `${cid}:${ctid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await execute(
        `
        INSERT INTO "itemCreators"("itemID", "creatorID", "creatorTypeID", "orderIndex")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `,
        [itemId, cid, ctid, c.orderIndex ?? 0],
        client,
      );
    }
  });
}

export async function getItemCreators(itemId) {
  return query(
    `
    SELECT c."creatorID" AS id, c."firstName", c."lastName", c."fieldMode",
           ct."creatorType", ic."orderIndex"
    FROM "itemCreators" ic
    JOIN creators c ON c."creatorID" = ic."creatorID"
    JOIN "creatorTypes" ct ON ct."creatorTypeID" = ic."creatorTypeID"
    WHERE ic."itemID" = $1
    ORDER BY ic."orderIndex"
  `,
    [itemId],
  );
}

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------
export async function insertAttachment(
  { itemId, parentItemId, linkMode, contentType, charset, path, md5, mtime, syncState = null },
  client = null,
) {
  const mtimeInt = mtime == null ? null : Math.round(Number(mtime));
  await execute(
    `
    INSERT INTO "itemAttachments"("itemID", "parentItemID", "linkMode", "contentType", charset, path, "syncState", md5, mtime)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `,
    [
      itemId,
      parentItemId ?? null,
      linkMode,
      contentType ?? null,
      charset ?? null,
      path ?? null,
      syncState,
      md5 ?? null,
      mtimeInt,
    ],
    client,
  );
}

export async function getAttachment(itemId) {
  return queryOne('SELECT * FROM "itemAttachments" WHERE "itemID"=$1', [itemId]);
}

export async function getAttachmentsByParent(parentItemId) {
  return query('SELECT * FROM "itemAttachments" WHERE "parentItemID"=$1', [parentItemId]);
}
