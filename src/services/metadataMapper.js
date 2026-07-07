/**
 * Map raw recognizer outputs to a normalized shape consumed by importService:
 *   { itemType, fields: { fieldName: string }, creators: [{firstName,lastName,creatorType}|{name,creatorType}] }
 *
 * Recognizer outputs are keyed by `source`:
 *   - crossref:    CrossRef 'message' object
 *   - arxiv:       parsed Atom entry from arxiv.js
 *   - openlibrary: OpenLibrary 'data' object
 *   - fallback:    fallback.fromPdfExtraction output
 */

function splitNames(nameStr) {
  const tokens = String(nameStr || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return { name: tokens[0] };
  return { firstName: tokens.slice(0, -1).join(' '), lastName: tokens[tokens.length - 1] };
}

function pickYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : null;
}

function crossrefAuthors(message) {
  const list = message?.author || [];
  return list.map(a => {
    if (a.family && a.given) return { firstName: a.given, lastName: a.family, creatorType: 'author' };
    if (a.name) return { name: a.name, creatorType: 'author' };
    if (a.family) return { lastName: a.family, creatorType: 'author' };
    return null;
  }).filter(Boolean);
}

function mapCrossref(message) {
  const fields = {};
  if (message.title?.[0]) fields.title = message.title[0];
  if (message['container-title']?.[0]) fields.publicationTitle = message['container-title'][0];
  if (message['short-container-title']?.[0]) fields.publicationTitleAbbrev = message['short-container-title'][0];
  if (message.volume) fields.volume = message.volume;
  if (message.issue) fields.issue = message.issue;
  if (message.page) fields.pages = message.page;
  const year = pickYear(message['published-print']?.['date-parts']?.[0]?.join('-')
    || message['published-online']?.['date-parts']?.[0]?.join('-')
    || message['issued']?.['date-parts']?.[0]?.join('-')
    || message['created']?.['date-parts']?.[0]?.join('-'));
  if (year) fields.date = year;
  if (message.DOI) fields.DOI = message.DOI;
  if (message.ISSN?.[0]) fields.ISSN = message.ISSN[0];
  if (message.URL) fields.url = message.URL;
  if (message.language) fields.language = message.language;
  if (message.publisher) fields.publisher = message.publisher;
  if (message.abstract) fields.abstractNote = message.abstract;

  // Type inference: anything with container-title + volume/issue/page is journalArticle;
  // otherwise default to journalArticle too (CrossRef is mostly journals).
  let itemType = 'journalArticle';
  if (message.type === 'book') itemType = 'book';
  else if (message.type === 'book-chapter' || message.type === 'book-section') itemType = 'bookSection';
  else if (message.type === 'proceedings-article') itemType = 'conferencePaper';
  else if (message.type === 'report') itemType = 'report';

  return { itemType, fields, creators: crossrefAuthors(message) };
}

function mapArxiv(entry) {
  const fields = {};
  if (entry.title) fields.title = entry.title;
  if (entry.summary) fields.abstractNote = entry.summary;
  const year = pickYear(entry.published);
  if (year) fields.date = year;
  if (entry.doi) fields.DOI = entry.doi;
  if (entry.id) fields.url = entry.id;
  if (entry.pdfUrl) fields.url = entry.pdfUrl;
  if (entry.primaryCategory) fields.repository = `arXiv (${entry.primaryCategory})`;
  fields.arXivID = null; // arXivID field is per-type; handled below as `extra` instead
  fields.extra = `arXiv: ${entry.id || ''}`;

  const creators = (entry.authors || []).map(name => splitNames(name)).filter(Boolean)
    .map(c => ({ ...c, creatorType: 'author' }));

  return { itemType: 'preprint', fields, creators };
}

function mapOpenlibrary(entry) {
  const fields = {};
  if (entry.title) fields.title = entry.title;
  if (entry.subtitle) fields.title = `${entry.title}: ${entry.subtitle}`;
  const publishers = entry.publishers?.[0]?.name;
  if (publishers) fields.publisher = publishers;
  const place = entry.publishers?.[0]?.location;
  if (place) fields.place = place;
  const year = pickYear(entry.publish_date);
  if (year) fields.date = year;
  if (entry.number_of_pages) fields.numPages = String(entry.number_of_pages);
  if (entry.url) fields.url = entry.url;
  if (entry.notes) fields.abstractNote = entry.notes;

  const isbn = entry.identifiers?.isbn_13?.[0] || entry.identifiers?.isbn_10?.[0];
  if (isbn) fields.ISBN = isbn;

  const creators = (entry.authors || []).map(a => {
    const name = a.name || a;
    return splitNames(name);
  }).filter(Boolean).map(c => ({ ...c, creatorType: 'author' }));

  return { itemType: 'book', fields, creators };
}

function mapFallback(fb) {
  const fields = {};
  if (fb.title) fields.title = fb.title;
  if (fb.date) fields.date = fb.date;
  if (fb.doi) fields.DOI = fb.doi;
  if (fb.abstractNote) fields.abstractNote = fb.abstractNote;
  const creators = (fb.authors || []).map(a => ({ ...a, creatorType: 'author' }));
  return { itemType: 'document', fields, creators, isbn: fb.isbn || null };
}

export function mapRecognized(recognized) {
  switch (recognized.source) {
    case 'crossref':    return mapCrossref(recognized.raw);
    case 'arxiv':       return mapArxiv(recognized.raw);
    case 'openlibrary': return mapOpenlibrary(recognized.raw);
    case 'fallback':    return mapFallback(recognized.fallback);
    default: throw new Error(`Unknown recognizer source: ${recognized.source}`);
  }
}
