// ISBN utilities: validation, normalization (strip dashes/spaces), and
// ISBN-10 <-> ISBN-13 conversion. Mirrors Zotero's ISBN handling.

/** Remove non-digit/X characters except keep 'X' as check digit at end. */
export function cleanIsbn(s) {
  if (!s) return null;
  const cleaned = String(s)
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return null;
}

/** Validate check digit for ISBN-10 or ISBN-13. */
export function isValidIsbn(s) {
  const v = cleanIsbn(s);
  if (!v) return false;
  return v.length === 10 ? isValidIsbn10(v) : isValidIsbn13(v);
}

function isValidIsbn10(v) {
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = v.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += d * (10 - i);
  }
  const last = v[9];
  sum += last === 'X' ? 10 : Number(last);
  return sum % 11 === 0;
}

function isValidIsbn13(v) {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const d = v.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    sum += d * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

/** Convert an ISBN-10 to its ISBN-13 form (978-prefixed). Pass through if already 13. */
export function toIsbn13(s) {
  const v = cleanIsbn(s);
  if (!v) return null;
  if (v.length === 13) return v;
  if (v.length !== 10) return null;
  const core = '978' + v.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return core + String(check);
}

/** Format an ISBN-13 with standard hyphens (rough heuristic). */
export function formatIsbn(s) {
  const v = cleanIsbn(s);
  if (!v) return null;
  const i13 = toIsbn13(v);
  if (!i13) return null;
  // Generic grouping: 978-1-2345-6789-0. Registration group length varies;
  // this is a best-effort display formatter.
  return `${i13.slice(0, 3)}-${i13.slice(3, 4)}-${i13.slice(4, 8)}-${i13.slice(8, 12)}-${i13.slice(12)}`;
}

/** Extract the first valid ISBN-13 from arbitrary text (handles hyphens/spaces). */
export function extractIsbn(text) {
  if (!text) return null;
  // Walk through text collecting runs of digits/X, then test each as a candidate.
  const matches = text.match(/[0-9Xx][0-9\- Xx]*[0-9Xx]/g) || [];
  for (const raw of matches) {
    const v = cleanIsbn(raw);
    if (v && isValidIsbn(v)) return toIsbn13(v);
  }
  return null;
}
