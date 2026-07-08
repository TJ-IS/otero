import { getDb } from '../db/connection.js';

export function getFullTextRow(itemId) {
  return getDb().prepare('SELECT * FROM itemFullText WHERE itemID=?').get(itemId);
}

export function getFullTextRowByKey(key) {
  return getDb().prepare(`
    SELECT f.* FROM itemFullText f
    JOIN items i ON i.itemID = f.itemID
    WHERE i.key = ?
  `).get(key);
}

/**
 * Upsert a full-text row. Pass partial fields; nulls clear.
 */
export function upsertFullText(itemId, patch) {
  const db = getDb();
  const existing = getFullTextRow(itemId);
  const cols = [
    'state', 'mineruBatchId', 'modelVersion', 'extractedPages', 'totalPages',
    'markdownPath', 'assetDir', 'errCode', 'errMsg', 'submittedAt', 'completedAt',
  ];
  if (existing) {
    const sets = ['dateModified = datetime(\'now\')'];
    const vals = [];
    for (const c of cols) {
      if (patch[c] !== undefined) {
        sets.push(`${c} = ?`);
        vals.push(patch[c] ?? null);
      }
    }
    if (sets.length === 1) return existing; // nothing to update
    vals.push(itemId);
    db.prepare(`UPDATE itemFullText SET ${sets.join(', ')} WHERE itemID=?`).run(...vals);
  } else {
    const colNames = ['itemID'];
    const colVals = [itemId];
    for (const c of cols) {
      if (patch[c] !== undefined) {
        colNames.push(c);
        colVals.push(patch[c] ?? null);
      }
    }
    db.prepare(`INSERT INTO itemFullText (${colNames.join(', ')}) VALUES (${colNames.map(() => '?').join(', ')})`)
      .run(...colVals);
  }
  return getFullTextRow(itemId);
}

export function listPendingFullText() {
  return getDb().prepare(`
    SELECT f.*, i.key AS itemKey FROM itemFullText f
    JOIN items i ON i.itemID = f.itemID
    WHERE f.state IN ('pending','running','converting')
  `).all();
}

export function listSubmittingFullText() {
  return getDb().prepare(`
    SELECT f.*, i.key AS itemKey FROM itemFullText f
    JOIN items i ON i.itemID = f.itemID
    WHERE f.state = 'submitting'
  `).all();
}

export function listAllFullText() {
  return getDb().prepare(`
    SELECT f.*, i.key AS itemKey,
      (SELECT v.value FROM itemData d
        JOIN itemDataValues v ON v.valueID = d.valueID
        WHERE d.itemID = i.itemID
          AND d.fieldID = (SELECT fieldID FROM fields WHERE fieldName = 'title')
      ) AS title
    FROM itemFullText f
    JOIN items i ON i.itemID = f.itemID
    ORDER BY f.dateModified DESC
  `).all();
}

export function deleteFullTextRow(itemId) {
  getDb().prepare('DELETE FROM itemFullText WHERE itemID=?').run(itemId);
}
