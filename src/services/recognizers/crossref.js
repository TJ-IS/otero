import { config } from '../../config.js';

/**
 * Fetch metadata from CrossRef by DOI.
 * https://api.crossref.org/works/{doi}
 * Returns a normalized object understood by metadataMapper, or null on failure.
 */
export async function fetchByDoi(doi) {
  if (!doi) return null;
  const url = config.recognizers.crossref + encodeURIComponent(doi);
  const res = await fetch(url, {
    headers: { 'User-Agent': config.recognizers.userAgent },
    signal: AbortSignal.timeout(config.recognizers.timeoutMs),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const msg = json?.message;
  if (!msg) return null;
  return { source: 'crossref', raw: msg };
}
