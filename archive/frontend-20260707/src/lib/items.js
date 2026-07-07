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

export function yearOf(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/\b(1[5-9]|20)\d{2}\b/);
  return m ? m[0] : '';
}

export function itemTitle(item) {
  return item?.fields?.title || '(无标题)';
}
