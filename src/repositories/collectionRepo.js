import { query, queryOne, execute, nowUtc } from '../db/connection.js';
import { generateKey } from '../utils/key.js';

export async function insertCollection({ name, parentCollectionID = null, key = generateKey() }) {
  const row = await queryOne(`
    INSERT INTO collections("collectionName", "parentCollectionID", key)
    VALUES ($1, $2, $3)
    RETURNING "collectionID"
  `, [name, parentCollectionID, key]);
  return { id: row.collectionID, key };
}

export async function getCollectionByKey(key) {
  return queryOne('SELECT * FROM collections WHERE key=$1', [key]);
}

export async function getCollectionById(id) {
  return queryOne('SELECT * FROM collections WHERE "collectionID"=$1', [id]);
}

export async function listCollections({ includeDeleted = false } = {}) {
  const sql = includeDeleted
    ? 'SELECT * FROM collections ORDER BY "collectionName"'
    : 'SELECT * FROM collections WHERE deleted=0 ORDER BY "collectionName"';
  return query(sql);
}

export async function renameCollection(id, name) {
  await execute(
    'UPDATE collections SET "collectionName"=$1, "dateModified"=$2 WHERE "collectionID"=$3',
    [name, nowUtc(), id]
  );
}

export async function setCollectionDeleted(id, deleted) {
  await execute(
    'UPDATE collections SET deleted=$1, "dateModified"=$2 WHERE "collectionID"=$3',
    [deleted ? 1 : 0, nowUtc(), id]
  );
}

export async function addChildItem(collectionID, itemID, orderIndex = 0) {
  await execute(`
    INSERT INTO "collectionItems"("collectionID", "itemID", "orderIndex") VALUES ($1, $2, $3)
    ON CONFLICT ("collectionID", "itemID") DO UPDATE SET "orderIndex" = EXCLUDED."orderIndex"
  `, [collectionID, itemID, orderIndex]);
}

export async function removeChildItem(collectionID, itemID) {
  await execute(
    'DELETE FROM "collectionItems" WHERE "collectionID"=$1 AND "itemID"=$2',
    [collectionID, itemID]
  );
}

export async function getCollectionItems(collectionID) {
  return query(`
    SELECT i.* FROM "collectionItems" ci
    JOIN items i ON i."itemID" = ci."itemID"
    WHERE ci."collectionID" = $1 AND i.deleted = 0
    ORDER BY ci."orderIndex"
  `, [collectionID]);
}
