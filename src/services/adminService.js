/**
 * Admin service for whitelist management and system monitoring.
 */
import { execute, getPool, query, queryOne, withTransaction } from '../db/connection.js';
import { config } from '../config.js';
import { useS3 } from './storageService.js';
import { getS3Client } from './s3Client.js';

/**
 * Check for duplicate items in the database.
 * Returns potential duplicates based on DOI, title, or author combinations.
 *
 * @param {Object} options - Search options
 * @param {string} [options.doi] - DOI to check
 * @param {string} [options.title] - Title to check (fuzzy match)
 * @param {string} [options.author] - Author name to check
 * @param {number} [options.limit=50] - Max results
 * @returns {Promise<Object>} Duplicate analysis results
 */
export async function checkDuplicates({ doi, title, author, limit = 50 } = {}) {
  const results = {
    byDoi: [],
    byTitle: [],
    byAuthor: [],
    statistics: {
      totalDuplicateDois: 0,
      totalSimilarTitles: 0,
      totalSharedAuthors: 0,
    },
  };

  // 1. Check for duplicate DOIs
  if (doi) {
    const doiField = await queryOne(`SELECT "fieldID" FROM fields WHERE "fieldName" = 'DOI'`);
    if (doiField) {
      const items = await query(
        `SELECT DISTINCT i."itemID", i.key, i."dateAdded", idv.value as doi
         FROM items i
         JOIN "itemData" id ON i."itemID" = id."itemID"
         JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
         WHERE id."fieldID" = $1 AND LOWER(idv.value) = LOWER($2)
         ORDER BY i."dateAdded" DESC
         LIMIT $3`,
        [doiField.fieldID, doi, limit]
      );
      results.byDoi = items;
    }
  } else {
    // Find all duplicate DOIs in the system
    const doiField = await queryOne(`SELECT "fieldID" FROM fields WHERE "fieldName" = 'DOI'`);
    if (doiField) {
      const duplicates = await query(
        `SELECT idv.value as doi, COUNT(*) as count,
                array_agg(i.key) as item_keys,
                array_agg(i."dateAdded") as dates_added
         FROM items i
         JOIN "itemData" id ON i."itemID" = id."itemID"
         JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
         WHERE id."fieldID" = $1 AND i.deleted = 0
         GROUP BY idv.value
         HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC
         LIMIT $2`,
        [doiField.fieldID, limit]
      );
      results.byDoi = duplicates;
      results.statistics.totalDuplicateDois = duplicates.length;
    }
  }

  // 2. Check for similar titles (case-insensitive, trimmed)
  if (title) {
    const titleField = await queryOne(`SELECT "fieldID" FROM fields WHERE "fieldName" = 'title'`);
    if (titleField) {
      // Exact match first
      const exactMatches = await query(
        `SELECT i."itemID", i.key, i."dateAdded", idv.value as title
         FROM items i
         JOIN "itemData" id ON i."itemID" = id."itemID"
         JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
         WHERE id."fieldID" = $1
           AND LOWER(TRIM(idv.value)) = LOWER(TRIM($2))
           AND i.deleted = 0
         ORDER BY i."dateAdded" DESC
         LIMIT $3`,
        [titleField.fieldID, title, limit]
      );

      // Fuzzy match using similarity (requires pg_trgm extension)
      const fuzzyMatches = await query(
        `SELECT i."itemID", i.key, i."dateAdded", idv.value as title,
                similarity(LOWER(idv.value), LOWER($2)) as similarity_score
         FROM items i
         JOIN "itemData" id ON i."itemID" = id."itemID"
         JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
         WHERE id."fieldID" = $1
           AND LOWER(TRIM(idv.value)) != LOWER(TRIM($2))
           AND similarity(LOWER(idv.value), LOWER($2)) > 0.3
           AND i.deleted = 0
         ORDER BY similarity_score DESC
         LIMIT $3`,
        [titleField.fieldID, title, limit]
      ).catch(() => []); // Gracefully handle if pg_trgm not installed

      results.byTitle = {
        exact: exactMatches,
        fuzzy: fuzzyMatches,
      };
    }
  } else {
    // Find items with duplicate titles
    const titleField = await queryOne(`SELECT "fieldID" FROM fields WHERE "fieldName" = 'title'`);
    if (titleField) {
      const duplicates = await query(
        `SELECT LOWER(TRIM(idv.value)) as normalized_title,
                COUNT(*) as count,
                array_agg(i.key) as item_keys,
                array_agg(idv.value) as original_titles
         FROM items i
         JOIN "itemData" id ON i."itemID" = id."itemID"
         JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
         WHERE id."fieldID" = $1 AND i.deleted = 0
         GROUP BY LOWER(TRIM(idv.value))
         HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC
         LIMIT $2`,
        [titleField.fieldID, limit]
      );
      results.byTitle = duplicates;
      results.statistics.totalSimilarTitles = duplicates.length;
    }
  }

  // 3. Check for shared authors
  if (author) {
    const items = await query(
      `SELECT DISTINCT i."itemID", i.key, i."dateAdded",
              c."firstName", c."lastName"
       FROM items i
       JOIN "itemCreators" ic ON i."itemID" = ic."itemID"
       JOIN creators c ON ic."creatorID" = c."creatorID"
       WHERE (LOWER(c."firstName") LIKE LOWER($1)
              OR LOWER(c."lastName") LIKE LOWER($1))
         AND i.deleted = 0
       ORDER BY i."dateAdded" DESC
       LIMIT $2`,
      [`%${author}%`, limit]
    );
    results.byAuthor = items;
  }

  return results;
}

/**
 * Get all duplicate groups in the system.
 * This is useful for bulk deduplication operations.
 */
export async function getAllDuplicates() {
  const doiField = await queryOne(`SELECT "fieldID" FROM fields WHERE "fieldName" = 'DOI'`);
  const titleField = await queryOne(`SELECT "fieldID" FROM fields WHERE "fieldName" = 'title'`);

  const result = {
    duplicateDois: [],
    duplicateTitles: [],
    summary: {
      totalDoiDuplicates: 0,
      totalTitleDuplicates: 0,
      affectedItems: 0,
    },
  };

  // Get DOI duplicates
  if (doiField) {
    result.duplicateDois = await query(
      `SELECT idv.value as doi,
              COUNT(*) as count,
              array_agg(i."itemID" ORDER BY i."dateAdded") as item_ids,
              array_agg(i.key ORDER BY i."dateAdded") as item_keys,
              array_agg(i."dateAdded" ORDER BY i."dateAdded") as dates_added
       FROM items i
       JOIN "itemData" id ON i."itemID" = id."itemID"
       JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
       WHERE id."fieldID" = $1 AND i.deleted = 0
       GROUP BY idv.value
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC`,
      [doiField.fieldID]
    );
    result.summary.totalDoiDuplicates = result.duplicateDois.length;
  }

  // Get title duplicates
  if (titleField) {
    result.duplicateTitles = await query(
      `SELECT LOWER(TRIM(idv.value)) as normalized_title,
              COUNT(*) as count,
              array_agg(i."itemID" ORDER BY i."dateAdded") as item_ids,
              array_agg(i.key ORDER BY i."dateAdded") as item_keys,
              array_agg(idv.value) as original_titles
       FROM items i
       JOIN "itemData" id ON i."itemID" = id."itemID"
       JOIN "itemDataValues" idv ON id."valueID" = idv."valueID"
       WHERE id."fieldID" = $1 AND i.deleted = 0
       GROUP BY LOWER(TRIM(idv.value))
       HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC`,
      [titleField.fieldID]
    );
    result.summary.totalTitleDuplicates = result.duplicateTitles.length;
  }

  result.summary.affectedItems =
    result.duplicateDois.reduce((sum, d) => sum + parseInt(d.count), 0) +
    result.duplicateTitles.reduce((sum, d) => sum + parseInt(d.count), 0);

  return result;
}

/** Fetch the complete admin PostgreSQL snapshot in a single network round trip. */
async function getPostgresSnapshot() {
  const pool = getPool();

  try {
    // Get connection pool stats
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    // Keep all independent observations inside one statement. On a remote Neon
    // database this avoids eight sequential client/server round trips.
    const snapshot = await queryOne(`
      WITH table_sizes AS (
        SELECT n.nspname AS schemaname, c.relname AS tablename,
               pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
               pg_total_relation_size(c.oid) AS size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT 10
      )
      SELECT
        version() AS version,
        NOW() AT TIME ZONE 'UTC' AS server_time,
        pg_size_pretty(pg_database_size(current_database())) AS db_size,
        pg_database_size(current_database()) AS db_size_bytes,
        (
          SELECT json_build_object(
            'total_connections', count(*),
            'active_connections', count(*) FILTER (WHERE state = 'active'),
            'idle_connections', count(*) FILTER (WHERE state = 'idle')
          )
          FROM pg_stat_activity
          WHERE datname = current_database()
        ) AS connections,
        COALESCE(
          (SELECT json_agg(row_to_json(t) ORDER BY t.size_bytes DESC) FROM table_sizes t),
          '[]'::json
        ) AS tables,
        (SELECT version FROM "schemaVersion" ORDER BY version DESC LIMIT 1) AS schema_version,
        (SELECT "appliedAt" FROM "schemaVersion" ORDER BY version DESC LIMIT 1) AS schema_applied_at,
        (
          SELECT json_build_object(
            'total_items', count(*),
            'active_items', count(*) FILTER (WHERE deleted = 0),
            'deleted_items', count(*) FILTER (WHERE deleted = 1)
          )
          FROM items
        ) AS item_stats,
        (
          SELECT json_build_object('total_attachments', count(*))
          FROM "itemAttachments"
        ) AS attachment_stats
    `);

    return {
      status: 'connected',
      connection: {
        url: maskConnectionString(config.databaseUrl),
        poolStats,
      },
      server: {
        version: snapshot?.version || 'unknown',
        serverTime: snapshot?.server_time || null,
      },
      database: {
        name: config.databaseUrl.split('/').pop()?.split('?')[0] || 'unknown',
        size: snapshot?.db_size || 'unknown',
        sizeBytes: snapshot?.db_size_bytes || 0,
        schemaVersion: snapshot?.schema_version || null,
        schemaAppliedAt: snapshot?.schema_applied_at || null,
      },
      connections: snapshot?.connections || null,
      tables: snapshot?.tables || [],
      statistics: {
        items: snapshot?.item_stats || { total_items: 0, active_items: 0, deleted_items: 0 },
        attachments: snapshot?.attachment_stats || { total_attachments: 0 },
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      connection: {
        url: maskConnectionString(config.databaseUrl),
      },
      statistics: {
        items: { total_items: 0, active_items: 0, deleted_items: 0 },
        attachments: { total_attachments: 0 },
      },
      timestamp: new Date().toISOString(),
    };
  }
}

/** Get detailed database connection status for PostgreSQL. */
export async function getPostgresStatus() {
  const { statistics: _statistics, ...status } = await getPostgresSnapshot();
  return status;
}

/**
 * Get detailed connection status for Cloudflare R2 (S3-compatible storage).
 */
export async function getR2Status() {
  if (!useS3()) {
    return {
      status: 'not_configured',
      storageType: 'filesystem',
      localPath: config.storageDir,
      message: 'Using local filesystem storage',
    };
  }

  try {
    const s3Client = getS3Client();
    const s3Config = config.storage.s3;

    const bucketName = s3Config.bucket;
    // A status page only needs a cheap health probe. Listing the bucket made
    // latency grow with object count and the old sample request listed it twice.
    const bucketExists = await s3Client.bucketExists(bucketName);

    return {
      status: bucketExists ? 'connected' : 'bucket_not_found',
      storageType: 's3',
      endpoint: {
        url: s3Config.endpoint,
        port: s3Config.port,
        useSSL: s3Config.useSSL,
        region: s3Config.region,
      },
      bucket: {
        name: bucketName,
        exists: bucketExists,
      },
      credentials: {
        accessKey: maskCredential(s3Config.accessKey),
        secretKeySet: !!s3Config.secretKey,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      storageType: 's3',
      error: error.message,
      errorCode: error.code,
      endpoint: {
        url: config.storage.s3.endpoint,
        port: config.storage.s3.port,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Get combined system status (both PostgreSQL and R2).
 */
export async function getSystemStatus() {
  const [postgresSnapshot, r2Status] = await Promise.all([
    getPostgresSnapshot(),
    getR2Status(),
  ]);
  const { statistics, ...postgresStatus } = postgresSnapshot;

  return {
    postgres: postgresStatus,
    r2: r2Status,
    statistics,
    config: {
      nodeVersion: process.version,
      platform: process.platform,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Trash: inspect and permanently remove soft-deleted item trees.
// ---------------------------------------------------------------------------

/**
 * List the roots of soft-deleted item trees in one paginated query.
 * A deleted child whose parent is still active is also treated as a root so
 * every soft-deleted row remains reachable from the admin trash page.
 */
export async function getTrash({ page = 1, pageSize = 50 } = {}) {
  const validPage = Math.max(1, Number.parseInt(page, 10) || 1);
  const validPageSize = Math.min(100, Math.max(1, Number.parseInt(pageSize, 10) || 50));
  const offset = (validPage - 1) * validPageSize;

  const snapshot = await queryOne(`
    WITH RECURSIVE item_edges AS (
      SELECT "itemID" AS child, "parentItemID" AS parent
      FROM items WHERE "parentItemID" IS NOT NULL
      UNION
      SELECT "itemID", "parentItemID" FROM "itemAttachments" WHERE "parentItemID" IS NOT NULL
      UNION
      SELECT "itemID", "parentItemID" FROM "itemNotes" WHERE "parentItemID" IS NOT NULL
      UNION
      SELECT "itemID", "parentItemID" FROM "itemAnnotations" WHERE "parentItemID" IS NOT NULL
    ), roots AS (
      SELECT i."itemID", i.key, i."itemTypeID", i."dateAdded", i."dateModified"
      FROM items i
      WHERE i.deleted = 1
        AND NOT EXISTS (
          SELECT 1
          FROM item_edges edge
          JOIN items parent ON parent."itemID" = edge.parent
          WHERE edge.child = i."itemID" AND parent.deleted = 1
        )
    ), trash_tree AS (
      SELECT r."itemID", r."itemID" AS "rootItemID" FROM roots r
      UNION
      SELECT edge.child, tree."rootItemID"
      FROM item_edges edge
      JOIN trash_tree tree ON edge.parent = tree."itemID"
    ), page_rows AS (
      SELECT r."itemID" AS id, r.key, it."typeName" AS "itemType",
             r."dateAdded", r."dateModified" AS "deletedAt",
             COALESCE((
               SELECT v.value
               FROM "itemData" d
               JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" = 'title'
               JOIN "itemDataValues" v ON v."valueID" = d."valueID"
               WHERE d."itemID" = r."itemID"
               LIMIT 1
             ), '(无标题)') AS title,
             (SELECT COUNT(*)::int - 1 FROM trash_tree t WHERE t."rootItemID" = r."itemID") AS "childCount"
      FROM roots r
      JOIN "itemTypes" it ON it."itemTypeID" = r."itemTypeID"
      ORDER BY r."dateModified" DESC, r."itemID" DESC
      LIMIT $1 OFFSET $2
    )
    SELECT
      (SELECT COUNT(*)::int FROM roots) AS total,
      (SELECT GREATEST(COUNT(*)::int - (SELECT COUNT(*)::int FROM roots), 0) FROM trash_tree) AS "childItems",
      COALESCE(
        (SELECT json_agg(row_to_json(p) ORDER BY p."deletedAt" DESC, p.id DESC) FROM page_rows p),
        '[]'::json
      ) AS items
  `, [validPageSize, offset]);

  const total = snapshot?.total || 0;
  return {
    items: snapshot?.items || [],
    total,
    childItems: snapshot?.childItems || 0,
    page: validPage,
    pageSize: validPageSize,
    totalPages: Math.max(1, Math.ceil(total / validPageSize)),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Permanently delete every soft-deleted item tree in a single transaction.
 * PostgreSQL can reuse the freed pages after normal vacuuming; physical file
 * size is not expected to shrink immediately.
 */
export async function emptyTrash() {
  return withTransaction(emptyTrashWithClient);
}

/** Transaction body exported for focused, non-destructive unit testing. */
export async function emptyTrashWithClient(client) {
  const selection = await queryOne(`
      WITH RECURSIVE item_edges AS (
        SELECT "itemID" AS child, "parentItemID" AS parent
        FROM items WHERE "parentItemID" IS NOT NULL
        UNION
        SELECT "itemID", "parentItemID" FROM "itemAttachments" WHERE "parentItemID" IS NOT NULL
        UNION
        SELECT "itemID", "parentItemID" FROM "itemNotes" WHERE "parentItemID" IS NOT NULL
        UNION
        SELECT "itemID", "parentItemID" FROM "itemAnnotations" WHERE "parentItemID" IS NOT NULL
      ), roots AS (
        SELECT i."itemID"
        FROM items i
        WHERE i.deleted = 1
          AND NOT EXISTS (
            SELECT 1
            FROM item_edges edge
            JOIN items parent ON parent."itemID" = edge.parent
            WHERE edge.child = i."itemID" AND parent.deleted = 1
          )
      ), trash_tree AS (
        SELECT r."itemID" FROM roots r
        UNION
        SELECT edge.child
        FROM item_edges edge
        JOIN trash_tree tree ON edge.parent = tree."itemID"
      )
      SELECT
        (SELECT COUNT(*)::int FROM roots) AS "rootItems",
        COALESCE(array_agg("itemID"), ARRAY[]::integer[]) AS ids
      FROM trash_tree
    `, [], client);

  const ids = selection?.ids || [];
  if (ids.length === 0) {
    return {
      rootItems: 0,
      deletedItems: 0,
      orphanCreators: 0,
      orphanValues: 0,
      timestamp: new Date().toISOString(),
    };
  }

  // Some migrated attachment/note rows carry their parent relationship only
  // in the subtype table, not items.parentItemID. Remove those referencing rows
  // explicitly before deleting items so immediate parent FKs cannot block the
  // bulk purge. The outer transaction keeps this atomic.
  await execute('DELETE FROM "itemAttachments" WHERE "itemID" = ANY($1::integer[])', [ids], client);
  await execute('DELETE FROM "itemNotes" WHERE "itemID" = ANY($1::integer[])', [ids], client);
  await execute('DELETE FROM "itemAnnotations" WHERE "itemID" = ANY($1::integer[])', [ids], client);
  const deleted = await execute('DELETE FROM items WHERE "itemID" = ANY($1::integer[])', [ids], client);

  // Item rows cascade into itemCreators/itemData. Remove dictionary values
  // that no remaining item references so the purge also reclaims their space.
  const creators = await execute(`
      DELETE FROM creators c
      WHERE NOT EXISTS (
        SELECT 1 FROM "itemCreators" ic WHERE ic."creatorID" = c."creatorID"
      )
    `, [], client);
  const values = await execute(`
      DELETE FROM "itemDataValues" v
      WHERE NOT EXISTS (
        SELECT 1 FROM "itemData" d WHERE d."valueID" = v."valueID"
      )
    `, [], client);

  return {
    rootItems: selection?.rootItems || 0,
    deletedItems: deleted.rowCount,
    orphanCreators: creators.rowCount,
    orphanValues: values.rowCount,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Storage reconciliation: compare PostgreSQL references against R2 objects.
// ---------------------------------------------------------------------------

const R2_LIST_CONCURRENCY = 8;
const R2_LIST_RETRIES = 3;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Collect one S3 listing stream, retrying transient R2/network failures. */
async function listR2Entries(prefix, recursive, attempts = R2_LIST_RETRIES) {
  const client = getS3Client();
  const bucket = config.storage.s3.bucket;
  try {
    return await new Promise((resolve, reject) => {
      const entries = [];
      const stream = client.listObjectsV2(bucket, prefix, recursive);
      stream.on('data', entry => entries.push(entry));
      stream.on('error', reject);
      stream.on('end', () => resolve(entries));
    });
  } catch (error) {
    if (attempts <= 1) throw error;
    await delay((R2_LIST_RETRIES - attempts + 1) * 500);
    return listR2Entries(prefix, recursive, attempts - 1);
  }
}

/**
 * List every R2 object using bounded parallel prefix scans.
 *
 * A single recursive ListObjectsV2 stream paginates the entire bucket
 * serially. Otero object names are sharded by their first two key characters,
 * so discover the top-level prefixes and merge them into first-character
 * partitions. This keeps coverage exact (including unexpected prefixes) while
 * allowing independent R2 pages to be fetched concurrently.
 */
async function listAllR2Objects() {
  const topLevel = await listR2Entries('', false);
  const partitions = new Set();
  const rootObjects = [];
  for (const entry of topLevel) {
    if (entry.prefix) partitions.add(entry.prefix[0]);
    else if (entry.name) rootObjects.push({ name: entry.name, size: entry.size || 0 });
  }

  const prefixes = [...partitions];
  const objects = rootObjects.filter(obj => !partitions.has(obj.name[0]));
  let cursor = 0;
  async function worker() {
    while (cursor < prefixes.length) {
      const prefix = prefixes[cursor++];
      const entries = await listR2Entries(prefix, true);
      for (const entry of entries) {
        if (entry.name) objects.push({ name: entry.name, size: entry.size || 0 });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(R2_LIST_CONCURRENCY, prefixes.length) }, worker)
  );
  return objects;
}

/**
 * Build the exact object names and directory prefixes PostgreSQL expects in
 * storage. Attachments and markdown files are exact names; assetDir denotes a
 * prefix containing all extracted full-text assets.
 */
async function buildDbReferenceSets() {
  const [attachmentRows, ftRows] = await Promise.all([
    query(`
      SELECT i.key AS key, a.path AS path, i.deleted AS deleted
      FROM "itemAttachments" a
      JOIN items i ON i."itemID" = a."itemID"
      WHERE a.path IS NOT NULL AND a.path <> ''
    `),
    query(`
      SELECT i.key AS key, i.deleted AS deleted,
             f."markdownPath" AS "markdownPath", f."assetDir" AS "assetDir"
      FROM "itemFullText" f
      JOIN items i ON i."itemID" = f."itemID"
      WHERE (f."markdownPath" IS NOT NULL AND f."markdownPath" <> '')
         OR (f."assetDir" IS NOT NULL AND f."assetDir" <> '')
    `).catch(() => []),
  ]);

  const exactPaths = new Map();
  for (const r of attachmentRows) {
    const norm = normalizeObjectName(r.path);
    exactPaths.set(norm, { key: r.key, deleted: Boolean(r.deleted), type: 'attachment' });
  }

  const prefixes = new Map();
  for (const r of ftRows) {
    const meta = { key: r.key, deleted: Boolean(r.deleted), type: 'fulltext' };
    if (r.markdownPath) exactPaths.set(normalizeObjectName(r.markdownPath), meta);
    if (r.assetDir) prefixes.set(normalizePrefix(r.assetDir), meta);
  }

  return { exactPaths, prefixes };
}

function normalizeObjectName(value) {
  return String(value).replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizePrefix(value) {
  return `${normalizeObjectName(value).replace(/\/+$/, '')}/`;
}

function findReferencedPrefix(name, prefixes) {
  let slash = name.indexOf('/');
  while (slash !== -1) {
    const prefix = name.slice(0, slash + 1);
    const meta = prefixes.get(prefix);
    if (meta) return { prefix, meta };
    slash = name.indexOf('/', slash + 1);
  }
  return null;
}

/**
 * Classify a single R2 object name against the DB reference sets.
 * Returns { referenced: boolean, type: 'attachment'|'fulltext'|'unknown', key }.
 */
function classifyObject(name, { exactPaths, prefixes }) {
  const exact = exactPaths.get(name);
  if (exact) {
    return {
      referenced: true,
      type: exact.type,
      key: exact.key,
      matchedPrefix: findReferencedPrefix(name, prefixes)?.prefix || null,
    };
  }

  const prefixMatch = findReferencedPrefix(name, prefixes);
  if (prefixMatch) {
    return {
      referenced: true,
      type: 'fulltext',
      key: prefixMatch.meta.key,
      matchedPrefix: prefixMatch.prefix,
    };
  }

  const parts = name.split('/');
  const looksLikeFulltext = parts.length >= 3 && parts[2] === 'fulltext';
  return {
    referenced: false,
    type: looksLikeFulltext ? 'fulltext' : 'unknown',
    key: looksLikeFulltext ? parts[1] : null,
  };
}

const RECON_LIST_CAP = 1000;
const RECON_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.OTERO_RECON_CACHE_TTL_MS ?? 5 * 60 * 1000)
);
let reconciliationCache = null;
let reconciliationInFlight = null;

/**
 * Reconcile PostgreSQL references against R2 objects.
 *   - missingInR2: attachment/full-text references PostgreSQL has but R2 lacks.
 *   - orphanInR2:  objects present in R2 that no PostgreSQL row references.
 *
 * Lists are capped at RECON_LIST_CAP entries each; full counts are always exact.
 */
export async function reconcileStorage({ force = false } = {}) {
  if (!useS3()) {
    return {
      status: 'not_applicable',
      storageType: 'filesystem',
      message: '当前为本地文件系统存储，无需与 R2 对账。',
    };
  }

  const now = Date.now();
  if (!force && reconciliationCache && now - reconciliationCache.savedAt < RECON_CACHE_TTL_MS) {
    return { ...reconciliationCache.result, cached: true };
  }
  // A forced refresh should not start a duplicate full-bucket scan when one is
  // already running. Every caller awaits the same in-flight promise.
  if (reconciliationInFlight) return reconciliationInFlight;

  reconciliationInFlight = performStorageReconciliation();
  try {
    const result = await reconciliationInFlight;
    reconciliationCache = { result, savedAt: Date.now() };
    return result;
  } finally {
    reconciliationInFlight = null;
  }
}

async function performStorageReconciliation() {
  const startedAt = Date.now();
  const [refs, objects] = await Promise.all([buildDbReferenceSets(), listAllR2Objects()]);
  const objectNames = new Set(objects.map(o => o.name));

  // Exact paths (attachments and markdown files) must exist by name.
  const missingInR2 = [];
  let missingTotal = 0;
  for (const [path, meta] of refs.exactPaths) {
    if (!objectNames.has(path)) {
      missingTotal++;
      if (missingInR2.length < RECON_LIST_CAP) {
        missingInR2.push({ key: meta.key, path, deleted: meta.deleted, type: meta.type });
      }
    }
  }

  // 2. R2 has it, PostgreSQL references nothing (orphans — safe to delete).
  const orphanInR2 = [];
  let orphanTotal = 0;
  let orphanBytes = 0;
  const presentPrefixes = new Set();
  for (const obj of objects) {
    const cls = classifyObject(obj.name, refs);
    if (cls.matchedPrefix) presentPrefixes.add(cls.matchedPrefix);
    if (!cls.referenced) {
      orphanTotal++;
      orphanBytes += obj.size;
      if (orphanInR2.length < RECON_LIST_CAP) {
        orphanInR2.push({
          name: obj.name,
          size: obj.size,
          sizeFormatted: formatBytes(obj.size),
          type: cls.type,
          key: cls.key,
        });
      }
    }
  }

  // An asset directory is considered present when at least one object exists
  // beneath it. Usually markdownPath is also beneath this prefix, but keeping
  // this check explicit catches incomplete/legacy rows.
  for (const [prefix, meta] of refs.prefixes) {
    if (!presentPrefixes.has(prefix)) {
      missingTotal++;
      if (missingInR2.length < RECON_LIST_CAP) {
        missingInR2.push({ key: meta.key, path: prefix, deleted: meta.deleted, type: 'fulltext-directory' });
      }
    }
  }

  return {
    status: 'ok',
    storageType: 's3',
    bucket: config.storage.s3.bucket,
    summary: {
      dbReferences: refs.exactPaths.size + refs.prefixes.size,
      dbExactObjects: refs.exactPaths.size,
      dbPrefixes: refs.prefixes.size,
      r2Objects: objects.length,
      missingInR2: missingTotal,
      orphanInR2: orphanTotal,
      orphanBytes,
      orphanBytesFormatted: formatBytes(orphanBytes),
    },
    missingInR2,
    orphanInR2,
    listCap: RECON_LIST_CAP,
    truncated: {
      missingInR2: missingTotal > missingInR2.length,
      orphanInR2: orphanTotal > orphanInR2.length,
    },
    cached: false,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Delete R2 objects that are confirmed orphans (no PostgreSQL reference).
 * Each requested object is re-validated against the current DB state before
 * deletion, so a name that became referenced in the meantime is skipped.
 *
 * @param {string[]} names - R2 object names to delete.
 * @returns {Promise<{deleted:string[], skipped:{name:string,reason:string}[]}>}
 */
export async function deleteOrphanObjects(names) {
  if (!useS3()) {
    throw new Error('storage reconciliation delete is only available in S3/R2 mode');
  }
  if (!Array.isArray(names) || names.length === 0) {
    return { deleted: [], skipped: [] };
  }

  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length > RECON_LIST_CAP) {
    throw new Error(`cannot delete more than ${RECON_LIST_CAP} objects at once`);
  }

  const refs = await buildDbReferenceSets();
  const client = getS3Client();
  const bucket = config.storage.s3.bucket;
  const deleted = [];
  const skipped = [];
  const safeNames = [];

  for (const name of uniqueNames) {
    if (typeof name !== 'string' || !name) {
      skipped.push({ name: String(name), reason: 'invalid name' });
      continue;
    }
    const cls = classifyObject(name, refs);
    if (cls.referenced) {
      // Re-validation caught a live reference — refuse to delete.
      skipped.push({ name, reason: `referenced by ${cls.type} (${cls.key})` });
      continue;
    }
    safeNames.push(name);
  }

  if (safeNames.length > 0) {
    try {
      // MinIO/R2 batches this list into the S3 multi-delete API. The previous
      // statObject + removeObject loop cost two serial requests per object.
      await client.removeObjects(bucket, safeNames.map(name => ({ name })));
      deleted.push(...safeNames);
      if (reconciliationCache) {
        const deletedSet = new Set(safeNames);
        const cachedResult = reconciliationCache.result;
        let removedBytes = 0;
        for (const obj of cachedResult.orphanInR2 || []) {
          if (deletedSet.has(obj.name)) removedBytes += obj.size || 0;
        }
        const summary = cachedResult.summary || {};
        const orphanBytes = Math.max(0, (summary.orphanBytes || 0) - removedBytes);
        reconciliationCache = {
          savedAt: Date.now(),
          result: {
            ...cachedResult,
            summary: {
              ...summary,
              r2Objects: Math.max(0, (summary.r2Objects || 0) - safeNames.length),
              orphanInR2: Math.max(0, (summary.orphanInR2 || 0) - safeNames.length),
              orphanBytes,
              orphanBytesFormatted: formatBytes(orphanBytes),
            },
            orphanInR2: (cachedResult.orphanInR2 || []).filter(obj => !deletedSet.has(obj.name)),
          },
        };
      }
    } catch (err) {
      for (const name of safeNames) skipped.push({ name, reason: err.message });
    }
  }

  return { deleted, skipped, timestamp: new Date().toISOString() };
}

// Helper functions
function maskConnectionString(connectionString) {
  if (!connectionString) return '[not configured]';
  try {
    const url = new URL(connectionString);
    if (url.password) {
      url.password = '****';
    }
    return url.toString();
  } catch {
    return '[invalid connection string]';
  }
}

function maskCredential(credential) {
  if (!credential) return '[not set]';
  if (credential.length <= 8) return '****';
  return credential.slice(0, 4) + '****' + credential.slice(-4);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
