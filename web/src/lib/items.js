// Shared helpers for displaying items.

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

export const ITEM_TYPE_LABELS = {
  journalArticle: '期刊论文',
  preprint: '预印本',
  book: '书籍',
  bookSection: '书籍章节',
  conferencePaper: '会议论文',
  thesis: '学位论文',
  report: '报告',
  document: '文档',
};

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
  return item?.fields?.title || '(无标题)';
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
  if (!filter) return '全部条目';
  if (filter.search) return `搜索: "${filter.search}"`;
  if (filter.journal) return filter.journal;
  if (filter.collection) {
    const c = collections?.find(c => c.key === filter.collection);
    return c?.name || '集合视图';
  }
  return '全部条目';
}
