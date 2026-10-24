/**
 * Base class for Otero data objects (Item, Collection, ...).
 * Mirrors the very small subset of Zotero.DataObject that we need:
 * id, key, dateAdded, dateModified, version, deleted.
 */
export class DataObject {
  constructor({ id = null, key, dateAdded, dateModified, version = 0, deleted = 0 } = {}) {
    this._id = id;
    this._key = key;
    this._dateAdded = dateAdded;
    this._dateModified = dateModified;
    this._version = version;
    this._deleted = deleted;
    this._changed = new Set();
  }

  get id() {
    return this._id;
  }
  get key() {
    return this._key;
  }
  get dateAdded() {
    return this._dateAdded;
  }
  get dateModified() {
    return this._dateModified;
  }
  get version() {
    return this._version;
  }
  get deleted() {
    return Boolean(this._deleted);
  }

  /** Subclass override hook. */
  toJSON() {
    return {
      id: this._id,
      key: this._key,
      dateAdded: this._dateAdded,
      dateModified: this._dateModified,
      version: this._version,
      deleted: this.deleted,
    };
  }
}
