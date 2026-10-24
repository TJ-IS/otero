/**
 * Deterministic abstract extraction from MinerU markdown / content_list / plainText.
 * No LLM.
 */

const ABSTRACT_HEADING = /^(abstract|summary|synopsis)\.?$/i;
const STOP_HEADING =
  /^(keywords?|key words|introduction|1\b|i\b|article info|article history|acknowledgements?|references|copyright)\b/i;
const BOILERPLATE =
  /taylor & francis makes every effort|please scroll down for article|to cite this article:|to link to this article:|is an assistant professor|received (his|her|their) ph\.?d/i;

export function unsqueezeSpacedLetters(text) {
  return String(text || '').replace(/\b(?:[A-Za-z]\s+){3,}[A-Za-z]\b/g, (m) =>
    m.replace(/\s+/g, ''),
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
  /^(of |and |or |as |that |which |who |whose |where |when |than |then |also |however |thus |therefore |way,|notions |data |metrics |variables\.|framework,|statistics |articles )/i;
const TABLE_NOISE = /\b(quantile|minimum first|measurement \(cm\)|study distance measure)\b/i;

/** Repair MinerU ligature splits and drop publisher footers. */
export function polishAbstract(text) {
  let t = cleanAbstractText(text);
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  t = t.replace(/\b([A-Za-z]{3,}i)\s+fi\s+([A-Za-z]{2,})\b/g, '$1fi$2');
  t = t.replace(/\b([A-Za-z]{3,}i)\s+fl\s+([A-Za-z]{2,})\b/g, '$1fl$2');
  t = t.replace(/\bin\s+fl\s+u/gi, 'influ');
  t = t.replace(/\bde\s+fi\s+n/gi, 'defin');
  t = t.replace(/\s*[©\-–]?\s*\d{4}\s+Elsevier B\.V\. All rights reserved\.?\s*$/i, '');
  t = t.replace(/\s+European Journal of Information Systems\b[\s\S]{0,120}$/i, '');
  t = t.replace(/\s+doi:\s*10\.\S+;?\s*$/i, '');
  t = t.replace(/\s+(?:published online|advance online publication)[\s\S]{0,80}$/i, '');
  return t.replace(/\s+/g, ' ').trim();
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

function takeUntilStop(parts) {
  const out = [];
  for (const raw of parts) {
    const t = cleanAbstractText(raw);
    if (!t) continue;
    if (isStopHeading(t) || /^(keywords?|key words)\s*:/i.test(t)) break;
    if ((/^©|^copyright\b/i.test(t) || /all rights reserved/i.test(t)) && t.length < 120) continue;
    if (t.length < 40 && /doi:|available online|received |accepted /i.test(t)) continue;
    out.push(t);
    if (out.join(' ').length > 2800) break;
  }
  const text = cleanAbstractText(out.join(' '));
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
export function extractAbstractFromPlain(text) {
  if (!text) return null;
  const window = unsqueezeSpacedLetters(String(text).slice(0, 8000));
  const re = /\b(ABSTRACT|Abstract|abstract|SUMMARY|Summary|synopsis)\s*[:.-]?\s+/g;
  let match;
  while ((match = re.exec(window))) {
    const at = match.index;
    const before = window.slice(Math.max(0, at - 40), at);
    if (/\b(keywords?|key words)\s*$/i.test(before)) continue;
    const rest = window.slice(at + match[0].length);
    const stopped = rest.split(
      /\s+(?=(?:Keywords?|Key words|INTRODUCTION|Introduction|1\.\s+Introduction|ARTICLE INFO|Article history|Acknowledgements?|References)\b)/,
    )[0];
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
