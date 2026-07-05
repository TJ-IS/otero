import { getDb, tx } from '../db/connection.js';
import { generateKey } from '../utils/key.js';

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
export function insertCollection({ name, parentCollectionID = null, key = generateKey() }) {
  const info = getDb().prepare(`
    INSERT INTO collections(collectionName, parentCollectionID, key)
    VALUES (?, ?, ?)
  `).run(name, parentCollectionID, key);
  return { id: info.lastInsertRowid, key };
}

export function getCollectionByKey(key) {
  return getDb().prepare('SELECT * FROM collections WHERE key=?').get(key);
}

export function getCollectionById(id) {
  return getDb().prepare('SELECT * FROM collections WHERE collectionID=?').get(id);
}

export function listCollections({ includeDeleted = false } = {}) {
  const sql = includeDeleted
    ? 'SELECT * FROM collections ORDER BY collectionName'
    : 'SELECT * FROM collections WHERE deleted=0 ORDER BY collectionName';
  return getDb().prepare(sql).all();
}

export function renameCollection(id, name) {
  getDb().prepare("UPDATE collections SET collectionName=?, dateModified=datetime('now') WHERE collectionID=?")
    .run(name, id);
}

export function setCollectionDeleted(id, deleted) {
  getDb().prepare("UPDATE collections SET deleted=?, dateModified=datetime('now') WHERE collectionID=?")
    .run(deleted ? 1 : 0, id);
}

export function addChildItem(collectionID, itemID, orderIndex = 0) {
  getDb().prepare('INSERT OR REPLACE INTO collectionItems(collectionID, itemID, orderIndex) VALUES (?, ?, ?)')
    .run(collectionID, itemID, orderIndex);
}

export function removeChildItem(collectionID, itemID) {
  getDb().prepare('DELETE FROM collectionItems WHERE collectionID=? AND itemID=?').run(collectionID, itemID);
}

export function getCollectionItems(collectionID) {
  return getDb().prepare(`
    SELECT i.* FROM collectionItems ci
    JOIN items i ON i.itemID = ci.itemID
    WHERE ci.collectionID = ? AND i.deleted = 0
    ORDER BY ci.orderIndex
  `).all(collectionID);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------
export function listTags() {
  return getDb().prepare(`
    SELECT t.tagID, t.name, COUNT(it.itemID) AS itemCount
    FROM tags t
    LEFT JOIN itemTags it ON it.tagID = t.tagID
    GROUP BY t.tagID, t.name
    ORDER BY t.name
  `).all();
}

export function getTagByName(name) {
  return getDb().prepare('SELECT * FROM tags WHERE name=?').get(name);
}

export function getOrCreateTag(name) {
  const existing = getTagByName(name);
  if (existing) return existing.tagID;
  const info = getDb().prepare('INSERT OR IGNORE INTO tags(name) VALUES (?)').run(name);
  return info.lastInsertRowid ?? getTagByName(name).tagID;
}

export function deleteTag(tagID) {
  tx(() => {
    getDb().prepare('DELETE FROM itemTags WHERE tagID=?').run(tagID);
    getDb().prepare('DELETE FROM tags WHERE tagID=?').run(tagID);
  });
}
