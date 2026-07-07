import { getDb, tx } from '../db/connection.js';
import { JOURNAL_WHITELIST, UNFILED } from '../services/journalWhitelist.js';

// ---------------------------------------------------------------------------
// Lookup helpers for schema names <-> IDs
// ---------------------------------------------------------------------------
const typeCache = new Map();   // typeName -> itemTypeID
const fieldCache = new Map();  // fieldName -> fieldID
const creatorCache = new Map(); // creatorType -> creatorTypeID

function loadCaches() {
  const db = getDb();
  for (const r of db.prepare('SELECT itemTypeID, typeName FROM itemTypes').iterate()) {
    typeCache.set(r.typeName, r.itemTypeID);
  }
  for (const r of db.prepare('SELECT fieldID, fieldName FROM fields').iterate()) {
    fieldCache.set(r.fieldName, r.fieldID);
  }
  for (const r of db.prepare('SELECT creatorTypeID, creatorType FROM creatorTypes').iterate()) {
    creatorCache.set(r.creatorType, r.creatorTypeID);
  }
}

export function itemTypeIdByName(name) {
  if (typeCache.size === 0) loadCaches();
  return typeCache.get(name) ?? null;
}

export function itemNameById(id) {
  if (typeCache.size === 0) loadCaches();
  for (const [n, i] of typeCache) if (i === id) return n;
  return null;
}

export function fieldIdByName(name) {
  if (fieldCache.size === 0) loadCaches();
  return fieldCache.get(name) ?? null;
}

export function fieldNameById(id) {
  if (fieldCache.size === 0) loadCaches();
  for (const [n, i] of fieldCache) if (i === id) return n;
  return null;
}

export function creatorTypeIdByName(name) {
  if (creatorCache.size === 0) loadCaches();
  return creatorCache.get(name) ?? null;
}

export function creatorTypeNameById(id) {
  if (creatorCache.size === 0) loadCaches();
  for (const [n, i] of creatorCache) if (i === id) return n;
  return null;
}

/** Validate that fieldID is allowed for the given itemType. */
export function isFieldAllowedForType(itemTypeId, fieldId) {
  const db = getDb();
  return Boolean(
    db.prepare('SELECT 1 FROM itemTypeFields WHERE itemTypeID=? AND fieldID=?').get(itemTypeId, fieldId)
  );
}

// ---------------------------------------------------------------------------
// itemDataValues helpers (deduplicated string storage)
// ---------------------------------------------------------------------------
/** Find or insert a value in itemDataValues, returning its valueID. */
export function getOrCreateValueId(value) {
  const db = getDb();
  const existing = db.prepare('SELECT valueID FROM itemDataValues WHERE value=?').get(value);
  if (existing) return existing.valueID;
  const info = db.prepare('INSERT INTO itemDataValues(value) VALUES (?)').run(value);
  return info.lastInsertRowid;
}

// ---------------------------------------------------------------------------
// Item CRUD
// ---------------------------------------------------------------------------
const INSERT_ITEM = `
  INSERT INTO items(itemTypeID, key, dateAdded, dateModified, version, parentItemID, deleted, inPublications)
  VALUES (@itemTypeID, @key, @dateAdded, @dateModified, @version, @parentItemID, @deleted, @inPublications)
`;

/**
 * Insert an items row. Caller supplies: itemTypeID, key, parentItemID (nullable), deleted, inPublications.
 * Returns itemID.
 */
export function insertItemRow({ itemTypeID, key, parentItemID = null, deleted = 0, inPublications = 0, dateAdded, dateModified, version = 0 }) {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const info = db.prepare(INSERT_ITEM).run({
    itemTypeID, key,
    dateAdded: dateAdded ?? now,
    dateModified: dateModified ?? now,
    version,
    parentItemID,
    deleted,
    inPublications,
  });
  return info.lastInsertRowid;
}

export function updateItemModifiedDate(itemId) {
  getDb().prepare("UPDATE items SET dateModified = datetime('now') WHERE itemID=?").run(itemId);
}

export function getItemRow(itemId) {
  return getDb().prepare('SELECT * FROM items WHERE itemID=?').get(itemId);
}

export function getItemByKey(key) {
  return getDb().prepare('SELECT * FROM items WHERE key=?').get(key);
}

export function listItems({ type, journal, collection, search, includeDeleted = false, topLevelOnly = false } = {}) {
  const db = getDb();
  const where = ['i.parentItemID IS NULL'];
  const params = [];
  if (!includeDeleted) {
    where.push('i.deleted = 0');
  }
  if (type) {
    const typeId = itemTypeIdByName(type);
    if (typeId == null) return [];
    where.push('i.itemTypeID = ?');
    params.push(typeId);
  }
  if (journal) {
    const jfid = fieldIdByName('publicationTitle');
    if (jfid) {
      if (journal === UNFILED) {
        // Items whose publicationTitle is not in the whitelist (or absent).
        const placeholders = JOURNAL_WHITELIST.map(() => '?').join(',');
        where.push(`NOT EXISTS (SELECT 1 FROM itemData d JOIN itemDataValues v ON v.valueID=d.valueID WHERE d.itemID=i.itemID AND d.fieldID=? AND v.value IN (${placeholders}))`);
        params.push(jfid, ...JOURNAL_WHITELIST);
      } else {
        where.push(`EXISTS (SELECT 1 FROM itemData d JOIN itemDataValues v ON v.valueID=d.valueID WHERE d.itemID=i.itemID AND d.fieldID=? AND v.value=?)`);
        params.push(jfid, journal);
      }
    }
  }
  if (collection) {
    where.push(`EXISTS (SELECT 1 FROM collectionItems ci JOIN collections c ON c.collectionID=ci.collectionID WHERE ci.itemID=i.itemID AND c.key=?)`);
    params.push(collection);
  }
  if (search && search.trim()) {
    const like = `%${search.trim()}%`;
    // Search across title, DOI, publicationTitle, abstract, and author names
    where.push(`(
      EXISTS (SELECT 1 FROM itemData d1 JOIN itemDataValues v1 ON v1.valueID=d1.valueID WHERE d1.itemID=i.itemID AND v1.value LIKE ?)
      OR EXISTS (SELECT 1 FROM itemCreators ic2 JOIN creators c2 ON c2.creatorID=ic2.creatorID WHERE ic2.itemID=i.itemID AND (c2.firstName || ' ' || c2.lastName LIKE ? OR c2.lastName LIKE ? OR c2.firstName LIKE ?))
    )`);
    params.push(like, like, like, like);
  }
  const sql = `SELECT i.* FROM items i WHERE ${where.join(' AND ')} ORDER BY i.dateAdded DESC`;
  return db.prepare(sql).all(...params);
}

export function listJournals() {
  const db = getDb();
  const jfid = fieldIdByName('publicationTitle');
  if (!jfid) return [];

  // Count per whitelisted journal (exact match on publicationTitle).
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM itemData d
    JOIN itemDataValues v ON v.valueID = d.valueID
    JOIN items i ON i.itemID = d.itemID
    WHERE d.fieldID = ? AND i.deleted = 0 AND i.parentItemID IS NULL
      AND v.value = ?
  `);
  const journals = JOURNAL_WHITELIST.map(name => ({
    name,
    itemCount: countStmt.get(jfid, name).cnt,
  }));

  // "待归档": top-level, non-deleted items whose publicationTitle is not in
  // the whitelist (or has no publicationTitle at all).
  const placeholders = JOURNAL_WHITELIST.map(() => '?').join(',');
  const unfiledRow = db.prepare(`
    SELECT COUNT(*) AS cnt
    FROM items i
    WHERE i.deleted = 0 AND i.parentItemID IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM itemData d
        JOIN itemDataValues v ON v.valueID = d.valueID
        WHERE d.itemID = i.itemID AND d.fieldID = ? AND v.value IN (${placeholders})
      )
  `).get(jfid, ...JOURNAL_WHITELIST);
  journals.push({ name: UNFILED, itemCount: unfiledRow.cnt });

  return journals;
}

export function setItemDeleted(itemId, deleted) {
  getDb().prepare('UPDATE items SET deleted=?, dateModified=datetime(\'now\') WHERE itemID=?')
    .run(deleted ? 1 : 0, itemId);
}

// ---------------------------------------------------------------------------
// itemData (EAV)
// ---------------------------------------------------------------------------
export function setItemField(itemId, fieldId, value) {
  const db = getDb();
  const valueId = getOrCreateValueId(String(value));
  db.prepare('INSERT OR REPLACE INTO itemData(itemID, fieldID, valueID) VALUES (?, ?, ?)')
    .run(itemId, fieldId, valueId);
}

export function deleteItemField(itemId, fieldId) {
  getDb().prepare('DELETE FROM itemData WHERE itemID=? AND fieldID=?').run(itemId, fieldId);
}

export function getItemFields(itemId) {
  const db = getDb();
  return db.prepare(`
    SELECT f.fieldName AS name, v.value AS value
    FROM itemData d
    JOIN fields f ON f.fieldID = d.fieldID
    JOIN itemDataValues v ON v.valueID = d.valueID
    WHERE d.itemID = ?
  `).all(itemId);
}

export function getItemField(itemId, fieldName) {
  const fid = fieldIdByName(fieldName);
  if (fid == null) return null;
  const row = getDb().prepare(`
    SELECT v.value FROM itemData d
    JOIN itemDataValues v ON v.valueID = d.valueID
    WHERE d.itemID=? AND d.fieldID=?
  `).get(itemId, fid);
  return row?.value ?? null;
}

// ---------------------------------------------------------------------------
// creators
// ---------------------------------------------------------------------------
export function findCreatorId({ firstName, lastName, fieldMode }) {
  return getDb().prepare(
    'SELECT creatorID FROM creators WHERE firstName IS ? AND lastName IS ? AND fieldMode=?'
  ).get(firstName ?? null, lastName ?? null, fieldMode)?.creatorID ?? null;
}

export function getOrCreateCreatorId({ firstName, lastName, fieldMode }) {
  const existing = findCreatorId({ firstName, lastName, fieldMode });
  if (existing) return existing;
  const info = getDb().prepare(
    'INSERT INTO creators(firstName, lastName, fieldMode) VALUES (?, ?, ?)'
  ).run(firstName ?? null, lastName ?? null, fieldMode);
  return info.lastInsertRowid;
}

export function setItemCreators(itemId, creators) {
  // creators: [{ firstName, lastName, fieldMode, creatorType, orderIndex }]
  const db = getDb();
  tx(() => {
    db.prepare('DELETE FROM itemCreators WHERE itemID=?').run(itemId);
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO itemCreators(itemID, creatorID, creatorTypeID, orderIndex)
      VALUES (?, ?, ?, ?)
    `);
    const seen = new Set();
    for (const c of creators) {
      const cid = getOrCreateCreatorId({
        firstName: c.firstName ?? null,
        lastName: c.lastName ?? null,
        fieldMode: c.fieldMode ?? 0,
      });
      const ctid = creatorTypeIdByName(c.creatorType) ?? creatorTypeIdByName('author');
      // Dedupe by (creatorID, creatorTypeID): the same person can appear
      // twice in CrossRef output (e.g. repeated author), and the PK is
      // (itemID, creatorID, creatorTypeID).
      const key = `${cid}:${ctid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stmt.run(itemId, cid, ctid, c.orderIndex ?? 0);
    }
  });
}

export function getItemCreators(itemId) {
  const db = getDb();
  return db.prepare(`
    SELECT c.firstName, c.lastName, c.fieldMode, ct.creatorType, ic.orderIndex
    FROM itemCreators ic
    JOIN creators c ON c.creatorID = ic.creatorID
    JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
    WHERE ic.itemID = ?
    ORDER BY ic.orderIndex
  `).all(itemId);
}

// ---------------------------------------------------------------------------
// attachments (file metadata)
// ---------------------------------------------------------------------------
export function insertAttachment({ itemId, parentItemId, linkMode, contentType, charset, path, md5, mtime, syncState = null }) {
  getDb().prepare(`
    INSERT INTO itemAttachments(itemID, parentItemID, linkMode, contentType, charset, path, syncState, md5, mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(itemId, parentItemId ?? null, linkMode, contentType ?? null, charset ?? null,
        path ?? null, syncState, md5 ?? null, mtime ?? null);
}

export function getAttachment(itemId) {
  return getDb().prepare('SELECT * FROM itemAttachments WHERE itemID=?').get(itemId);
}

export function getAttachmentsByParent(parentItemId) {
  return getDb().prepare('SELECT * FROM itemAttachments WHERE parentItemID=?').all(parentItemId);
}
