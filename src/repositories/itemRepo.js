import { query, queryOne, execute, withTransaction, nowUtc } from '../db/connection.js';
import { JOURNAL_WHITELIST, UNFILED } from '../services/journalWhitelist.js';

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

async function loadCaches() {
  if (cachesLoaded) return;
  for (const r of await query('SELECT "itemTypeID", "typeName" FROM "itemTypes"')) {
    typeCache.set(r.typeName, r.itemTypeID);
  }
  for (const r of await query('SELECT "fieldID", "fieldName" FROM "fields"')) {
    fieldCache.set(r.fieldName, r.fieldID);
  }
  for (const r of await query('SELECT "creatorTypeID", "creatorType" FROM "creatorTypes"')) {
    creatorCache.set(r.creatorType, r.creatorTypeID);
  }
  for (const r of await query('SELECT "itemTypeID", "fieldID" FROM "itemTypeFields"')) {
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
    client
  );
  if (existing) return existing.valueID;

  // Upsert so concurrent inserts of the same value never abort the
  // surrounding transaction and always return a valueID.
  const row = await queryOne(`
    INSERT INTO "itemDataValues"(value) VALUES ($1)
    ON CONFLICT ((md5(value))) DO UPDATE SET value = "itemDataValues".value
    RETURNING "valueID"
  `, [value], client);
  if (!row?.valueID) {
    throw new Error(`getOrCreateValueId failed for value length=${String(value).length}`);
  }
  return row.valueID;
}

// ---------------------------------------------------------------------------
// Item CRUD
// ---------------------------------------------------------------------------
export async function insertItemRow({
  itemTypeID, key, parentItemID = null, deleted = 0, inPublications = 0,
  dateAdded, dateModified, version = 0,
}, client = null) {
  const now = nowUtc();
  const row = await queryOne(`
    INSERT INTO items("itemTypeID", key, "dateAdded", "dateModified", version, "parentItemID", deleted, "inPublications")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING "itemID"
  `, [
    itemTypeID, key,
    dateAdded ?? now,
    dateModified ?? now,
    version,
    parentItemID,
    deleted,
    inPublications,
  ], client);
  return row.itemID;
}

export async function updateItemModifiedDate(itemId, client = null) {
  await execute(
    'UPDATE items SET "dateModified" = $1 WHERE "itemID"=$2',
    [nowUtc(), itemId],
    client
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
const ITEM_SORT_FIELDS = {
  title: ["LOWER(fields_agg.fields->>'title')"],
  date: ["SUBSTRING(fields_agg.fields->>'date', 1, 4)"],
  // Volume → issue → page-start, numeric. Only the leading digits of each are
  // used (fields may hold "3-4", "12A", etc.), and missing/non-numeric parts
  // sort last (999999). Matches the frontend's old numeric-first comparison.
  vip: [
    "COALESCE(NULLIF(SUBSTRING(fields_agg.fields->>'volume' FROM '^[0-9]+'),'')::INTEGER, 999999)",
    "COALESCE(NULLIF(SUBSTRING(fields_agg.fields->>'issue' FROM '^[0-9]+'),'')::INTEGER, 999999)",
    "COALESCE(NULLIF(SUBSTRING(fields_agg.fields->>'pages' FROM '^[0-9]+'),'')::INTEGER, 999999)",
  ],
  itemType: ['it."typeName"'],
  dateModified: ['i."dateModified"'],
  dateAdded: ['i."dateAdded"'],
};

/**
 * Build the shared WHERE clause + params for item list/count/keys queries.
 * Returns { where, params, p } or null when a filter can never match
 * (e.g. an unknown type name), letting callers short-circuit to an empty result.
 */
async function _buildItemFilter({ type, journal, collection, search, includeDeleted = false }) {
  const where = ['i."parentItemID" IS NULL'];
  const params = [];
  let p = 1;

  if (!includeDeleted) where.push('i.deleted = 0');

  if (type) {
    const typeId = await itemTypeIdByName(type);
    if (typeId == null) return null;
    where.push(`i."itemTypeID" = $${p++}`);
    params.push(typeId);
  }

  if (journal) {
    const jfid = await fieldIdByName('publicationTitle');
    if (jfid) {
      if (journal === UNFILED) {
        const jParam = p++;
        const wlParams = JOURNAL_WHITELIST.map(() => `$${p++}`).join(',');
        where.push(`NOT EXISTS (
          SELECT 1 FROM "itemData" d
          JOIN "itemDataValues" v ON v."valueID"=d."valueID"
          WHERE d."itemID"=i."itemID" AND d."fieldID"=$${jParam} AND v.value IN (${wlParams})
        )`);
        params.push(jfid, ...JOURNAL_WHITELIST);
      } else {
        where.push(`EXISTS (
          SELECT 1 FROM "itemData" d
          JOIN "itemDataValues" v ON v."valueID"=d."valueID"
          WHERE d."itemID"=i."itemID" AND d."fieldID"=$${p++} AND v.value=$${p++}
        )`);
        params.push(jfid, journal);
      }
    }
  }

  if (collection) {
    where.push(`EXISTS (
      SELECT 1 FROM "collectionItems" ci
      JOIN collections c ON c."collectionID"=ci."collectionID"
      WHERE ci."itemID"=i."itemID" AND c.key=$${p++}
    )`);
    params.push(collection);
  }

  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    where.push(`(
      EXISTS (
        SELECT 1 FROM "itemData" d1
        JOIN "itemDataValues" v1 ON v1."valueID"=d1."valueID"
        JOIN fields f1 ON f1."fieldID"=d1."fieldID"
        WHERE d1."itemID"=i."itemID"
          AND f1."fieldName" IN ('title','abstractNote','publicationTitle','DOI')
          AND v1.value ILIKE $${p++}
      )
      OR EXISTS (
        SELECT 1 FROM "itemCreators" ic2
        JOIN creators c2 ON c2."creatorID"=ic2."creatorID"
        WHERE ic2."itemID"=i."itemID"
          AND (COALESCE(c2."firstName",'') || ' ' || COALESCE(c2."lastName",'') ILIKE $${p++}
            OR c2."lastName" ILIKE $${p++}
            OR c2."firstName" ILIKE $${p++})
      )
    )`);
    params.push(like, like, like, like);
  }

  return { where, params, p };
}

export async function listItems({
  type, journal, collection, search, includeDeleted = false,
  page = 1, pageSize = 100, sortField = 'dateModified', sortDir = 'desc',
} = {}) {
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const validPageSize = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 100));
  const validSortDir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const sortCols = ITEM_SORT_FIELDS[sortField] || ITEM_SORT_FIELDS.dateModified;
  // Tie-break on itemID so pagination is stable when the sort key has ties
  // (e.g. many items share a year), preventing duplicated/skipped rows.
  const orderByExpr = `${sortCols.map(c => `${c} ${validSortDir}`).join(', ')}, i."itemID" ${validSortDir}`;

  const empty = { items: [], total: 0, page: validPage, pageSize: validPageSize, totalPages: 0 };
  const filter = await _buildItemFilter({ type, journal, collection, search, includeDeleted });
  if (!filter) return empty;
  const { where, params } = filter;
  let { p } = filter;

  const countRow = await queryOne(
    `SELECT COUNT(*)::int AS cnt FROM items i WHERE ${where.join(' AND ')}`,
    params
  );
  const total = countRow?.cnt || 0;

  const offset = (validPage - 1) * validPageSize;
  const rows = await query(
    `SELECT i.*, it."typeName" AS "itemTypeName",
       COALESCE(fields_agg.fields, '{}'::json) AS fields,
       COALESCE(creators_agg.creators, '[]'::json) AS creators
     FROM items i
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
     ) creators_agg ON true
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderByExpr}
     LIMIT $${p++} OFFSET $${p++}`,
    [...params, validPageSize, offset]
  );

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
export async function listItemKeys({ type, journal, collection, search, includeDeleted = false } = {}) {
  const filter = await _buildItemFilter({ type, journal, collection, search, includeDeleted });
  if (!filter) return [];
  const { where, params } = filter;
  const rows = await query(
    `SELECT i.key FROM items i WHERE ${where.join(' AND ')} ORDER BY i."dateAdded" DESC`,
    params
  );
  return rows.map(r => r.key);
}

export async function listJournals() {
  const jfid = await fieldIdByName('publicationTitle');
  if (!jfid) return [];

  const journals = [];
  for (const name of JOURNAL_WHITELIST) {
    const row = await queryOne(`
      SELECT COUNT(*)::int AS cnt
      FROM "itemData" d
      JOIN "itemDataValues" v ON v."valueID" = d."valueID"
      JOIN items i ON i."itemID" = d."itemID"
      WHERE d."fieldID" = $1 AND i.deleted = 0 AND i."parentItemID" IS NULL
        AND v.value = $2
    `, [jfid, name]);
    journals.push({ name, itemCount: row.cnt });
  }

  const placeholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 2}`).join(',');
  const unfiledRow = await queryOne(`
    SELECT COUNT(*)::int AS cnt
    FROM items i
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "itemData" d
        JOIN "itemDataValues" v ON v."valueID" = d."valueID"
        WHERE d."itemID" = i."itemID" AND d."fieldID" = $1 AND v.value IN (${placeholders})
      )
  `, [jfid, ...JOURNAL_WHITELIST]);
  journals.push({ name: UNFILED, itemCount: unfiledRow.cnt });

  return journals;
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

  const totalRow = await queryOne(`
    SELECT COUNT(*)::int AS cnt
    FROM items i
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID" AND ft.state = 'done'
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${unfiledClause}
  `, baseParams);

  const limit = Math.max(1, pageSize);
  const offset = Math.max(0, (Math.max(1, page) - 1) * limit);
  const tfid = await fieldIdByName('title');
  const titleParam = baseParams.length + 1;
  const limitParam = baseParams.length + 2;
  const offsetParam = baseParams.length + 3;

  const rows = await query(`
    SELECT i."itemID", i.key, i."itemTypeID",
      (SELECT v.value FROM "itemData" d JOIN "itemDataValues" v ON v."valueID"=d."valueID"
       WHERE d."itemID"=i."itemID" AND d."fieldID"=$${titleParam}) AS title
    FROM items i
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID" AND ft.state = 'done'
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${unfiledClause}
    ORDER BY i."dateAdded" DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `, [...baseParams, tfid, limit, offset]);

  return { items: rows, total: totalRow.cnt };
}

export async function setItemDeleted(itemId, deleted) {
  await execute(
    'UPDATE items SET deleted=$1, "dateModified"=$2 WHERE "itemID"=$3',
    [deleted ? 1 : 0, nowUtc(), itemId]
  );
}

// ---------------------------------------------------------------------------
// "itemData" (EAV)
// ---------------------------------------------------------------------------
export async function setItemField(itemId, fieldId, value, client = null) {
  const valueId = await getOrCreateValueId(String(value), client);
  await execute(`
    INSERT INTO "itemData"("itemID", "fieldID", "valueID") VALUES ($1, $2, $3)
    ON CONFLICT ("itemID", "fieldID") DO UPDATE SET "valueID" = EXCLUDED."valueID"
  `, [itemId, fieldId, valueId], client);
}

export async function deleteItemField(itemId, fieldId, client = null) {
  await execute(
    'DELETE FROM "itemData" WHERE "itemID"=$1 AND "fieldID"=$2',
    [itemId, fieldId],
    client
  );
}

export async function getItemFields(itemId) {
  return query(`
    SELECT f."fieldName" AS name, v.value AS value
    FROM "itemData" d
    JOIN fields f ON f."fieldID" = d."fieldID"
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE d."itemID" = $1
  `, [itemId]);
}

export async function getItemField(itemId, fieldName) {
  const fid = await fieldIdByName(fieldName);
  if (fid == null) return null;
  const row = await queryOne(`
    SELECT v.value FROM "itemData" d
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE d."itemID"=$1 AND d."fieldID"=$2
  `, [itemId, fid]);
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
    client
  );
  return row?.creatorID ?? null;
}

export async function getOrCreateCreatorId({ firstName, lastName, fieldMode }, client = null) {
  const existing = await findCreatorId({ firstName, lastName, fieldMode }, client);
  if (existing) return existing;
  const row = await queryOne(
    'INSERT INTO creators("firstName", "lastName", "fieldMode") VALUES ($1, $2, $3) RETURNING "creatorID"',
    [firstName ?? null, lastName ?? null, fieldMode],
    client
  );
  return row.creatorID;
}

export async function setItemCreators(itemId, creators) {
  await withTransaction(async (client) => {
    await execute('DELETE FROM "itemCreators" WHERE "itemID"=$1', [itemId], client);
    const seen = new Set();
    for (const c of creators) {
      const cid = await getOrCreateCreatorId({
        firstName: c.firstName ?? null,
        lastName: c.lastName ?? null,
        fieldMode: c.fieldMode ?? 0,
      }, client);
      const ctid = (await creatorTypeIdByName(c.creatorType))
        ?? (await creatorTypeIdByName('author'));
      const key = `${cid}:${ctid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await execute(`
        INSERT INTO "itemCreators"("itemID", "creatorID", "creatorTypeID", "orderIndex")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
      `, [itemId, cid, ctid, c.orderIndex ?? 0], client);
    }
  });
}

export async function getItemCreators(itemId) {
  return query(`
    SELECT c."creatorID" AS id, c."firstName", c."lastName", c."fieldMode",
           ct."creatorType", ic."orderIndex"
    FROM "itemCreators" ic
    JOIN creators c ON c."creatorID" = ic."creatorID"
    JOIN "creatorTypes" ct ON ct."creatorTypeID" = ic."creatorTypeID"
    WHERE ic."itemID" = $1
    ORDER BY ic."orderIndex"
  `, [itemId]);
}

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------
export async function insertAttachment({
  itemId, parentItemId, linkMode, contentType, charset, path, md5, mtime, syncState = null,
}, client = null) {
  const mtimeInt = mtime == null ? null : Math.round(Number(mtime));
  await execute(`
    INSERT INTO "itemAttachments"("itemID", "parentItemID", "linkMode", "contentType", charset, path, "syncState", md5, mtime)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    itemId, parentItemId ?? null, linkMode, contentType ?? null, charset ?? null,
    path ?? null, syncState, md5 ?? null, mtimeInt,
  ], client);
}

export async function getAttachment(itemId) {
  return queryOne('SELECT * FROM "itemAttachments" WHERE "itemID"=$1', [itemId]);
}

export async function getAttachmentsByParent(parentItemId) {
  return query('SELECT * FROM "itemAttachments" WHERE "parentItemID"=$1', [parentItemId]);
}
