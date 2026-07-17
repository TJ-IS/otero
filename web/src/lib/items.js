// Shared helpers for displaying items.

import i18n from '../i18n';

export const ITEM_TYPES = [
  'journalArticle',
  'preprint',
  'book',
  'bookSection',
  'conferencePaper',
  'thesis',
  'report',
  'document',
];

export function getItemTypeLabel(type) {
  if (!type) return '';
  const key = `item:type.${type}`;
  const translated = i18n.t(key);
  return translated === key ? type : translated;
}

// Backward-compatible map: ITEM_TYPE_LABELS[type] resolves via i18n.
export const ITEM_TYPE_LABELS = new Proxy(
  {},
  {
    get(_, type) {
      return getItemTypeLabel(type);
    },
  },
);

/**
 * AIS Senior Scholars' Basket of Journals — the 11 journals this system
 * curates, plus UNFILED ("待归档") for items that cannot be matched to a
 * basket journal. The publicationTitle field is constrained to these values
 * in the UI.
 *
 * This is the FRONTEND copy. The backend source of truth lives in
 * `src/services/journalWhitelist.js` and is imported by calibrateService.
 * The two lists MUST stay identical — a test (test/journalWhitelist.test.js)
 * asserts that they match.
 *
 * Canonical stored value stays Chinese "待归档"; display via common:unfiled.
 */
export const AIS_BASKET_JOURNALS = [
  'MIS Quarterly',
  'Information Systems Research',
  'Journal of Management Information Systems',
  'Journal of the Association for Information Systems',
  'European Journal of Information Systems',
  'Information Systems Journal',
  'Information and Organization',
  'Decision Support Systems',
  'Journal of Information Technology',
  'The Journal of Strategic Information Systems',
  'Information & Management',
];

export const UNFILED = '待归档';

export const ALLOWED_PUBLICATION_TITLES = [...AIS_BASKET_JOURNALS, UNFILED];

export function creatorDisplay(c) {
  if (c.fieldMode === 1 || !c.firstName) return c.lastName || c.name || '';
  return `${c.lastName || ''}, ${c.firstName || ''}`.trim(', ');
}

export function creatorsList(creators) {
  return (creators || []).map(creatorDisplay).join('; ');
}

const YEAR_RE = /\b(1[5-9]|20)\d{2}\b/;

export function yearOf(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(YEAR_RE);
  return m ? m[0] : '';
}

export function itemTitle(item) {
  return item?.fields?.title || i18n.t('item:untitled');
}

// Compact citation-style locator: "卷(期): 页码", e.g. "12(3): 45-67".
// Each part is optional — omit gracefully when a field is absent.
export function volumeIssuePages(fields) {
  const volume = fields?.volume?.trim();
  const issue = fields?.issue?.trim();
  const pages = fields?.pages?.trim();
  let vi = '';
  if (volume) vi = volume;
  if (issue) vi = vi ? `${vi}(${issue})` : `(${issue})`;
  if (vi && pages) return `${vi}: ${pages}`;
  return vi || pages || '';
}

// Human-readable label for the active list filter.
export function filterTitle(filter, collections) {
  if (!filter) return i18n.t('item:filterLabel.all');
  if (filter.search) {
    return i18n.t('item:filterLabel.search', { query: filter.search });
  }
  if (filter.journal) {
    return filter.journal === UNFILED ? i18n.t('common:unfiled') : filter.journal;
  }
  if (filter.collection) {
    const c = collections?.find(c => c.key === filter.collection);
    return c?.name || i18n.t('item:filterLabel.collection');
  }
  return i18n.t('item:filterLabel.all');
}
