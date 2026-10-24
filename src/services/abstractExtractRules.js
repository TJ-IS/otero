/**
 * Deterministic abstract extraction from MinerU markdown / content_list / plainText.
 * No LLM.
 */

const ABSTRACT_HEADING = /^(abstract|summary|synopsis)\.?$/i;

// Heading that ends the abstract. Kept as a whole-block match (anchored at ^) so
// number-only headings such as "1" / "1." / "I." are recognized without letting
// a body block that merely starts with a digit ("1 million users...") match.
const STOP_HEADING = new RegExp(
  '^(?:' +
    'key\\s*words?(?:\\s+and\\s+phrases?)?' +
    '|introduction' +
    '|(?:\\d{1,2}|[ivx]{1,4})(?:[.)](?:\\s+introduction)?|\\s+introduction|\\s*$)' +
    '|article\\s+(?:info|history)' +
    '|jel(?:\\s+classification)?' +
    '|acknowledge?ments?' +
    '|references' +
    '|copyright' +
    ')\\b',
  'i',
);

// Variants of "abstract"/"summary"/"synopsis" including MinerU's letter-spaced
// and mid-word-split headings ("A B S T R A C T", "Abstra ct"). Each letter may
// be separated by whitespace; the \b guards at both ends keep "abstracts" and
// "abstractNote" out.
const ABSTRACT_MENTION =
  /\b(?:a\s*b\s*s\s*t\s*r\s*a\s*c\s*t|s\s*u\s*m\s*m\s*a\s*r\s*y|s\s*y\s*n\s*o\s*p\s*s\s*i\s*s)\b/gi;

const BOILERPLATE =
  /taylor & francis makes every effort|please scroll down for article|to cite this article:|to link to this article:|is an assistant professor|received (his|her|their) ph\.?d/i;

/** Keep the leading separator when squeezing so "M&A A B S T R A C T" does not become "M&AABSTRACT". */
export function unsqueezeSpacedLetters(text) {
  return String(text || '').replace(
    /(^|\s)((?:[A-Za-z]\s+){3,}[A-Za-z])\b/g,
    (_, lead, body) => lead + body.replace(/\s+/g, ''),
  );
}

export function normalizeHeading(text) {
  return unsqueezeSpacedLetters(
    String(text || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

export function isAbstractHeading(text) {
  return ABSTRACT_HEADING.test(normalizeHeading(text));
}

export function isStopHeading(text) {
  return STOP_HEADING.test(normalizeHeading(text));
}

export function cleanAbstractText(text) {
  let v = String(text || '');
  v = v.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  v = v.replace(/[#*_`>~|\\]+/g, ' ');
  v = v.replace(/\s+/g, ' ').trim();
  return v;
}

export function isUsableAbstract(text) {
  const t = cleanAbstractText(text);
  if (t.length < 180 || t.length > 4000) return false;
  if (BOILERPLATE.test(t)) return false;
  if (/^(keywords?|key words)\b/i.test(t)) return false;
  return true;
}

const BAD_OPEN =
  /^(of |and |or |that |which |who |whose |where |than |then |way,|notions |metrics |variables\.|framework,|statistics |articles )/i;
const TABLE_NOISE = /\b(quantile|minimum first|measurement \(cm\)|study distance measure)\b/i;

// Elsevier end-of-abstract footers. OCR frequently mangles "©" into q/D/ã/O/0
// or a stray control byte, drops the year, and/or drops the rights sentence, so
// every part except "Elsevier ... B.V." is optional. Both patterns are anchored
// at the end, which keeps ordinary body mentions ("we thank Elsevier for ...")
// untouched. "Published by Elsevier B.V." must be stripped first: otherwise the
// copyright pattern would remove only "Elsevier B.V." and leave "Published by".
const ELSEVIER_PUBLISHED_FOOTER =
  // eslint-disable-next-line no-control-regex
  /[\s\u0000-\u001f]*(?:\d{4}\s*)?published\s+by\s+Elsevier\s+(?:Science\s+)?B\.?\s*V\.?,?(?:\s*,?\s*(?:A1l|All)\s+rights\s+reserved\.?)?[\s.,;:·\u0000-\u001f]*$/i;
const ELSEVIER_COPYRIGHT_FOOTER =
  // eslint-disable-next-line no-control-regex
  /[\s\u0000-\u001f]*(?:(?:copyright|\(c\)|©)\s*©?\s*|[DdQqãOo0\u0000-\u001f]\s*)?(?:\d{4}\s*)?Elsevier\s+(?:Science\s+)?B\.?\s*V\.?,?(?:\s*,?\s*(?:A1l|All)\s+rights\s+reserved\.?)?[\s.,;:·\u0000-\u001f]*$/i;

/** Remove stacked publisher footers at the very end of the abstract. */
function stripElsevierFooters(text) {
  let out = text;
  let previous;
  do {
    previous = out;
    out = out.replace(ELSEVIER_PUBLISHED_FOOTER, ' ');
    out = out.replace(ELSEVIER_COPYRIGHT_FOOTER, ' ');
  } while (out !== previous);
  return out;
}

/** Repair MinerU ligature splits and drop publisher footers. */
export function polishAbstract(text) {
  let t = cleanAbstractText(text);
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  t = t.replace(/\b([A-Za-z]{3,}i)\s+fi\s+([A-Za-z]{2,})\b/g, '$1fi$2');
  t = t.replace(/\b([A-Za-z]{3,}i)\s+fl\s+([A-Za-z]{2,})\b/g, '$1fl$2');
  t = t.replace(/\bin\s+fl\s+u/gi, 'influ');
  t = t.replace(/\bde\s+fi\s+n/gi, 'defin');
  // MinerU OCR leaves stray control bytes and misread glyphs around the
  // Elsevier copyright line, so the footer patterns allow for that.
  t = stripElsevierFooters(t);
  t = t.replace(/\s+European Journal of Information Systems\b[\s\S]{0,120}$/i, '');
  t = t.replace(/\s+doi:\s*10\.\S+;?\s*$/i, '');
  t = t.replace(/\s+(?:published online|advance online publication)[\s\S]{0,80}$/i, '');
  t = t.replace(/\s+/g, ' ').trim();
  // MinerU sometimes drops the closing period of the abstract's last sentence.
  if (t.length < 4000 && !/[.!?]["”’)\]]*$/.test(t) && /[A-Za-z0-9)\]"”’]$/.test(t)) {
    return `${t}.`;
  }
  return t;
}

/** Reject mid-sentence cuts, tables, and extracts that do not end as a sentence. */
export function isAcceptableExtract(text) {
  const t = polishAbstract(text);
  if (!isUsableAbstract(t)) return false;
  if (!/^[A-Z“"‘']/.test(t)) return false;
  if (BAD_OPEN.test(t)) return false;
  if (TABLE_NOISE.test(t)) return false;
  if (!/[.!?]["”’)\]]*$/.test(t)) return false;
  return true;
}

/**
 * Candidate stop headings inside flattened text. Unlike STOP_HEADING these are
 * matched case-insensitively anywhere (flat text has no lines), so each match
 * is validated below before it is allowed to truncate the abstract.
 */
const FLAT_STOP_TOKEN =
  /\b(key\s*words(?:\s+and\s+phrases?)?|(?:\d{1,2}|[ivx]{1,4})[.)]?\s+introduction|introduction|article\s+(?:info|history)|jel(?:\s+classification)?|acknowledge?ments?|references|copyright)\b/gi;

/** True when a flat-text stop token really looks like a heading, not prose. */
function isFlatHeadingContext(text, index, raw) {
  const before = text.slice(0, index);
  if (before && !/\s$/.test(before)) return false;
  const lower = raw.toLowerCase();
  // Unambiguous section labels: no prose ambiguity worth guarding against.
  if (/^(?:key|article|jel|copyright|acknowledge?ments?|references)/.test(lower)) {
    return true;
  }
  // Numbered heading such as "1. INTRODUCTION" / "II Introduction".
  if (/^(?:\d{1,2}|[ivx]{1,4})[.)]?\s+introduction$/i.test(raw)) return true;
  // "INTRODUCTION" / "REFERENCES" (all caps) are headings regardless of what follows.
  if (raw === raw.toUpperCase() && /[A-Z]/i.test(raw)) return true;
  // Title-case/lowercase: require a heading-like right edge, otherwise
  // "the introduction of ..." or "references to ..." would truncate the body.
  const after = text.slice(index + raw.length);
  if (!after.trim()) return true;
  if (/^[ \t]*[:.\-–—]/.test(after)) return true;
  return /^\s+[A-Z0-9“"'(]/.test(after);
}

/** Index of the first real stop heading in flattened text (or text.length). */
function findStopIndex(text) {
  FLAT_STOP_TOKEN.lastIndex = 0;
  let m;
  while ((m = FLAT_STOP_TOKEN.exec(text))) {
    if (isFlatHeadingContext(text, m.index, m[1])) return m.index;
  }
  return text.length;
}

const MAX_EXTRACT_CHARS = 4000;

/** Trim to the last complete sentence at or before maxLen. */
function truncateAtSentenceBoundary(text, maxLen) {
  if (text.length <= maxLen) return text;
  const head = text.slice(0, maxLen);
  const re = /[.!?]["”’)\]]*/g;
  let end = -1;
  let m;
  while ((m = re.exec(head))) end = m.index + m[0].length;
  return end >= 180 ? head.slice(0, end).trim() : text;
}

function takeUntilStop(parts) {
  const out = [];
  let length = 0;
  for (const raw of parts) {
    const t = cleanAbstractText(raw);
    if (!t) continue;
    if (isStopHeading(t) || /^key\s*words?\b.*:/i.test(t)) break;
    if ((/^©|^copyright\b/i.test(t) || /all rights reserved/i.test(t)) && t.length < 120) continue;
    if (t.length < 40 && /doi:|available online|received |accepted /i.test(t)) continue;
    out.push(t);
    length += (length ? 1 : 0) + t.length;
    if (length > MAX_EXTRACT_CHARS) break;
  }
  const joined = cleanAbstractText(out.join(' '));
  const text = truncateAtSentenceBoundary(joined, MAX_EXTRACT_CHARS);
  return isUsableAbstract(text) ? text : null;
}

/** Extract from MinerU content_list.json blocks. */
export function extractAbstractFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return null;
  const idx = blocks.findIndex((b) => b && b.type === 'text' && isAbstractHeading(b.text));
  if (idx < 0) return null;
  const parts = [];
  for (let i = idx + 1; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b || b.type !== 'text' || !b.text) continue;
    if (b.text_level != null && isStopHeading(b.text)) break;
    parts.push(b.text);
    if (parts.length >= 8) break;
  }
  return takeUntilStop(parts);
}

/** Extract from MinerU full.md. */
export function extractAbstractFromMarkdown(markdown) {
  if (!markdown) return null;
  const lines = String(markdown).split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^#{1,6}\s+/, '').trim();
    if (isAbstractHeading(line)) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return extractAbstractFromPlain(markdown);
  const parts = [];
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const asHeading = raw.match(/^#{1,6}\s+(.*)$/);
    if (asHeading && isStopHeading(asHeading[1])) break;
    if (asHeading && isAbstractHeading(asHeading[1])) continue;
    parts.push(raw);
    if (parts.join('\n').length > 3500) break;
  }
  return takeUntilStop(parts);
}

/**
 * Extract from flattened MinerU plainText (newlines already collapsed).
 * Only searches the opening window so later "abstract" mentions do not match.
 */
const PLAIN_SCAN_LIMIT = 30000;

/** True when an "abstract"-like mention in flat text looks like a heading, not prose. */
function isPlausibleAbstractMention(text, index, raw) {
  const before = text.slice(Math.max(0, index - 60), index);
  // A keyword list pasted immediately before the heading is not the heading.
  if (/\b(?:key\s*words?|key\s*words?\s+and\s+phrases?)\s*[:.\-–—]?\s*$/i.test(before)) {
    return false;
  }
  if (raw === raw.toUpperCase() && /[A-Z]/i.test(raw)) return true;
  const after = text.slice(index + raw.length).replace(/^[ \t]+/, '');
  if (!after) return false;
  if (/^[:.\-–—]/.test(after)) return true;
  // Lower/title-case mentions only count when the next character can start a
  // sentence, which rejects "in this abstract we..." and "abstract concepts".
  return /^[A-Z0-9“"'(]/.test(after);
}

export function extractAbstractFromPlain(text) {
  if (!text) return null;
  // Bounded but generous: publisher cover pages can push the heading past 8k.
  // Scanning further still stops at the first plausible heading + stop token.
  const window = unsqueezeSpacedLetters(String(text).slice(0, PLAIN_SCAN_LIMIT));
  ABSTRACT_MENTION.lastIndex = 0;
  let match;
  while ((match = ABSTRACT_MENTION.exec(window))) {
    const at = match.index;
    if (!isPlausibleAbstractMention(window, at, match[0])) continue;
    const rest = window.slice(at + match[0].length).replace(/^[ \t]*[:.\-–—]?[ \t]+/, '');
    const stopped = rest.slice(0, findStopIndex(rest));
    const textOut = takeUntilStop([stopped]);
    if (textOut) return polishAbstract(textOut);
  }
  return null;
}

export function extractAbstract({ blocks, markdown, plainText } = {}) {
  return (
    extractAbstractFromBlocks(blocks) ||
    extractAbstractFromMarkdown(markdown) ||
    extractAbstractFromPlain(plainText) ||
    null
  );
}
