/**
 * Display metadata for the 11 AIS Senior Scholars' Basket journals.
 * FRONTEND copy of `src/services/journalMeta.js` — keep in sync.
 * `test/journalWhitelist.test.js` asserts the two lists match.
 */
export const JOURNAL_META = [
  {
    name: 'MIS Quarterly',
    abbr: 'MISQ',
    publisher: 'MIS Research Center, University of Minnesota',
    homepage: 'https://misq.umn.edu/',
  },
  {
    name: 'Information Systems Research',
    abbr: 'ISR',
    publisher: 'INFORMS',
    homepage: 'https://pubsonline.informs.org/journal/isre',
  },
  {
    name: 'Journal of Management Information Systems',
    abbr: 'JMIS',
    publisher: 'Taylor & Francis',
    homepage: 'https://www.tandfonline.com/journals/mmis20',
  },
  {
    name: 'Journal of the Association for Information Systems',
    abbr: 'JAIS',
    publisher: 'Association for Information Systems',
    homepage: 'https://aisel.aisnet.org/jais/',
  },
  {
    name: 'European Journal of Information Systems',
    abbr: 'EJIS',
    publisher: 'Taylor & Francis',
    homepage: 'https://www.tandfonline.com/journals/tjis20',
  },
  {
    name: 'Information Systems Journal',
    abbr: 'ISJ',
    publisher: 'Wiley',
    homepage: 'https://onlinelibrary.wiley.com/journal/13652575',
  },
  {
    name: 'Information and Organization',
    abbr: 'I&O',
    publisher: 'Elsevier',
    homepage: 'https://www.sciencedirect.com/journal/information-and-organization',
  },
  {
    name: 'Decision Support Systems',
    abbr: 'DSS',
    publisher: 'Elsevier',
    homepage: 'https://www.sciencedirect.com/journal/decision-support-systems',
  },
  {
    name: 'Journal of Information Technology',
    abbr: 'JIT',
    publisher: 'SAGE',
    homepage: 'https://journals.sagepub.com/home/jin',
  },
  {
    name: 'The Journal of Strategic Information Systems',
    abbr: 'JSIS',
    publisher: 'Elsevier',
    homepage: 'https://www.sciencedirect.com/journal/the-journal-of-strategic-information-systems',
  },
  {
    name: 'Information & Management',
    abbr: 'I&M',
    publisher: 'Elsevier',
    homepage: 'https://www.sciencedirect.com/journal/information-and-management',
  },
];

export function journalMetaByName(name) {
  return JOURNAL_META.find((j) => j.name === name) || null;
}
