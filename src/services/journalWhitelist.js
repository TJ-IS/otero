// Fixed whitelist of the 11 journals this collection focuses on.
// Extracted once from the live DB (distinct publicationTitle values) and frozen
// so that classification is stable regardless of what new imports carry.
//
// Classification is virtual: the original publicationTitle value is never
// rewritten. Anything not in this list (or with no publicationTitle) is
// bucketed into UNFILED at query time.

export const JOURNAL_WHITELIST = [
  'Decision Support Systems',
  'European Journal of Information Systems',
  'Information &amp; Management',
  'Information Systems Journal',
  'Information Systems Research',
  'Information and Organization',
  'Journal of Information Technology',
  'Journal of Management Information Systems',
  'Journal of the Association for Information Systems',
  'MIS Quarterly',
  'The Journal of Strategic Information Systems',
];

export const UNFILED = '待归档';

const WHITELIST_SET = new Set(JOURNAL_WHITELIST);

// Returns the journal name if pubTitle is in the whitelist, otherwise UNFILED.
// null/undefined/empty publicationTitle also maps to UNFILED.
export function classifyJournal(pubTitle) {
  if (!pubTitle) return UNFILED;
  return WHITELIST_SET.has(pubTitle) ? pubTitle : UNFILED;
}
