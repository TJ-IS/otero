import { fetchByDoi } from './crossref.js';
import { fetchById, extractArxivId } from './arxiv.js';
import { fetchByIsbn } from './openlibrary.js';
import { fromPdfExtraction } from './fallback.js';
import { extractDoi } from '../../utils/doi.js';
import { extractIsbn } from '../../utils/isbn.js';

/**
 * Run recognizers in Zotero's priority order:
 *   arXiv ID → DOI → ISBN → fallback.
 *
 * Each recognizer returns either null or { source, raw, ...extra }.
 * The first non-null result wins.
 *
 * @param {{info: object, firstPageText: string}} extraction
 * @returns {Promise<{source: string, raw?: object, arxivId?: string, doi?: string, isbn?: string, fallback?: object}>}
 */
export async function recognize(extraction) {
  const text = [extraction.info?.title, extraction.info?.subject, extraction.firstPageText]
    .filter(Boolean)
    .join('\n');

  // 1. arXiv ID
  const arxivId = extraction.info?.raw?.arXivID ?? extractArxivId(text);
  if (arxivId) {
    const res = await fetchById(arxivId);
    if (res) return { ...res, arxivId };
  }

  // 2. DOI
  const doi = extraction.info?.doi ?? extractDoi(text);
  if (doi) {
    const res = await fetchByDoi(doi);
    if (res) return { ...res, doi };
  }

  // 3. ISBN
  const isbn = extractIsbn(text);
  if (isbn) {
    const res = await fetchByIsbn(isbn);
    if (res) return { ...res, isbn };
  }

  // 4. Fallback: build a minimal field bag from PDF Info + first-page text.
  return { source: 'fallback', fallback: fromPdfExtraction(extraction) };
}
