import { getDb, closeDb, tx } from './connection.js';

/**
 * Seed schema definitions (itemTypes, fields, creatorTypes and their join tables).
 *
 * Names mirror Zotero's canonical schema so that metadata returned by
 * CrossRef / arXiv / OpenLibrary can be mapped by name without translation.
 * Numeric IDs are assigned sequentially starting at 1; only name stability
 * is required by downstream code.
 */

const CREATOR_TYPES = [
  { id: 1, name: 'author' },
  { id: 2, name: 'contributor' },
  { id: 3, name: 'editor' },
  { id: 4, name: 'translator' },
  { id: 5, name: 'seriesEditor' },
  { id: 6, name: 'bookAuthor' },
  { id: 7, name: 'director' },
  { id: 8, name: 'presenter' },
  { id: 9, name: 'performer' },
  { id: 10, name: 'composer' },
  { id: 11, name: 'programmer' },
];

const FIELDS = [
  { id: 1,  name: 'title' },
  { id: 2,  name: 'abstractNote' },
  { id: 3,  name: 'date' },
  { id: 4,  name: 'DOI' },
  { id: 5,  name: 'ISBN' },
  { id: 6,  name: 'ISSN' },
  { id: 7,  name: 'url' },
  { id: 8,  name: 'accessDate' },
  { id: 9,  name: 'language' },
  { id: 10, name: 'rights' },
  { id: 11, name: 'pages' },
  { id: 12, name: 'volume' },
  { id: 13, name: 'issue' },
  { id: 14, name: 'edition' },
  { id: 15, name: 'series' },
  { id: 16, name: 'seriesNumber' },
  { id: 17, name: 'seriesTitle' },
  { id: 18, name: 'shortTitle' },
  { id: 19, name: 'callNumber' },
  { id: 20, name: 'publicationTitle' },
  { id: 21, name: 'place' },
  { id: 22, name: 'publisher' },
  { id: 23, name: 'extra' },
  { id: 24, name: 'bookTitle' },
  { id: 25, name: 'conferenceName' },
  { id: 26, name: 'proceedingsTitle' },
  { id: 27, name: 'university' },
  { id: 28, name: 'numPages' },
  { id: 29, name: 'thesisType' },
  { id: 30, name: 'reportType' },
  { id: 31, name: 'reportNumber' },
  { id: 32, name: 'libraryCatalog' },
  { id: 33, name: 'archive' },
  { id: 34, name: 'archiveLocation' },
  { id: 35, name: 'PMID' },
  { id: 36, name: 'PMCID' },
  { id: 37, name: 'arXivID' }, // Otero extension; stored in `extra` by Zotero
  { id: 38, name: 'publicationTitleAbbrev' }, // journalAbbreviation
];

// Base-field mappings (target field -> base field). Stored as (baseFieldID, itemTypeID, fieldID).
// For v1 we keep this minimal: no alternate field names per item type.
const BASE_FIELD_MAPPINGS = [];

// Item type definitions: name, ordered list of field names, ordered list of creator types, primary creator.
const ITEM_TYPES = [
  {
    id: 1,
    name: 'journalArticle',
    fields: ['title', 'abstractNote', 'publicationTitle', 'volume', 'issue', 'pages',
             'date', 'DOI', 'ISSN', 'url', 'accessDate', 'language', 'rights',
             'shortTitle', 'libraryCatalog', 'archive', 'archiveLocation', 'extra',
             'publicationTitleAbbrev'],
    creators: ['author', 'contributor', 'translator', 'editor'],
    primary: 'author',
  },
  {
    id: 2,
    name: 'preprint',
    fields: ['title', 'abstractNote', 'date', 'DOI', 'arXivID', 'url', 'accessDate',
             'language', 'rights', 'repository', 'extra'],
    creators: ['author', 'contributor'],
    primary: 'author',
  },
  {
    id: 3,
    name: 'book',
    fields: ['title', 'abstractNote', 'numPages', 'series', 'seriesNumber', 'volume',
             'edition', 'place', 'publisher', 'date', 'ISBN', 'url', 'accessDate',
             'language', 'rights', 'shortTitle', 'callNumber', 'libraryCatalog', 'extra'],
    creators: ['author', 'contributor', 'editor', 'translator', 'seriesEditor'],
    primary: 'author',
  },
  {
    id: 4,
    name: 'bookSection',
    fields: ['title', 'abstractNote', 'bookTitle', 'series', 'seriesNumber', 'volume',
             'edition', 'place', 'publisher', 'pages', 'date', 'ISBN', 'url',
             'accessDate', 'language', 'rights', 'shortTitle', 'extra'],
    creators: ['author', 'bookAuthor', 'contributor', 'editor', 'translator', 'seriesEditor'],
    primary: 'author',
  },
  {
    id: 5,
    name: 'conferencePaper',
    fields: ['title', 'abstractNote', 'proceedingsTitle', 'conferenceName', 'place',
             'publisher', 'pages', 'date', 'DOI', 'url', 'accessDate', 'language',
             'rights', 'ISBN', 'shortTitle', 'extra'],
    creators: ['author', 'contributor', 'translator', 'editor'],
    primary: 'author',
  },
  {
    id: 6,
    name: 'thesis',
    fields: ['title', 'abstractNote', 'thesisType', 'university', 'place', 'date',
             'numPages', 'url', 'accessDate', 'language', 'rights', 'shortTitle', 'extra'],
    creators: ['author', 'contributor'],
    primary: 'author',
  },
  {
    id: 7,
    name: 'report',
    fields: ['title', 'abstractNote', 'reportType', 'reportNumber', 'series', 'place',
             'publisher', 'pages', 'date', 'url', 'accessDate', 'language', 'rights',
             'shortTitle', 'extra'],
    creators: ['author', 'contributor', 'translator'],
    primary: 'author',
  },
  {
    id: 8,
    name: 'document',
    fields: ['title', 'abstractNote', 'date', 'DOI', 'ISBN', 'url', 'accessDate', 'language',
             'rights', 'publisher', 'extra', 'numPages', 'pages'],
    creators: ['author', 'contributor', 'editor', 'translator'],
    primary: 'author',
  },
];

// 'repository' is referenced by preprint but is not in our 38-field list. Add it.
// (Zotero stores it as a field on preprint; we add it as an extra Otero field.)
FIELDS.push({ id: 39, name: 'repository' });

const FIELD_BY_NAME = new Map(FIELDS.map(f => [f.name, f]));
const CREATOR_BY_NAME = new Map(CREATOR_TYPES.map(c => [c.name, c]));

/**
 * Insert schema definitions. Idempotent: uses INSERT OR IGNORE / REPLACE.
 */
export function seed() {
  const db = getDb();
  tx(() => {
    const insType = db.prepare('INSERT OR REPLACE INTO itemTypes(itemTypeID, typeName, custom) VALUES (?, ?, 0)');
    const insField = db.prepare('INSERT OR REPLACE INTO fields(fieldID, fieldName, fieldFormatID) VALUES (?, ?, NULL)');
    const insCreator = db.prepare('INSERT OR REPLACE INTO creatorTypes(creatorTypeID, creatorType) VALUES (?, ?)');
    const insTypeField = db.prepare(
      'INSERT OR REPLACE INTO itemTypeFields(itemTypeID, fieldID, orderIndex) VALUES (?, ?, ?)'
    );
    const insTypeCreator = db.prepare(
      'INSERT OR REPLACE INTO itemTypeCreatorTypes(itemTypeID, creatorTypeID, primaryCreator) VALUES (?, ?, ?)'
    );
    const insMapping = db.prepare(
      'INSERT OR IGNORE INTO baseFieldMappings(baseFieldID, itemTypeID, fieldID) VALUES (?, ?, ?)'
    );

    for (const f of FIELDS) insField.run(f.id, f.name);
    for (const c of CREATOR_TYPES) insCreator.run(c.id, c.name);

    for (const t of ITEM_TYPES) {
      insType.run(t.id, t.name);
      t.fields.forEach((name, idx) => {
        const f = FIELD_BY_NAME.get(name);
        if (!f) throw new Error(`Unknown field "${name}" for itemType "${t.name}"`);
        insTypeField.run(t.id, f.id, idx);
      });
      t.creators.forEach((name) => {
        const c = CREATOR_BY_NAME.get(name);
        if (!c) throw new Error(`Unknown creator type "${name}" for itemType "${t.name}"`);
        insTypeCreator.run(t.id, c.id, name === t.primary ? 1 : 0);
      });
    }

    for (const m of BASE_FIELD_MAPPINGS) {
      insMapping.run(m.baseId, m.itemTypeId, m.fieldId);
    }
  });

  return {
    itemTypes: ITEM_TYPES.length,
    fields: FIELDS.length,
    creatorTypes: CREATOR_TYPES.length,
  };
}

// CLI entry: `node src/db/seed.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    // Ensure schema exists before seeding.
    const { runMigrations } = await import('./migrate.js');
    runMigrations();
    const res = seed();
    console.log(`Seed OK: ${res.itemTypes} itemTypes, ${res.fields} fields, ${res.creatorTypes} creatorTypes`);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
