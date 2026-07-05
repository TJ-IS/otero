import { config } from '../../config.js';

/**
 * Query OpenLibrary by ISBN using the books API.
 * https://openlibrary.org/api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data
 * Returns { source: 'openlibrary', raw } or null.
 */
export async function fetchByIsbn(isbn) {
  if (!isbn) return null;
  const bibkey = `ISBN:${isbn}`;
  const url = `${config.recognizers.openlibrary}?bibkeys=${encodeURIComponent(bibkey)}&format=json&jscmd=data`;
  const res = await fetch(url, {
    headers: { 'User-Agent': config.recognizers.userAgent },
    signal: AbortSignal.timeout(config.recognizers.timeoutMs),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const entry = json?.[bibkey];
  if (!entry) return null;
  return { source: 'openlibrary', raw: entry, isbn };
}
