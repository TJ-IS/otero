// Author-year in-text citation detection and linking.
//
// The MinerU markdown uses APA-style author-year citations, e.g.
//   (Samuelson 2001)
//   (Contractor and Kundu 1998; Kogut and Singh 1988)
//   (Gonzalez et al. 2006a)
//   Samuelson (2001)
// The reference list (from content_list.json `ref_text` blocks) looks like
//   "Ashkanasy, N. M., Trevor-Roberts, E., and Earnshaw, L. 2002. \"...\""
//
// We match an in-text citation to a reference on (first-author-surname, year),
// ignoring the disambiguating letter suffix (2006a → 2006). A citation is only
// highlighted when it resolves to at least one reference — this keeps false
// positives (e.g. "(Jun., 2008)", "(37:1)") from being marked up.

const YEAR = String.raw`(?:1[5-9]|20)\d{2}`;

// Normalize a surname for matching: lowercase, strip trailing dots, collapse
// whitespace. Hyphenated names ("Fladmoe-Lindquist") stay a single token.
function normSurname(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a reference string into its matching key parts.
 * Returns { surname, year } or null when neither can be found.
 * The surname is the text before the first comma (the first author's family
 * name); the year is the first 4-digit year in the string.
 */
export function parseReference(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const yearM = t.match(new RegExp(`\\b(${YEAR})\\b`));
  const year = yearM ? yearM[1] : null;
  // First author chunk: text before the first comma.
  //   APA:      "Ashkanasy" / "Fladmoe-Lindquist"
  //   INFORMS:  "Abbasi A" / "Creswell JW" / "Van de Ven AH"
  const beforeComma = t.split(',')[0].trim();
  const tokens = beforeComma.split(/\s+/).filter(Boolean);
  let surname = tokens[0] || '';
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const initials = /^[A-Z]{1,3}\.?$/.test(last) || /^(?:[A-Z]\.)+$/.test(last);
    surname = initials ? tokens.slice(0, -1).join(' ') : beforeComma;
  }
  if (!surname || !year) return null;
  return { surname: normSurname(surname), year };
}

/**
 * Build an index from "surname:year" → [reference, ...] (multiple works by the
 * same author in the same year share a key; the year-letter suffix like 2006a
 * is not reliably present in the reference text, so we keep all candidates).
 */
export function buildReferenceIndex(references) {
  const index = new Map();
  const add = (key, ref) => {
    const bucket = index.get(key);
    if (bucket) {
      if (!bucket.includes(ref)) bucket.push(ref);
    } else {
      index.set(key, [ref]);
    }
  };
  for (const ref of references || []) {
    const parsed = parseReference(ref.text);
    if (!parsed) continue;
    add(`${parsed.surname}:${parsed.year}`, ref);
    // "von Bertalanffy" / "Van de Ven" also resolve from the last token
    // used in in-text cites ("Bertalanffy, 1972").
    const last = parsed.surname.split(' ').pop();
    if (last && last !== parsed.surname) add(`${last}:${parsed.year}`, ref);
  }
  return index;
}

// First-author surname from an in-text author chunk such as
// "Contractor and Kundu", "Gonzalez et al.", "Lee and Tang", "Samuelson".
function firstAuthorSurname(authorChunk) {
  let s = String(authorChunk || '').trim();
  // Cut at the first author-list separator.
  s = s.split(/\s+et\s+al\.?|\s+and\s+|\s*&\s*|,/i)[0].trim();
  // Keep the last token (handles a stray leading initial), but preserve
  // hyphenated single-token surnames.
  const tokens = s.split(/\s+/);
  return normSurname(tokens[tokens.length - 1]);
}

function resolve(index, authorChunk, year) {
  const surname = firstAuthorSurname(authorChunk);
  if (!surname) return null;
  const bare = year.replace(/[a-z]$/i, '');
  return index.get(`${surname}:${bare}`) || null;
}

// A single in-text citation within a group:
//   "Contractor and Kundu 1998"   APA
//   "Ackoff, 1971"                Harvard / comma-year
//   "Gonzalez et al., 2006a"
const CITE_RE = new RegExp(
  String.raw`([A-Z][A-Za-z.'’\-]*(?:\s+(?:and|&|et\s+al\.?)\s*[A-Za-z.'’\-]*)*?),?\s+(${YEAR}[a-z]?)`,
  'g',
);

// A parenthetical group that contains at least one year.
const PAREN_RE = new RegExp(String.raw`\(([^()]*\b${YEAR}[a-z]?[^()]*)\)`, 'g');

// A narrative citation: "Author (Year)" / "Author and Author (Year)" /
// "Author et al. (Year)".
const NARRATIVE_RE = new RegExp(
  String.raw`\b([A-Z][A-Za-z.'’\-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z.'’\-]+|\s+et\s+al\.?)*)\s+\((${YEAR}[a-z]?)\)`,
  'g',
);

/**
 * Tokenize a text string into an array of segments:
 *   { type: 'text', value }
 *   { type: 'cite', value, refIds: [...] }   // resolved citations only
 *
 * Only citations that resolve against `index` are emitted as 'cite' segments;
 * everything else stays plain text. Returns a single text segment when nothing
 * matches (callers use this to skip untouched nodes).
 */
export function tokenizeCitations(text, index) {
  if (!text || !index || index.size === 0) return [{ type: 'text', value: text }];

  // Collect [start, end, refIds] intervals for resolved citations.
  const spans = [];

  // Parenthetical groups: resolve each individual cite inside, mark just the
  // "Author Year" substring (leaving parens/semicolons as plain text).
  PAREN_RE.lastIndex = 0;
  let pm;
  while ((pm = PAREN_RE.exec(text)) !== null) {
    const groupStart = pm.index + 1; // inside the "("
    const inner = pm[1];
    CITE_RE.lastIndex = 0;
    let cm;
    while ((cm = CITE_RE.exec(inner)) !== null) {
      const refs = resolve(index, cm[1], cm[2]);
      if (!refs) continue;
      const start = groupStart + cm.index;
      spans.push({ start, end: start + cm[0].length, refIds: refs.map((r) => r.id) });
    }
  }

  // Narrative citations across the whole string.
  NARRATIVE_RE.lastIndex = 0;
  let nm;
  while ((nm = NARRATIVE_RE.exec(text)) !== null) {
    const refs = resolve(index, nm[1], nm[2]);
    if (!refs) continue;
    spans.push({ start: nm.index, end: nm.index + nm[0].length, refIds: refs.map((r) => r.id) });
  }

  if (spans.length === 0) return [{ type: 'text', value: text }];

  // Sort and drop overlaps (a narrative match inside a paren is impossible, but
  // guard anyway; keep the earliest, longest).
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start < cursor) continue;
    merged.push(s);
    cursor = s.end;
  }

  const out = [];
  let pos = 0;
  for (const s of merged) {
    if (s.start > pos) out.push({ type: 'text', value: text.slice(pos, s.start) });
    out.push({ type: 'cite', value: text.slice(s.start, s.end), refIds: s.refIds });
    pos = s.end;
  }
  if (pos < text.length) out.push({ type: 'text', value: text.slice(pos) });
  return out;
}

// Ancestor tagNames whose text must never be touched (already links, code,
// math, etc.). KaTeX output is wrapped in spans with a `katex` className,
// guarded separately below.
const SKIP_TAGS = new Set(['a', 'code', 'pre', 'script', 'style', 'textarea']);

function hasKatexClass(node) {
  const cls = node?.properties?.className;
  if (!cls) return false;
  const list = Array.isArray(cls) ? cls : [cls];
  return list.some((c) => String(c).startsWith('katex'));
}

/**
 * rehype plugin factory. Walks the hast tree and splits text nodes that
 * contain resolved author-year citations into a mix of text nodes and
 * anchor (`<a class="cite-ref" data-ref-ids="...">`) elements. The anchor path
 * is reused (rather than a custom tag) because react-markdown reliably maps it
 * to the overridable `a` component.
 *
 * `index` is the surname:year → [ref] map from buildReferenceIndex(). When it
 * is empty the plugin is a no-op, so callers can pass it unconditionally.
 */
export function rehypeCitations(index) {
  return (tree) => {
    if (!index || index.size === 0) return;

    const walk = (node, inSkip) => {
      const children = node.children;
      if (!children || children.length === 0) return;

      let mutated = false;
      const next = [];
      for (const child of children) {
        if (child.type === 'text' && !inSkip) {
          const segs = tokenizeCitations(child.value, index);
          if (segs.length === 1 && segs[0].type === 'text') {
            next.push(child);
            continue;
          }
          mutated = true;
          for (const seg of segs) {
            if (seg.type === 'text') {
              next.push({ type: 'text', value: seg.value });
            } else {
              next.push({
                type: 'element',
                tagName: 'a',
                properties: {
                  className: ['cite-ref'],
                  'data-ref-ids': seg.refIds.join(','),
                },
                children: [{ type: 'text', value: seg.value }],
              });
            }
          }
        } else {
          if (child.type === 'element') {
            const skipChild = inSkip || SKIP_TAGS.has(child.tagName) || hasKatexClass(child);
            walk(child, skipChild);
          }
          next.push(child);
        }
      }
      if (mutated) node.children = next;
    };

    walk(tree, false);
  };
}
