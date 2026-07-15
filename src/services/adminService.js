/**
 * Admin service for whitelist management and system monitoring.
 */
import { getPool, query, queryOne } from '../db/connection.js';
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

/**
 * Get detailed database connection status for PostgreSQL.
 */
export async function getPostgresStatus() {
  const pool = getPool();

  try {
    // Get connection pool stats
    const poolStats = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };

    // Test connection and get server info
    const versionResult = await queryOne('SELECT version()');
    const currentTimeResult = await queryOne('SELECT NOW() AT TIME ZONE \'UTC\' as server_time');

    // Get database size
    const dbSizeResult = await queryOne(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as db_size,
             pg_database_size(current_database()) as db_size_bytes
    `);

    // Get table sizes. Use the pg_class OID directly instead of building a
    // "schema.table" string and casting to regclass: unquoted identifiers get
    // folded to lowercase, so mixed-case tables like "itemFullText" would raise
    // relation "public.itemfulltext" does not exist and fail the whole status.
    const tableSizes = await query(`
      SELECT n.nspname AS schemaname, c.relname AS tablename,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
             pg_total_relation_size(c.oid) AS size_bytes
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 10
    `);

    // Get connection count
    const connectionStats = await queryOne(`
      SELECT count(*) as total_connections,
             count(*) FILTER (WHERE state = 'active') as active_connections,
             count(*) FILTER (WHERE state = 'idle') as idle_connections
      FROM pg_stat_activity
      WHERE datname = current_database()
    `);

    // Get schema version
    const schemaVersionResult = await queryOne(
      'SELECT version, "appliedAt" FROM "schemaVersion" ORDER BY version DESC LIMIT 1'
    );

    return {
      status: 'connected',
      connection: {
        url: maskConnectionString(config.databaseUrl),
        poolStats,
      },
      server: {
        version: versionResult?.version || 'unknown',
        serverTime: currentTimeResult?.server_time || null,
      },
      database: {
        name: config.databaseUrl.split('/').pop()?.split('?')[0] || 'unknown',
        size: dbSizeResult?.db_size || 'unknown',
        sizeBytes: dbSizeResult?.db_size_bytes || 0,
        schemaVersion: schemaVersionResult?.version || null,
        schemaAppliedAt: schemaVersionResult?.appliedAt || null,
      },
      connections: connectionStats,
      tables: tableSizes,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message,
      connection: {
        url: maskConnectionString(config.databaseUrl),
      },
      timestamp: new Date().toISOString(),
    };
  }
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

    // Try to list objects to verify connection
    const bucketName = s3Config.bucket;

    // Get bucket info (this will throw if connection fails)
    let bucketExists = false;
    let objectCount = 0;
    let totalSize = 0;

    try {
      // Try to stat the bucket and list objects
      const stream = s3Client.listObjectsV2(bucketName, '', false);

      const objects = [];
      await new Promise((resolve, reject) => {
        stream.on('data', obj => objects.push(obj));
        stream.on('error', reject);
        stream.on('end', resolve);
      });

      bucketExists = true;
      objectCount = objects.length;
      totalSize = objects.reduce((sum, obj) => sum + (obj.size || 0), 0);
    } catch (err) {
      if (err.code === 'NoSuchBucket') {
        bucketExists = false;
      } else {
        throw err;
      }
    }

    // Get some sample object paths
    const sampleObjects = [];
    try {
      const stream = s3Client.listObjectsV2(bucketName, '', false, '', 5);
      await new Promise((resolve, reject) => {
        stream.on('data', obj => sampleObjects.push({
          name: obj.name,
          size: obj.size,
          lastModified: obj.lastModified,
        }));
        stream.on('error', reject);
        stream.on('end', resolve);
      });
    } catch {
      // Ignore errors in sample listing
    }

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
        objectCount,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
      },
      credentials: {
        accessKey: maskCredential(s3Config.accessKey),
        secretKeySet: !!s3Config.secretKey,
      },
      sampleObjects,
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
  const [postgresStatus, r2Status] = await Promise.all([
    getPostgresStatus(),
    getR2Status(),
  ]);

  // Get item statistics
  const itemStats = await query(`
    SELECT
      COUNT(*) as total_items,
      COUNT(*) FILTER (WHERE deleted = 0) as active_items,
      COUNT(*) FILTER (WHERE deleted = 1) as deleted_items
    FROM items
  `).then(rows => rows[0]).catch(() => ({ total_items: 0, active_items: 0, deleted_items: 0 }));

  const attachmentStats = await query(`
    SELECT COUNT(*) as total_attachments
    FROM "itemAttachments"
  `).then(rows => rows[0]).catch(() => ({ total_attachments: 0 }));

  return {
    postgres: postgresStatus,
    r2: r2Status,
    statistics: {
      items: itemStats,
      attachments: attachmentStats,
    },
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
// Storage reconciliation: compare PostgreSQL references against R2 objects.
// ---------------------------------------------------------------------------

/**
 * Recursively list every object in the R2 bucket as { name, size }.
 * Only used for reconciliation (a full listing is unavoidable there).
 */
function listAllR2Objects() {
  const client = getS3Client();
  const bucket = config.storage.s3.bucket;
  return new Promise((resolve, reject) => {
    const objects = [];
    const stream = client.listObjectsV2(bucket, '', true); // recursive
    stream.on('data', (obj) => {
      // Directory markers have no name/size; skip them.
      if (obj.name) objects.push({ name: obj.name, size: obj.size || 0 });
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(objects));
  });
}

/**
 * Build the exact object names and directory prefixes PostgreSQL expects in
 * storage. Attachments and markdown files are exact names; assetDir denotes a
 * prefix containing all extracted full-text assets.
 */
async function buildDbReferenceSets() {
  const attachmentRows = await query(`
    SELECT i.key AS key, a.path AS path, i.deleted AS deleted
    FROM "itemAttachments" a
    JOIN items i ON i."itemID" = a."itemID"
    WHERE a.path IS NOT NULL AND a.path <> ''
  `);

  const exactPaths = new Map();
  for (const r of attachmentRows) {
    const norm = normalizeObjectName(r.path);
    exactPaths.set(norm, { key: r.key, deleted: Boolean(r.deleted), type: 'attachment' });
  }

  const ftRows = await query(`
    SELECT i.key AS key, i.deleted AS deleted,
           f."markdownPath" AS "markdownPath", f."assetDir" AS "assetDir"
    FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    WHERE (f."markdownPath" IS NOT NULL AND f."markdownPath" <> '')
       OR (f."assetDir" IS NOT NULL AND f."assetDir" <> '')
  `).catch(() => []);

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

/**
 * Reconcile PostgreSQL references against R2 objects.
 *   - missingInR2: attachment/full-text references PostgreSQL has but R2 lacks.
 *   - orphanInR2:  objects present in R2 that no PostgreSQL row references.
 *
 * Lists are capped at RECON_LIST_CAP entries each; full counts are always exact.
 */
export async function reconcileStorage() {
  if (!useS3()) {
    return {
      status: 'not_applicable',
      storageType: 'filesystem',
      message: '当前为本地文件系统存储，无需与 R2 对账。',
    };
  }

  const [refs, objects] = await Promise.all([
    buildDbReferenceSets(),
    listAllR2Objects(),
  ]);
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
    try {
      // statObject prevents a missing key from being reported as deleted;
      // removeObject errors are intentionally allowed to reach this result.
      await client.statObject(bucket, name);
      await client.removeObject(bucket, name);
      deleted.push(name);
    } catch (err) {
      skipped.push({ name, reason: err.message });
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
