// Fixed whitelist of the 11 AIS Senior Scholars' Basket journals this
// collection focuses on. Frozen so classification stays stable regardless of
// what new imports carry.
//
// This is the SINGLE backend source of truth for the basket list.
// `src/services/calibrateService.js` imports from here, and the frontend copy
// in `web/src/lib/items.js` MUST stay in sync (kept separate because the web
// bundle has no shared module path with the Node backend).
//
// Classification is virtual: the original publicationTitle value is never
// rewritten. Anything not in this list (or with no publicationTitle) is
// bucketed into UNFILED at query time.
//
// Note: values use the canonical "&" (not the HTML entity "&amp;").
// CrossRef's JSON HTML-escapes ampersands in container-title; metadataMapper
// decodes them on import and migration v3 cleans any pre-existing rows.

export const JOURNAL_WHITELIST = [
  'MIS Quarterly',
  'Information Systems Research',
  'Journal of Management Information Systems',
  'Journal of the Association for Information Systems',
  'European Journal of Information Systems',
  'Information Systems Journal',
  'Information and Organization',
  'Decision Support Systems',
  'Journal of Information Technology',
  'The Journal of Strategic Information Systems',
  'Information & Management',
];

export const UNFILED = '待归档';

const WHITELIST_SET = new Set(JOURNAL_WHITELIST);

// Returns the journal name if pubTitle is in the whitelist, otherwise UNFILED.
// null/undefined/empty publicationTitle also maps to UNFILED.
export function classifyJournal(pubTitle) {
  if (!pubTitle) return UNFILED;
  return WHITELIST_SET.has(pubTitle) ? pubTitle : UNFILED;
}
