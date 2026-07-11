import { DataObject } from './DataObject.js';
import { generateKey } from '../utils/key.js';
import { execute, withTransaction, nowUtc } from '../db/connection.js';
import {
  itemTypeIdByName, itemNameById,
  fieldIdByName,
  isFieldAllowedForType,
  insertItemRow, getItemRow, getItemByKey, listItems as repoListItems,
  setItemField, deleteItemField, getItemFields,
  setItemCreators, getItemCreators,
  setItemDeleted, updateItemModifiedDate,
} from '../repositories/itemRepo.js';

/**
 * Otero Item. Persistence methods are async (PostgreSQL).
 */
export class Item extends DataObject {
  constructor(opts = {}) {
    super(opts);
    this._itemTypeID = opts.itemTypeID ?? null;
    this._itemTypeName = opts.itemTypeName ?? null;
    this._parentItemID = opts.parentItemID ?? null;
    this._fieldValues = opts.fields ?? {};
    this._creators = opts.creators ?? [];
    this._changedFields = new Set();
    this._creatorsChanged = !!opts.creators;
  }

  get itemType() { return this._itemTypeName; }

  async setItemType(name) {
    const id = await itemTypeIdByName(name);
    if (id == null) throw new Error(`Unknown itemType: ${name}`);
    this._itemTypeName = name;
    this._itemTypeID = id;
    this._changedFields.add('__type__');
    return this;
  }

  get parentItemID() { return this._parentItemID; }
  setParent(itemId) { this._parentItemID = itemId; this._changedFields.add('__parent__'); return this; }

  getField(name) {
    return this._fieldValues[name] ?? null;
  }
  setField(name, value) {
    if (value === undefined || value === null || value === '') {
      delete this._fieldValues[name];
    } else {
      this._fieldValues[name] = String(value);
    }
    this._changedFields.add(name);
    return this;
  }

  get creators() { return this._creators.slice(); }
  setCreators(list) {
    this._creators = list.map((c, i) => ({ ...c, orderIndex: c.orderIndex ?? i }));
    this._creatorsChanged = true;
    return this;
  }
  addCreator({ firstName, lastName, name, creatorType = 'author', fieldMode, orderIndex }) {
    if (name) {
      this._creators.push({ firstName: null, lastName: name, fieldMode: 1, creatorType, orderIndex });
    } else {
      this._creators.push({ firstName, lastName, fieldMode: fieldMode ?? 0, creatorType, orderIndex });
    }
    this._creatorsChanged = true;
    return this;
  }

  async save() {
    if (this._itemTypeID == null) throw new Error('Item.itemType must be set before save');
    const isNew = this._id == null;
    const writeCreators = isNew ? this._creators.length > 0 : this._creatorsChanged;

    await withTransaction(async (client) => {
      if (isNew) {
        const key = this._key ?? generateKey();
        this._key = key;
        this._id = await insertItemRow({
          itemTypeID: this._itemTypeID,
          key,
          parentItemID: this._parentItemID,
        }, client);
        for (const [name, value] of Object.entries(this._fieldValues)) {
          const fid = await fieldIdByName(name);
          if (fid == null) throw new Error(`Unknown field: ${name}`);
          if (!(await isFieldAllowedForType(this._itemTypeID, fid))) continue;
          await setItemField(this._id, fid, value, client);
        }
      } else {
        await execute(
          `UPDATE items SET "itemTypeID"=$1, "parentItemID"=$2, "dateModified"=$3 WHERE "itemID"=$4`,
          [this._itemTypeID, this._parentItemID, nowUtc(), this._id],
          client
        );
        for (const name of this._changedFields) {
          if (name === '__type__' || name === '__parent__') continue;
          const fid = await fieldIdByName(name);
          if (fid == null) continue;
          if (!(await isFieldAllowedForType(this._itemTypeID, fid))) continue;
          const value = this._fieldValues[name];
          if (value === undefined) {
            await deleteItemField(this._id, fid, client);
          } else {
            await setItemField(this._id, fid, value, client);
          }
        }
        await updateItemModifiedDate(this._id, client);
      }
    });

    if (writeCreators) {
      await setItemCreators(
        this._id,
        this._creators.map((c, i) => ({ ...c, orderIndex: c.orderIndex ?? i }))
      );
    }

    this._changedFields.clear();
    this._creatorsChanged = false;
    return this;
  }

  async delete(permanent = false) {
    if (this._id == null) return;
    if (permanent) {
      // Children reference parent via parentItemID without ON DELETE CASCADE
      // (SQLite often skipped FK enforcement). Delete descendants first.
      await withTransaction(async (client) => {
        await execute('DELETE FROM items WHERE "parentItemID"=$1', [this._id], client);
        await execute('DELETE FROM items WHERE "itemID"=$1', [this._id], client);
      });
      this._id = null;
    } else {
      await setItemDeleted(this._id, true);
    }
  }

  toJSON() {
    return {
      ...super.toJSON(),
      itemType: this._itemTypeName,
      parentItemID: this._parentItemID,
      fields: { ...this._fieldValues },
      creators: this._creators,
    };
  }

  static async loadById(itemId) {
    const row = await getItemRow(itemId);
    if (!row) return null;
    return _rowToItem(row);
  }

  static async loadByKey(key) {
    const row = await getItemByKey(key);
    if (!row) return null;
    return _rowToItem(row);
  }
}

async function _rowToItem(row) {
  const fields = {};
  for (const f of await getItemFields(row.itemID)) fields[f.name] = f.value;
  const creators = await getItemCreators(row.itemID);
  return new Item({
    id: row.itemID,
    key: row.key,
    itemTypeID: row.itemTypeID,
    itemTypeName: await itemNameById(row.itemTypeID),
    dateAdded: row.dateAdded,
    dateModified: row.dateModified,
    version: row.version,
    deleted: row.deleted,
    parentItemID: row.parentItemID,
    fields,
    creators,
  });
}

export const Items = {
  async list(opts) {
    const rows = await repoListItems(opts);
    return Promise.all(rows.map(_rowToItem));
  },
  loadByKey(key) { return Item.loadByKey(key); },
  loadById(id) { return Item.loadById(id); },
};
