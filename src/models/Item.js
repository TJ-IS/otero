import { DataObject } from './DataObject.js';
import { generateKey } from '../utils/key.js';
import { getDb, tx } from '../db/connection.js';
import {
  itemTypeIdByName, itemNameById,
  fieldIdByName, fieldNameById,
  isFieldAllowedForType,
  insertItemRow, getItemRow, getItemByKey, listItems as repoListItems,
  setItemField, deleteItemField, getItemFields, getItemField,
  setItemCreators, getItemCreators,
  setItemTags, getItemTags,
  setItemDeleted, updateItemModifiedDate,
} from '../repositories/itemRepo.js';

/**
 * Otero Item. API mirrors Zotero.Item's get/set field & creator & tag surface.
 * Fields are addressed by name (e.g. setField('title', '...')).
 */
export class Item extends DataObject {
  constructor(opts = {}) {
    super(opts);
    this._itemTypeID = opts.itemTypeID ?? null;
    this._itemTypeName = opts.itemTypeName ?? null;
    this._parentItemID = opts.parentItemID ?? null;
    this._fieldValues = opts.fields ?? {};        // name -> string
    this._creators = opts.creators ?? [];         // [{firstName,lastName,fieldMode,creatorType,orderIndex}]
    this._tags = opts.tags ?? [];                 // [{tag,type}]
    this._changedFields = new Set();
    this._creatorsChanged = !!opts.creators;
    this._tagsChanged = !!opts.tags;
  }

  // ---- type ---------------------------------------------------------------
  get itemType() { return this._itemTypeName; }
  setItemType(name) {
    const id = itemTypeIdByName(name);
    if (id == null) throw new Error(`Unknown itemType: ${name}`);
    this._itemTypeName = name;
    this._itemTypeID = id;
    this._changedFields.add('__type__');
    return this;
  }

  // ---- parent -------------------------------------------------------------
  get parentItemID() { return this._parentItemID; }
  setParent(itemId) { this._parentItemID = itemId; this._changedFields.add('__parent__'); return this; }

  // ---- fields -------------------------------------------------------------
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

  // ---- creators -----------------------------------------------------------
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

  // ---- tags ---------------------------------------------------------------
  get tags() { return this._tags.slice(); }
  setTags(list) {
    this._tags = list.map(t => (typeof t === 'string' ? { tag: t, type: 0 } : { tag: t.tag, type: t.type ?? 0 }));
    this._tagsChanged = true;
    return this;
  }
  addTag(tag, type = 0) {
    this._tags.push({ tag, type });
    this._tagsChanged = true;
    return this;
  }

  // ---- persistence --------------------------------------------------------
  save() {
    if (this._itemTypeID == null) throw new Error('Item.itemType must be set before save');
    const db = getDb();
    tx(() => {
      if (this._id == null) {
        const key = this._key ?? generateKey();
        this._key = key;
        const id = insertItemRow({
          itemTypeID: this._itemTypeID,
          key,
          parentItemID: this._parentItemID,
        });
        this._id = id;
        // Insert all initial fields.
        for (const [name, value] of Object.entries(this._fieldValues)) {
          const fid = fieldIdByName(name);
          if (fid == null) throw new Error(`Unknown field: ${name}`);
          if (!isFieldAllowedForType(this._itemTypeID, fid)) continue;
          setItemField(id, fid, value);
        }
        if (this._creators.length) setItemCreators(this._id, this._creators.map((c, i) => ({ ...c, orderIndex: c.orderIndex ?? i })));
        if (this._tags.length) setItemTags(this._id, this._tags);
      } else {
        // Update existing row.
        db.prepare(`UPDATE items SET itemTypeID=?, parentItemID=?, dateModified=datetime('now') WHERE itemID=?`)
          .run(this._itemTypeID, this._parentItemID, this._id);
        for (const name of this._changedFields) {
          if (name === '__type__' || name === '__parent__') continue;
          const fid = fieldIdByName(name);
          if (fid == null) continue;
          if (!isFieldAllowedForType(this._itemTypeID, fid)) continue;
          const value = this._fieldValues[name];
          if (value === undefined) {
            deleteItemField(this._id, fid);
          } else {
            setItemField(this._id, fid, value);
          }
        }
        if (this._creatorsChanged) setItemCreators(this._id, this._creators.map((c, i) => ({ ...c, orderIndex: c.orderIndex ?? i })));
        if (this._tagsChanged) setItemTags(this._id, this._tags);
        updateItemModifiedDate(this._id);
      }
    });
    this._changedFields.clear();
    this._creatorsChanged = false;
    this._tagsChanged = false;
    return this;
  }

  delete(permanent = false) {
    if (this._id == null) return;
    if (permanent) {
      getDb().prepare('DELETE FROM items WHERE itemID=?').run(this._id);
      this._id = null;
    } else {
      setItemDeleted(this._id, true);
    }
  }

  // ---- serialization ------------------------------------------------------
  toJSON() {
    return {
      ...super.toJSON(),
      itemType: this._itemTypeName,
      parentItemID: this._parentItemID,
      fields: { ...this._fieldValues },
      creators: this._creators,
      tags: this._tags,
    };
  }

  // ---- static loaders -----------------------------------------------------
  static loadById(itemId) {
    const row = getItemRow(itemId);
    if (!row) return null;
    return _rowToItem(row);
  }

  static loadByKey(key) {
    const row = getItemByKey(key);
    if (!row) return null;
    return _rowToItem(row);
  }
}

function _rowToItem(row) {
  const fields = {};
  for (const f of getItemFields(row.itemID)) fields[f.name] = f.value;
  const creators = getItemCreators(row.itemID);
  const tags = getItemTags(row.itemID);
  return new Item({
    id: row.itemID,
    key: row.key,
    itemTypeID: row.itemTypeID,
    itemTypeName: itemNameById(row.itemTypeID),
    dateAdded: row.dateAdded,
    dateModified: row.dateModified,
    version: row.version,
    deleted: row.deleted,
    parentItemID: row.parentItemID,
    fields,
    creators,
    tags,
  });
}

/** Plural helper for queries. */
export const Items = {
  list(opts) {
    return repoListItems(opts).map(_rowToItem);
  },
  loadByKey(key) { return Item.loadByKey(key); },
  loadById(id) { return Item.loadById(id); },
};
