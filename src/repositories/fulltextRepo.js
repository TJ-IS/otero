import { query, queryOne, execute, nowUtc } from '../db/connection.js';

export async function getFullTextRow(itemId) {
  return queryOne('SELECT * FROM "itemFullText" WHERE "itemID"=$1', [itemId]);
}

export async function getFullTextRowByKey(key) {
  return queryOne(
    `
    SELECT f.* FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    WHERE i.key = $1
  `,
    [key],
  );
}

/**
 * Upsert a full-text row. Pass partial fields; nulls clear.
 */
export async function upsertFullText(itemId, patch) {
  const existing = await getFullTextRow(itemId);
  const cols = [
    'state',
    'mineruBatchId',
    'modelVersion',
    'extractedPages',
    'totalPages',
    'markdownPath',
    'assetDir',
    'errCode',
    'errMsg',
    'submittedAt',
    'completedAt',
  ];
  if (existing) {
    const sets = ['"dateModified" = $1'];
    const vals = [nowUtc()];
    let p = 2;
    for (const c of cols) {
      if (patch[c] !== undefined) {
        sets.push(`"${c}" = $${p++}`);
        vals.push(patch[c] ?? null);
      }
    }
    if (sets.length === 1) return existing;
    vals.push(itemId);
    await execute(`UPDATE "itemFullText" SET ${sets.join(', ')} WHERE "itemID"=$${p}`, vals);
  } else {
    const colNames = ['"itemID"'];
    const placeholders = ['$1'];
    const colVals = [itemId];
    let p = 2;
    for (const c of cols) {
      if (patch[c] !== undefined) {
        colNames.push(`"${c}"`);
        placeholders.push(`$${p++}`);
        colVals.push(patch[c] ?? null);
      }
    }
    await execute(
      `INSERT INTO "itemFullText" (${colNames.join(', ')}) VALUES (${placeholders.join(', ')})`,
      colVals,
    );
  }
  return getFullTextRow(itemId);
}

export async function listPendingFullText() {
  return query(`
    SELECT f.*, i.key AS "itemKey" FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    WHERE f.state IN ('pending','running','converting')
  `);
}

export async function listSubmittingFullText() {
  return query(`
    SELECT f.*, i.key AS "itemKey" FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    WHERE f.state = 'submitting'
  `);
}

export async function listFailedFullText() {
  return query(`
    SELECT f.*, i.key AS "itemKey" FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    WHERE f.state = 'failed'
    ORDER BY f."dateModified" ASC
  `);
}

export async function listAllFullText() {
  return query(`
    SELECT f.*, i.key AS "itemKey",
      (SELECT v.value FROM "itemData" d
        JOIN "itemDataValues" v ON v."valueID" = d."valueID"
        WHERE d."itemID" = i."itemID"
          AND d."fieldID" = (SELECT "fieldID" FROM fields WHERE "fieldName" = 'title')
      ) AS title
    FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    ORDER BY f."dateModified" DESC
  `);
}

const STATE_GROUPS = {
  all: null,
  active: ['submitting', 'pending', 'running', 'converting'],
  done: ['done'],
  failed: ['failed'],
};

export async function listFullTextPaged({ filter = 'all', page = 1, pageSize = 50 } = {}) {
  const states = STATE_GROUPS[filter] ?? null;
  let where = '';
  const params = [];
  let p = 1;
  if (states && states.length) {
    where = `WHERE f.state IN (${states.map(() => `$${p++}`).join(',')})`;
    params.push(...states);
  }
  const totalRow = await queryOne(
    `SELECT COUNT(*)::int AS n FROM "itemFullText" f ${where}`,
    params,
  );
  const offset = Math.max(0, (page - 1) * pageSize);
  const items = await query(
    `
    SELECT f.*, i.key AS "itemKey",
      (SELECT v.value FROM "itemData" d
        JOIN "itemDataValues" v ON v."valueID" = d."valueID"
        WHERE d."itemID" = i."itemID"
          AND d."fieldID" = (SELECT "fieldID" FROM fields WHERE "fieldName" = 'title')
      ) AS title
    FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    ${where}
    ORDER BY f."dateModified" DESC
    LIMIT $${p++} OFFSET $${p++}
  `,
    [...params, pageSize, offset],
  );
  return { items, total: totalRow.n };
}

export async function getFullTextCounts() {
  const rows = await query('SELECT state, COUNT(*)::int AS n FROM "itemFullText" GROUP BY state');
  const out = {};
  for (const r of rows) out[r.state] = r.n;
  return out;
}

export async function deleteFullTextRow(itemId) {
  await execute('DELETE FROM "itemFullText" WHERE "itemID"=$1', [itemId]);
}
