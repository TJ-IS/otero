import { DataObject } from './DataObject.js';
import { generateKey } from '../utils/key.js';
import { execute } from '../db/connection.js';
import {
  insertCollection, getCollectionByKey, getCollectionById,
  listCollections as repoListCollections,
  renameCollection, setCollectionDeleted,
  addChildItem, removeChildItem, getCollectionItems,
} from '../repositories/collectionRepo.js';

export class Collection extends DataObject {
  constructor(opts = {}) {
    super(opts);
    this._name = opts.name ?? null;
    this._parentCollectionID = opts.parentCollectionID ?? null;
  }

  get name() { return this._name; }
  get parentCollectionID() { return this._parentCollectionID; }

  setName(name) { this._name = name; return this; }
  setParent(id) { this._parentCollectionID = id; return this; }

  async save() {
    if (this._id == null) {
      const { id, key } = await insertCollection({
        name: this._name,
        parentCollectionID: this._parentCollectionID,
        key: this._key ?? generateKey(),
      });
      this._id = id;
      this._key = key;
    } else {
      await renameCollection(this._id, this._name);
    }
    return this;
  }

  async delete(permanent = false) {
    if (this._id == null) return;
    if (permanent) {
      await execute('DELETE FROM collections WHERE "collectionID"=$1', [this._id]);
      this._id = null;
    } else {
      await setCollectionDeleted(this._id, true);
    }
  }

  async addItem(itemId, orderIndex = 0) {
    await addChildItem(this._id, itemId, orderIndex);
    return this;
  }

  async removeItem(itemId) {
    await removeChildItem(this._id, itemId);
    return this;
  }

  async items() {
    return getCollectionItems(this._id);
  }

  toJSON() {
    return { ...super.toJSON(), name: this._name, parentCollectionID: this._parentCollectionID };
  }

  static async loadByKey(key) {
    const row = await getCollectionByKey(key);
    if (!row) return null;
    return _rowToCollection(row);
  }

  static async loadById(id) {
    const row = await getCollectionById(id);
    if (!row) return null;
    return _rowToCollection(row);
  }
}

function _rowToCollection(row) {
  return new Collection({
    id: row.collectionID,
    key: row.key,
    name: row.collectionName,
    parentCollectionID: row.parentCollectionID,
    dateAdded: row.dateAdded,
    dateModified: row.dateModified,
    version: row.version,
    deleted: row.deleted,
  });
}

export const Collections = {
  async list(opts) {
    const rows = await repoListCollections(opts);
    return rows.map(_rowToCollection);
  },
  loadByKey(key) { return Collection.loadByKey(key); },
};
