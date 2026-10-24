import { extractDoi } from '../../utils/doi.js';
import { extractIsbn } from '../../utils/isbn.js';

/**
 * Fallback metadata extractor. Builds a minimal Item field bag from the PDF's
 * embedded Info dictionary plus crude heuristics on the first-page text.
 *
 * Output shape (all fields optional):
 *   { itemType, title, authors: [{firstName,lastName}|{name}], date, doi, abstractNote, source: 'fallback' }
 */
export function fromPdfExtraction({ info, firstPageText }) {
  const out = { source: 'fallback' };
  const text = firstPageText || '';

  if (info?.title) out.title = info.title;
  if (info?.author) out.authors = parseInfoAuthors(info.author);
  if (info?.doi) out.doi = info.doi;
  if (info?.subject) out.abstractNote = info.subject;

  // Try identifiers from the first-page text if Info dict didn't have them.
  if (!out.doi) out.doi = extractDoi(text) || null;
  out.isbn = extractIsbn(text);

  // Try to pull a date out of the first page text: "Published: 2017-06-12" or "(2017)".
  if (!out.date) {
    const m = text.match(/\b(19|20)\d{2}\b/);
    if (m) out.date = m[0];
  }

  // If we still have no title, fall back to the first non-empty text line.
  if (!out.title) {
    const firstLine = text.split('\n')[0]?.trim();
    if (firstLine && firstLine.length <= 300) out.title = firstLine;
  }

  return out;
}

function parseInfoAuthors(authorField) {
  // PDF Info 'Author' is often a single string with names separated by 'and' / ',' / ';'.
  const raw = String(authorField || '').trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s+and\s+|[,;]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.map((name) => {
    const tokens = name.split(/\s+/);
    if (tokens.length === 1) return { name: tokens[0] };
    return { firstName: tokens.slice(0, -1).join(' '), lastName: tokens[tokens.length - 1] };
  });
}
