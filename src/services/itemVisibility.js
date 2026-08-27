import { Item } from '../models/Item.js';
import { classifyJournal, UNFILED } from './journalWhitelist.js';

/**
 * Scope flags for list/count queries. Editors see the full corpus
 * (including 待归档 and DOI-less articles); everyone else is restricted
 * to Basket titles whose journal articles have a DOI.
 */
export function publicItemScope(req) {
  return req.auth?.canEdit ? {} : { basketOnly: true, requireDoiForArticles: true };
}

export function isEditorRequest(req) {
  return Boolean(req.auth?.canEdit);
}

/**
 * Top-level, not deleted, Basket journal, and — for journalArticle —
 * a non-empty DOI. Missing DOI is treated as 待归档 even if publicationTitle
 * still holds a Basket name (the title is never rewritten on disk).
 */
export function isBasketVisibleItem(item) {
  if (!item || item.deleted || item.parentItemID != null) return false;
  if (classifyJournal(item.getField('publicationTitle')) === UNFILED) return false;
  if (item.itemType === 'journalArticle' && !String(item.getField('DOI') || '').trim()) {
    return false;
  }
  return true;
}

/**
 * True when this request must not see `item`. Missing items are hidden
 * so callers can return a uniform 404.
 */
export function hideFromPublic(req, item) {
  if (isEditorRequest(req)) return false;
  return !isBasketVisibleItem(item);
}

export async function hideKeyFromPublic(req, key) {
  if (isEditorRequest(req)) return false;
  const item = await Item.loadByKey(key);
  return hideFromPublic(req, item);
}

/**
 * Attachment keys belong to child items. Visibility follows the parent
 * (or the item itself if it is already top-level).
 */
export async function hideAttachmentKeyFromPublic(req, attachmentKey) {
  if (isEditorRequest(req)) return false;
  const item = await Item.loadByKey(attachmentKey);
  if (!item || item.deleted) return true;
  if (item.parentItemID != null) {
    const parent = await Item.loadById(item.parentItemID);
    return hideFromPublic(req, parent);
  }
  return hideFromPublic(req, item);
}
