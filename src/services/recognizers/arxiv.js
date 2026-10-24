import { config } from '../../config.js';

const ARXIV_ID_RE = /\b(?:arXiv:?)?(\d{4}\.\d{4,5}(?:v\d+)?)\b/i;
const OLD_ARXIV_RE = /\b([a-z\-]+\/\d{7}(?:v\d+)?)\b/i;

/** Extract the first plausible arXiv id from arbitrary text. */
export function extractArxivId(text) {
  if (!text) return null;
  let m = text.match(ARXIV_ID_RE);
  if (m) return m[1];
  m = text.match(OLD_ARXIV_RE);
  if (m) return m[1];
  return null;
}

/** Query the arXiv Atom API for an entry by id. */
export async function fetchById(id) {
  if (!id) return null;
  const url = `${config.recognizers.arxiv}?id_list=${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': config.recognizers.userAgent },
    signal: AbortSignal.timeout(config.recognizers.timeoutMs),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const entry = parseFirstEntry(xml);
  if (!entry) return null;
  return { source: 'arxiv', raw: entry, arxivId: id };
}

/** Minimal Atom <entry> parser, no external deps. */
function parseFirstEntry(xml) {
  // Strip namespaces for easier selectors.
  const stripped = xml.replace(/<(\/?)[a-zA-Z0-9]+:/g, '<$1');
  const entryStart = stripped.indexOf('<entry');
  if (entryStart === -1) return null;
  const entryEnd = stripped.indexOf('</entry>', entryStart);
  if (entryEnd === -1) return null;
  const body = stripped.slice(entryStart, entryEnd + '</entry>'.length);

  const pick = (tag) => {
    const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
    return m ? m[1].trim() : null;
  };
  const pickAttr = (tag, attr) => {
    const m = body.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`));
    return m ? m[1] : null;
  };

  const id = pick('id') || null;
  const title = pick('title')?.replace(/\s+/g, ' ').trim() || null;
  const summary = pick('summary')?.replace(/\s+/g, ' ').trim() || null;
  const published = pick('published') || null;
  const authors = Array.from(body.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)).map((m) =>
    m[1].trim(),
  );
  const pdfUrl =
    pickAttr('link', 'href') && body.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)?.[1];
  const doi = body.match(/<link[^>]*title="doi"[^>]*href="([^"]+)"/)?.[1] || null;
  const journalRef = pick('journal_ref') || null;
  const primaryCategory = pickAttr('category', 'term');

  return { id, title, summary, published, authors, pdfUrl, doi, journalRef, primaryCategory };
}
