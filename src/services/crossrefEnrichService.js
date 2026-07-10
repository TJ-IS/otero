import { Item } from '../models/Item.js';
import { fetchByDoi } from './recognizers/crossref.js';
import { mapRecognized } from './metadataMapper.js';

/**
 * CrossRef one-click enrich for an item that already has a DOI.
 * Fetches CrossRef metadata, maps it, and returns a field-by-field / creator
 * comparison against the current item. Does NOT write to the database —
 * the client applies selected suggestions to the draft and the user saves.
 */

const COMPARE_FIELDS = [
  'title',
  'abstractNote',
  'publicationTitle',
  'volume',
  'issue',
  'pages',
  'date',
  'DOI',
  'ISSN',
  'url',
  'language',
  'publisher',
];

function normalize(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normKey(s) {
  return normalize(s).toLowerCase();
}

function stripHtml(s) {
  return normalize(s);
}

function creatorKey(c) {
  if (!c) return '';
  if (c.fieldMode === 1 || (c.name && !c.firstName && !c.lastName)) {
    return normKey(c.name || c.lastName || '');
  }
  return normKey(`${c.lastName || ''}|${c.firstName || ''}`);
}

function creatorLabel(c) {
  if (!c) return '';
  if (c.fieldMode === 1 || (c.name && !c.firstName)) {
    return c.name || c.lastName || '';
  }
  const last = c.lastName || '';
  const first = c.firstName || '';
  if (last && first) return `${last}, ${first}`;
  return last || first || '';
}

/**
 * Compare current item fields/creators with CrossRef-mapped suggestions.
 * Returns { doi, itemType, suggestedItemType, fields, creators, summary }.
 *
 * @param {string} key
 * @param {{ doi?: string, fields?: object, creators?: array, itemType?: string }} [opts]
 *   Optional draft overrides so the UI can compare against unsaved edits.
 */
export async function enrichFromCrossref(key, opts = {}) {
  const item = Item.loadByKey(key);
  if (!item) throw new Error('item not found');

  const doi = (opts.doi || item.getField('DOI') || '').trim();
  if (!doi) throw new Error('条目没有 DOI，无法查询 CrossRef');

  const recognized = await fetchByDoi(doi);
  if (!recognized) throw new Error(`CrossRef 未找到 DOI: ${doi}`);

  const mapped = mapRecognized(recognized);
  // CrossRef abstracts often carry JATS markup.
  if (mapped.fields.abstractNote) {
    mapped.fields.abstractNote = stripHtml(mapped.fields.abstractNote);
  }

  const draftFields = opts.fields && typeof opts.fields === 'object' ? opts.fields : null;
  const currentItemType = opts.itemType || item.itemType;

  const fields = [];
  for (const name of COMPARE_FIELDS) {
    const suggested = mapped.fields[name];
    if (suggested == null || suggested === '') continue;
    const current = draftFields
      ? (draftFields[name] ?? '')
      : (item.getField(name) || '');
    const curN = normKey(current);
    const sugN = normKey(suggested);
    let status;
    if (!curN) status = 'missing';
    else if (curN === sugN) status = 'match';
    else status = 'conflict';
    fields.push({
      field: name,
      current: String(current || ''),
      suggested: String(suggested),
      status,
    });
  }

  const currentCreators = Array.isArray(opts.creators) ? opts.creators : (item.creators || []);
  const suggestedCreators = (mapped.creators || []).map((c, i) => ({
    firstName: c.firstName || '',
    lastName: c.lastName || c.name || '',
    name: c.name || '',
    creatorType: c.creatorType || 'author',
    fieldMode: c.name && !c.firstName ? 1 : 0,
    orderIndex: i,
  }));

  const curKeys = currentCreators.map(creatorKey).filter(Boolean);
  const sugKeys = suggestedCreators.map(creatorKey).filter(Boolean);
  let creatorsStatus = 'match';
  if (sugKeys.length === 0) {
    creatorsStatus = 'match';
  } else if (curKeys.length === 0) {
    creatorsStatus = 'missing';
  } else if (
    curKeys.length !== sugKeys.length
    || curKeys.some((k, i) => k !== sugKeys[i])
  ) {
    creatorsStatus = 'conflict';
  }

  const creators = {
    status: creatorsStatus,
    current: currentCreators.map((c, i) => ({
      index: i,
      label: creatorLabel(c),
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      creatorType: c.creatorType || 'author',
      fieldMode: c.fieldMode || 0,
    })),
    suggested: suggestedCreators.map((c, i) => ({
      index: i,
      label: creatorLabel(c),
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      creatorType: c.creatorType || 'author',
      fieldMode: c.fieldMode || 0,
    })),
  };

  const summary = {
    match: fields.filter(f => f.status === 'match').length,
    missing: fields.filter(f => f.status === 'missing').length,
    conflict: fields.filter(f => f.status === 'conflict').length,
    creatorsStatus,
  };

  return {
    doi,
    itemType: currentItemType,
    suggestedItemType: mapped.itemType || currentItemType,
    fields,
    creators,
    summary,
  };
}
