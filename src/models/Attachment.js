import { Item } from './Item.js';
import { generateKey } from '../utils/key.js';
import { execute, withTransaction } from '../db/connection.js';
import {
  insertAttachment, getAttachment, getAttachmentsByParent,
} from '../repositories/itemRepo.js';

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

  async save() {
    if (this._itemTypeID == null) {
      await this.setItemType('document');
    }
    await super.save();
    await withTransaction(async (client) => {
      const existing = await getAttachment(this._id);
      if (existing) {
        await execute(`
          UPDATE "itemAttachments"
          SET "parentItemID"=$1, "linkMode"=$2, "contentType"=$3, charset=$4, path=$5, md5=$6, mtime=$7
          WHERE "itemID"=$8
        `, [
          this._parentItemID, this._linkMode, this._contentType, this._charset,
          this._path, this._md5, this._mtime == null ? null : Math.round(Number(this._mtime)), this._id,
        ], client);
      } else {
        await insertAttachment({
          itemId: this._id,
          parentItemId: this._parentItemID,
          linkMode: this._linkMode,
          contentType: this._contentType,
          charset: this._charset,
          path: this._path,
          md5: this._md5,
          mtime: this._mtime,
        }, client);
      }
    });
    return this;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      linkMode: this._linkMode,
      contentType: this._contentType,
      path: this._path,
      md5: this._md5,
      mtime: this._mtime,
    };
  }

  static async loadById(id) {
    const row = await getAttachment(id);
    if (!row) return null;
    const item = await Item.loadById(id);
    if (!item) return null;
    return new Attachment({
      ...item.toJSON(),
      itemTypeID: item._itemTypeID,
      itemTypeName: item._itemTypeName,
      fields: item._fieldValues,
      creators: item._creators,
      parentItemID: row.parentItemID,
      linkMode: row.linkMode,
      contentType: row.contentType,
      charset: row.charset,
      path: row.path,
      md5: row.md5,
      mtime: row.mtime,
    });
  }

  static async listByParent(parentItemId) {
    const rows = await getAttachmentsByParent(parentItemId);
    const out = [];
    for (const r of rows) {
      const att = await Attachment.loadById(r.itemID);
      if (att) out.push(att);
    }
    return out;
  }
}

export async function createPdfAttachment({
  parentItemID, storedPath, md5, mtime, contentType = 'application/pdf',
}) {
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
  await att.save();
  return att;
}
