/**
 * Export items in BibTeX or RIS format.
 */

function escapeLatex(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/[{}_^~#&$%]/g, '\\$&')
    .replace(/[<>"]/g, '');
}

function toBibtexId(item) {
  const key = item.key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return key || 'unknown';
}

function formatAuthorsBibtex(creators) {
  return (creators || [])
    .map((c) => {
      if (c.fieldMode === 1 || !c.firstName) return c.lastName || c.name || '';
      return `${c.lastName || ''}, ${c.firstName || ''}`;
    })
    .filter(Boolean)
    .join(' and ');
}

function formatAuthorsRis(creators) {
  return (creators || [])
    .map((c) => {
      const last = c.lastName || c.name || '';
      const first = c.firstName || '';
      return `AU  - ${last}${first ? ', ' + first : ''}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function toBibtex(item) {
  const f = item.fields || {};
  const id = toBibtexId(item);
  const typeMap = {
    journalArticle: 'article',
    preprint: 'article',
    book: 'book',
    bookSection: 'incollection',
    conferencePaper: 'inproceedings',
    thesis: 'phdthesis',
    report: 'techreport',
    document: 'misc',
  };
  const bt = typeMap[item.itemType] || 'misc';

  const lines = [`@${bt}{${id},`];
  if (f.title) lines.push(`  title = {${escapeLatex(f.title)}},`);
  const authors = formatAuthorsBibtex(item.creators);
  if (authors) lines.push(`  author = {${escapeLatex(authors)}},`);
  if (f.publicationTitle) lines.push(`  journal = {${escapeLatex(f.publicationTitle)}},`);
  if (f.date) lines.push(`  year = {${f.date.match(/\b(19|20)\d{2}\b/)?.[0] || f.date}},`);
  if (f.volume) lines.push(`  volume = {${f.volume}},`);
  if (f.issue) lines.push(`  number = {${f.issue}},`);
  if (f.pages) lines.push(`  pages = {${f.pages}},`);
  if (f.DOI) lines.push(`  doi = {${f.DOI}},`);
  if (f.ISBN) lines.push(`  isbn = {${f.ISBN}},`);
  if (f.publisher) lines.push(`  publisher = {${escapeLatex(f.publisher)}},`);
  if (f.url) lines.push(`  url = {${f.url}},`);
  if (f.abstractNote) lines.push(`  abstract = {${escapeLatex(f.abstractNote)}},`);
  lines.push('}');
  return lines.join('\n');
}

export function toRis(item) {
  const f = item.fields || {};
  const typeMap = {
    journalArticle: 'JOUR',
    preprint: 'JOUR',
    book: 'BOOK',
    bookSection: 'CHAP',
    conferencePaper: 'CPAPER',
    thesis: 'THES',
    report: 'RPRT',
    document: 'GEN',
  };
  const rt = typeMap[item.itemType] || 'GEN';
  const lines = [`TY  - ${rt}`];
  if (f.title) lines.push(`TI  - ${f.title}`);
  const authors = formatAuthorsRis(item.creators);
  if (authors) lines.push(authors);
  if (f.publicationTitle) lines.push(`JO  - ${f.publicationTitle}`);
  if (f.date) {
    const year = f.date.match(/\b(19|20)\d{2}\b/)?.[0];
    if (year) lines.push(`PY  - ${year}`);
  }
  if (f.volume) lines.push(`VL  - ${f.volume}`);
  if (f.issue) lines.push(`IS  - ${f.issue}`);
  if (f.pages) lines.push(`SP  - ${f.pages}`);
  if (f.DOI) lines.push(`DO  - ${f.DOI}`);
  if (f.ISBN) lines.push(`SN  - ${f.ISBN}`);
  if (f.publisher) lines.push(`PB  - ${f.publisher}`);
  if (f.abstractNote) lines.push(`AB  - ${f.abstractNote}`);
  if (f.url) lines.push(`UR  - ${f.url}`);
  lines.push('ER  - ');
  return lines.join('\n');
}

export function toBibtexBatch(items) {
  return items.map(toBibtex).join('\n\n');
}

export function toRisBatch(items) {
  return items.map(toRis).join('\n\n');
}
