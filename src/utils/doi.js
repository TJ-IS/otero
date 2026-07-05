// DOI detection / extraction. Reference: https://www.doi.org/doi_handbook/2_Numbering.html
// Crossref's recommended regex is used in practice.

const DOI_REGEX = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/g;

/** Extract the first DOI from arbitrary text. */
export function extractDoi(text) {
  if (!text) return null;
  const m = text.match(DOI_REGEX);
  if (!m || m.length === 0) return null;
  return normalizeDoi(m[0]);
}

/** Find all DOIs in text. */
export function extractAllDois(text) {
  if (!text) return [];
  return Array.from(new Set((text.match(DOI_REGEX) || []).map(normalizeDoi)));
}

/** Lowercase, trim trailing punctuation that is not part of the DOI. */
export function normalizeDoi(doi) {
  if (!doi) return null;
  let s = String(doi).trim();
  // Strip URL prefix if present.
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  // Strip trailing punctuation that's almost certainly sentence-ending.
  s = s.replace(/[.;,)\]]+$/, '');
  return s;
}

/** True when s looks like a syntactically plausible DOI. */
export function isDoi(s) {
  if (!s) return false;
  return /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(s);
}
