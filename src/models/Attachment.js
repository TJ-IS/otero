import { Item } from './Item.js';
import { generateKey } from '../utils/key.js';
import { getDb, tx } from '../db/connection.js';
import {
  insertItemRow, insertAttachment, getAttachment, getAttachmentsByParent,
} from '../repositories/itemRepo.js';

/**
 * File attachment. Wraps an `items` row whose itemType is `attachment`.
 *
 * Link modes (matches Zotero):
 *   0 = imported file (stored in our data/storage)
 *   1 = imported url (web snapshot)
 *   2 = linked file (external file path)
 *   3 = linked url
 *   4 = embedded image
 */
export const LinkMode = {
  IMPORTED_FILE: 0,
  IMPORTED_URL: 1,
  LINKED_FILE: 2,
  LINKED_URL: 3,
  EMBEDDED_IMAGE: 4,
};

export class Attachment extends Item {
  constructor(opts = {}) {
    super(opts);
    this._linkMode = opts.linkMode ?? null;
    this._contentType = opts.contentType ?? null;
    this._path = opts.path ?? null;
    this._charset = opts.charset ?? null;
    this._md5 = opts.md5 ?? null;
    this._mtime = opts.mtime ?? null;
  }

  get linkMode() { return this._linkMode; }
  get contentType() { return this._contentType; }
  get path() { return this._path; }
  get md5() { return this._md5; }
  get mtime() { return this._mtime; }

  isPdf() { return this._contentType === 'application/pdf'; }

  save() {
    if (this._itemTypeID == null) {
      // attachment is a built-in item type concept; we represent it with a
      // dedicated flag rather than a row in `itemTypes` (which only holds
      // user-facing types). For Otero v1 we store attachments as items whose
      // itemType is 'document' plus an itemAttachments row carrying the
      // content-type / path / link-mode. This keeps the EAV tables happy
      // without seeding a synthetic `attachment` item type.
      this.setItemType('document');
    }
    super.save();
    tx(() => {
      const existing = getAttachment(this._id);
      if (existing) {
        getDb().prepare(`
          UPDATE itemAttachments
          SET parentItemID=?, linkMode=?, contentType=?, charset=?, path=?, md5=?, mtime=?
          WHERE itemID=?
        `).run(this._parentItemID, this._linkMode, this._contentType, this._charset, this._path, this._md5, this._mtime, this._id);
      } else {
        insertAttachment({
          itemId: this._id,
          parentItemId: this._parentItemID,
          linkMode: this._linkMode,
          contentType: this._contentType,
          charset: this._charset,
          path: this._path,
          md5: this._md5,
          mtime: this._mtime,
        });
      }
    });
    return this;
  }

  toJSON() {
    return { ...super.toJSON(), linkMode: this._linkMode, contentType: this._contentType,
             path: this._path, md5: this._md5, mtime: this._mtime };
  }

  static loadById(id) {
    const row = getAttachment(id);
    if (!row) return null;
    const item = Item.loadById(id);
    if (!item) return null;
    return new Attachment({
      ...item.toJSON(),
      itemTypeID: item._itemTypeID,
      itemTypeName: item._itemTypeName,
      fields: item._fieldValues,
      creators: item._creators,
      tags: item._tags,
      parentItemID: row.parentItemID,
      linkMode: row.linkMode,
      contentType: row.contentType,
      charset: row.charset,
      path: row.path,
      md5: row.md5,
      mtime: row.mtime,
    });
  }

  static listByParent(parentItemId) {
    return getAttachmentsByParent(parentItemId).map(r => Attachment.loadById(r.itemID)).filter(Boolean);
  }
}

/** Convenience: create a stored PDF attachment from a stored file path. */
export function createPdfAttachment({ parentItemID, storedPath, md5, mtime, contentType = 'application/pdf' }) {
  const att = new Attachment({
    itemTypeID: null,
    key: generateKey(),
    linkMode: LinkMode.IMPORTED_FILE,
    contentType,
    path: storedPath,
    md5,
    mtime,
    parentItemID,
  });
  att.save();
  return att;
}
