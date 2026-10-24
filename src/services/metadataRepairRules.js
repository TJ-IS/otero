/**
 * Pure rules for confirmed Basket metadata repairs.
 * No I/O — imported by the repair service and unit tests.
 */

export const TEST_GARBAGE_KEYS = [
  'CKJXGEXF',
  'JM5PH7TV',
  '7B2Z8CYD',
  'GJKA8PRM',
  'FU2XBH9V',
  'QE6RJVSY',
  '8KTG4CDK',
  '9CU5HCWF',
  'XJ5KPBZU',
  '2GS9J5EB',
  'YDY3GVBU',
];

/** Front-matter / CFP rows that should not get authors filled. */
export const SKIP_AUTHOR_KEYS = new Set([
  'UT5BGHEF', // ISR About Our Authors
  'CDS829FP', // ISR Research Spotlights
  'YMSNS34G', // ISJ special-issue CFP
]);

/** ISJ keys whose only stored author is a Wiley production name. */
export const ISJ_PLACEHOLDER_AUTHOR_KEYS = [
  '22JD625G',
  '245CZVP9',
  '5E7F8DA4',
  '5G3HJ8U9',
  '74UQFCND',
  '7W7JC7FV',
  'AYEHWZ8Y',
  'BQ9B86HZ',
  'BUEHQ959',
  'D9SR4QUA',
  'DWNNAMG7',
  'G7PSXWSU',
  'G89HBPQT',
  'JEAKSX2H',
  'K4G9878N',
  'KBRAPR3Y',
  'MCEGEB5Q',
  'MSPU52JA',
  'N9YT2JWT',
  'RVRB86N8',
  'T5N8JK5V',
  'TNRHQ57H',
  'UMS9W6PT',
  'V3YKYRJ2',
  'WDKEBQY2',
  'Z8C9CV8Q',
];

export const JAIS_TEMPLATE_KEYS = ['KEVJY98S', '5GCU8ESG', 'EP2762R9'];

export const MOJIBAKE_TITLE_KEYS = ['R5PVJVBP', 'RZ33SXKC', 'TCGM936Z', '488P6HEQ'];

/** Confirmed date / DOI-year mismatches and month-name dates from the audit. */
export const CONFIRMED_DATE_KEYS = [
  'AXSMXSK3',
  'KMVFKGX3',
  'TKHA4YCG',
  'F7UWEDA4',
  'CMUX873T',
  'HAQ5F4JH',
  'R374K3DC',
  'E99DHPMY',
  '3NCHVF8Y',
  '7TE4K8Y3',
  'V6CK9CF2',
  '4SVHCCZ4',
  'T969BDBA',
  'NW9FUPZ7',
  'DBCPRCYF',
  '88RCHG6D',
  'A3E9XEPT',
  'UKC98EQG',
  'DR87UUWE',
  'U2BMVM86',
  'J5AEF9GJ',
  'YUG89456',
  'CA7C7XT9',
  'DH4BFB93',
  'D2JW4BDU',
  'EBSYFPBV',
  'P7382DUR',
  '9S45QY73',
  'FSMWA42R',
  'NWSJKTGD',
  'Q5W3AJBA',
  '2BWB75XB',
  'HYV5VMK9',
  'QPRYM35G',
  '488P6HEQ',
  'H57YGAXG',
  'YS7CGMRJ',
  'X2E94XM4',
  '23K6MBFD',
  'CT44SBG4',
  'JEEVDHD4',
  'PRMU8K26',
  'XXBDJND5',
  'Y7KHFXCR',
  '45XWTPSG',
  'EMFX93WF',
  'WC7KAXYC',
  '43B7B2B4',
  '5WDMTQWV',
  'C747WD3M',
  'FF53RDRJ',
  'Q3X93J28',
  'KATG9RXE',
  'NRFZ3AXS',
  '5DAX6PXW',
  '7U7MZKVN',
  'D7V9GGND',
  'NR9UGG22',
  '8KDUWTE3',
  'EXHP79V7',
  'ZVXRM3KE',
  '87FSHXZX',
  'QRY4JFBF',
  '3M9QE3DQ',
  'NCXTFWXH',
  '5VKSQJAA',
  'TZRWZGF2',
  'TUHWRMQK',
  'AU59GURT',
  '2MXQC3DB',
  'ABECA7ZW',
  'ZP74J894',
];

export const CONFIRMED_AUTHOR_KEYS = [
  ...ISJ_PLACEHOLDER_AUTHOR_KEYS,
  ...JAIS_TEMPLATE_KEYS,
  'BU4NMEJX',
  'CMX9NSF7',
  '4XMY8FJ3',
  'NBC3ZGGH',
  'WBW94JS8',
  'WVEX32CY',
  'WZHVP52E',
  'EJQRHTU5',
  'HPSYB6WA',
  'C8G9GBJ4',
  'J74E2F5A',
  'Z7BWFWS7',
  'MKJ5NHU6',
  'A694NXJJ',
  '6JWC79P9',
  'A32JKG8C',
  'GEXM96NA',
  'PXRJ7YYC',
  '6M8Q8WK7',
];

export const CONFIRMED_PLACEHOLDER_ABSTRACT_KEYS = [
  'ZVERSBEN',
  'KR9WKDHG',
  '9P4CQ7TV',
  'VC7GBHKB',
  'G95EQYUG',
  'Z7BWFWS7',
  'JRN6BADZ',
  'QVQFHBTJ',
  'KEHA6P95',
  'W2FSKKM6',
  '37KY3ZAY',
  'C278MFP8',
  '6TEV4TVJ',
  '4VYQPPWQ',
  'ZYFJ8Y7T',
  'YYSZWTJ7',
  '9PYYHNW3',
  'D734DMXB',
  'BDEGGNFK',
  'A694NXJJ',
  'J4T5DH4P',
  '6R3HGE2W',
];

const PLACEHOLDER_AUTHOR_LAST = new Set([
  'jene',
  'wendy',
  'joan',
  'fion',
  'dasy1',
  'and',
  'jr.',
  'jr',
]);

const LAST_NAME_ONLY_BROKEN = new Set([
  'recker',
  'rosemann',
  'green',
  'indulska',
  'mild',
  'degross',
]);

/**
 * Deterministic DOI rewrite. Returns the rewritten DOI, or the trimmed original
 * if no rule matches.
 */
export function rewriteDoi(raw) {
  if (raw == null) return '';
  let doi = String(raw).trim();
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  doi = doi.replace(/^doi:\s*/i, '');
  doi = doi.replace(/^10\.17705\/1\.jais\./i, '10.17705/1jais.');
  doi = doi.replace(/^10\.17005\/1jais\./i, '10.17705/1jais.');
  doi = doi.replace(/10\.1016\/i[,.]dss[,.]/gi, '10.1016/j.dss.');
  doi = doi.replace(/10\.1016\/i[,.]im[,.]/gi, '10.1016/j.im.');
  return doi;
}

export function normalizeDoi(raw) {
  return rewriteDoi(raw).toLowerCase();
}

export function doisEqual(a, b) {
  return normalizeDoi(a) === normalizeDoi(b);
}

export function parseYear(dateStr) {
  if (dateStr == null || dateStr === '') return null;
  const m = String(dateStr).match(/\b((?:19|20)\d{2})\b/);
  return m ? Number(m[1]) : null;
}

export function isYearOnlyDate(dateStr) {
  return /^\d{4}$/.test(String(dateStr || '').trim());
}

/** True when Crossref year should replace the stored date. */
export function shouldOverwriteDate(current, suggested) {
  const sugYear = parseYear(suggested);
  if (sugYear == null) return false;
  if (!isYearOnlyDate(current)) return true;
  const curYear = parseYear(current);
  if (curYear == null) return true;
  return Math.abs(sugYear - curYear) >= 3;
}

export function shouldOverwriteTitle(current) {
  const t = String(current || '');
  if (/^JAIS Author Template$/i.test(t.trim())) return true;
  if (/â•|â€|Ã.|�/.test(t)) return true;
  return false;
}

export function creatorLooksBroken(c) {
  if (!c) return true;
  const first = String(c.firstName || '').trim();
  const last = String(c.lastName || '').trim();
  if (!first && !last) return true;
  if (/^and[ .]/i.test(first)) return true;
  if (PLACEHOLDER_AUTHOR_LAST.has(last.toLowerCase())) return true;
  if (!first && LAST_NAME_ONLY_BROKEN.has(last.toLowerCase())) return true;
  if (/t17855/i.test(last) || /t17855/i.test(first)) return true;
  return false;
}

/** Replace the whole creator list when Crossref has authors and current is broken. */
export function shouldReplaceCreators(creators) {
  const list = Array.isArray(creators) ? creators : [];
  if (list.length === 0) return true;
  return list.some(creatorLooksBroken);
}

export function stripMarkup(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPlaceholderAbstract(text) {
  const raw = String(text ?? '');
  const t = stripMarkup(raw);
  if (!t) return true;
  if (/<jats:p\s*\/>/i.test(raw)) return true;
  if (
    t.length <= 120 &&
    /^(research (article|articles|note|essay)|issues and opinions|special issue\b|spotlight|application abstract|practice)/i.test(
      t,
    )
  ) {
    return true;
  }
  if (t.length < 200 && /corrected proof|accepted manuscript/i.test(t)) return true;
  if (t.length < 200 && /doi:\s*10\./i.test(t)) return true;
  return false;
}

export function hasSubstantialAbstract(text) {
  return stripMarkup(text).length >= 80 && !isPlaceholderAbstract(text);
}

/**
 * Fill abstract only when Crossref has a real one and the stored value is a
 * placeholder. Empty abstracts are filled only for the confirmed audit keys
 * (`allowEmpty`), never as a corpus-wide backfill.
 */
export function shouldOverwriteAbstract(current, suggested, { allowEmpty = false } = {}) {
  if (!hasSubstantialAbstract(suggested)) return false;
  if (!isPlaceholderAbstract(current)) return false;
  if (!String(current || '').trim()) return allowEmpty;
  return true;
}

export function isTestGarbage({ title, date, doi } = {}) {
  const t = String(title || '');
  const d = String(date || '');
  const hasDoi = Boolean(String(doi || '').trim());
  if (hasDoi) return false;
  if (/t17855/i.test(t)) return true;
  if (/209[789]/.test(d)) return true;
  if (/^Paper [123]\b/i.test(t) && /2099/.test(d)) return true;
  if (/^MISQ 209[78]/i.test(t)) return true;
  return false;
}

export function phase3KeySet() {
  return new Set([
    ...JAIS_TEMPLATE_KEYS,
    ...MOJIBAKE_TITLE_KEYS,
    ...CONFIRMED_DATE_KEYS,
    ...CONFIRMED_AUTHOR_KEYS,
    ...CONFIRMED_PLACEHOLDER_ABSTRACT_KEYS,
  ]);
}
