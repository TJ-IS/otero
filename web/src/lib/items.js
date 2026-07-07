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
