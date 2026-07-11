import { initDb, closeDb, withTransaction, execute } from './connection.js';

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
  { id: 37, name: 'arXivID' },
];

const BASE_FIELD_MAPPINGS = [];

const ITEM_TYPES = [
  {
    id: 1,
    name: 'journalArticle',
    fields: ['title', 'abstractNote', 'publicationTitle', 'volume', 'issue', 'pages',
             'date', 'DOI', 'ISSN', 'url', 'language', 'rights',
             'shortTitle', 'libraryCatalog', 'archive', 'archiveLocation', 'extra'],
    creators: ['author', 'contributor', 'translator', 'editor'],
    primary: 'author',
  },
  {
    id: 2,
    name: 'preprint',
    fields: ['title', 'abstractNote', 'date', 'DOI', 'arXivID', 'url',
             'language', 'rights', 'repository', 'extra'],
    creators: ['author', 'contributor'],
    primary: 'author',
  },
  {
    id: 3,
    name: 'book',
    fields: ['title', 'abstractNote', 'numPages', 'series', 'seriesNumber', 'volume',
             'edition', 'place', 'publisher', 'date', 'ISBN', 'url',
             'language', 'rights', 'shortTitle', 'callNumber', 'libraryCatalog', 'extra'],
    creators: ['author', 'contributor', 'editor', 'translator', 'seriesEditor'],
    primary: 'author',
  },
  {
    id: 4,
    name: 'bookSection',
    fields: ['title', 'abstractNote', 'bookTitle', 'series', 'seriesNumber', 'volume',
             'edition', 'place', 'publisher', 'pages', 'date', 'ISBN', 'url',
             'language', 'rights', 'shortTitle', 'extra'],
    creators: ['author', 'bookAuthor', 'contributor', 'editor', 'translator', 'seriesEditor'],
    primary: 'author',
  },
  {
    id: 5,
    name: 'conferencePaper',
    fields: ['title', 'abstractNote', 'proceedingsTitle', 'conferenceName', 'place',
             'publisher', 'pages', 'date', 'DOI', 'url', 'language',
             'rights', 'ISBN', 'shortTitle', 'extra'],
    creators: ['author', 'contributor', 'translator', 'editor'],
    primary: 'author',
  },
  {
    id: 6,
    name: 'thesis',
    fields: ['title', 'abstractNote', 'thesisType', 'university', 'place', 'date',
             'numPages', 'url', 'language', 'rights', 'shortTitle', 'extra'],
    creators: ['author', 'contributor'],
    primary: 'author',
  },
  {
    id: 7,
    name: 'report',
    fields: ['title', 'abstractNote', 'reportType', 'reportNumber', 'series', 'place',
             'publisher', 'pages', 'date', 'url', 'language', 'rights',
             'shortTitle', 'extra'],
    creators: ['author', 'contributor', 'translator'],
    primary: 'author',
  },
  {
    id: 8,
    name: 'document',
    fields: ['title', 'abstractNote', 'date', 'DOI', 'ISBN', 'url', 'language',
             'rights', 'publisher', 'extra', 'numPages', 'pages'],
    creators: ['author', 'contributor', 'editor', 'translator'],
    primary: 'author',
  },
];

FIELDS.push({ id: 39, name: 'repository' });

const FIELD_BY_NAME = new Map(FIELDS.map(f => [f.name, f]));
const CREATOR_BY_NAME = new Map(CREATOR_TYPES.map(c => [c.name, c]));

/**
 * Insert schema definitions. Idempotent via ON CONFLICT.
 */
export async function seed() {
  await initDb();
  await withTransaction(async (client) => {
    for (const f of FIELDS) {
      await execute(
        `INSERT INTO "fields"("fieldID", "fieldName", "fieldFormatID") VALUES ($1, $2, NULL)
         ON CONFLICT ("fieldID") DO UPDATE SET "fieldName" = EXCLUDED."fieldName"`,
        [f.id, f.name],
        client
      );
    }
    for (const c of CREATOR_TYPES) {
      await execute(
        `INSERT INTO "creatorTypes"("creatorTypeID", "creatorType") VALUES ($1, $2)
         ON CONFLICT ("creatorTypeID") DO UPDATE SET "creatorType" = EXCLUDED."creatorType"`,
        [c.id, c.name],
        client
      );
    }

    for (const t of ITEM_TYPES) {
      await execute(
        `INSERT INTO "itemTypes"("itemTypeID", "typeName", custom) VALUES ($1, $2, 0)
         ON CONFLICT ("itemTypeID") DO UPDATE SET "typeName" = EXCLUDED."typeName"`,
        [t.id, t.name],
        client
      );
      for (let idx = 0; idx < t.fields.length; idx++) {
        const name = t.fields[idx];
        const f = FIELD_BY_NAME.get(name);
        if (!f) throw new Error(`Unknown field "${name}" for itemType "${t.name}"`);
        await execute(
          `INSERT INTO "itemTypeFields"("itemTypeID", "fieldID", "orderIndex") VALUES ($1, $2, $3)
           ON CONFLICT ("itemTypeID", "fieldID") DO UPDATE SET "orderIndex" = EXCLUDED."orderIndex"`,
          [t.id, f.id, idx],
          client
        );
      }
      for (const name of t.creators) {
        const c = CREATOR_BY_NAME.get(name);
        if (!c) throw new Error(`Unknown creator type "${name}" for itemType "${t.name}"`);
        await execute(
          `INSERT INTO "itemTypeCreatorTypes"("itemTypeID", "creatorTypeID", "primaryCreator")
           VALUES ($1, $2, $3)
           ON CONFLICT ("itemTypeID", "creatorTypeID")
           DO UPDATE SET "primaryCreator" = EXCLUDED."primaryCreator"`,
          [t.id, c.id, name === t.primary ? 1 : 0],
          client
        );
      }
    }

    for (const m of BASE_FIELD_MAPPINGS) {
      await execute(
        `INSERT INTO "baseFieldMappings"("baseFieldID", "itemTypeID", "fieldID") VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [m.baseId, m.itemTypeId, m.fieldId],
        client
      );
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
    const { runMigrations } = await import('./migrate.js');
    await runMigrations();
    const res = await seed();
    console.log(`Seed OK: ${res.itemTypes} itemTypes, ${res.fields} fields, ${res.creatorTypes} creatorTypes`);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
