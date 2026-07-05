import { DataObject } from './DataObject.js';
import { generateKey } from '../utils/key.js';
import { getDb } from '../db/connection.js';
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

  save() {
    if (this._id == null) {
      const { id, key } = insertCollection({ name: this._name, parentCollectionID: this._parentCollectionID, key: this._key ?? generateKey() });
      this._id = id;
      this._key = key;
    } else {
      renameCollection(this._id, this._name);
    }
    return this;
  }

  delete(permanent = false) {
    if (this._id == null) return;
    if (permanent) {
      getDb().prepare('DELETE FROM collections WHERE collectionID=?').run(this._id);
      this._id = null;
    } else {
      setCollectionDeleted(this._id, true);
    }
  }

  addItem(itemId, orderIndex = 0) {
    addChildItem(this._id, itemId, orderIndex);
    return this;
  }

  removeItem(itemId) {
    removeChildItem(this._id, itemId);
    return this;
  }

  items() {
    return getCollectionItems(this._id);
  }

  toJSON() {
    return { ...super.toJSON(), name: this._name, parentCollectionID: this._parentCollectionID };
  }

  static loadByKey(key) {
    const row = getCollectionByKey(key);
    if (!row) return null;
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

  static loadById(id) {
    const row = getCollectionById(id);
    if (!row) return null;
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
}

export const Collections = {
  list(opts) {
    return repoListCollections(opts).map(row => new Collection({
      id: row.collectionID,
      key: row.key,
      name: row.collectionName,
      parentCollectionID: row.parentCollectionID,
      dateAdded: row.dateAdded,
      dateModified: row.dateModified,
      version: row.version,
      deleted: row.deleted,
    }));
  },
  loadByKey(key) { return Collection.loadByKey(key); },
};
