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
  { id: 1, name: 'title' },
  { id: 2, name: 'abstractNote' },
  { id: 3, name: 'date' },
  { id: 4, name: 'DOI' },
  { id: 5, name: 'ISBN' },
  { id: 6, name: 'ISSN' },
  { id: 7, name: 'url' },
  { id: 9, name: 'language' },
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
    fields: [
      'title',
      'abstractNote',
      'publicationTitle',
      'volume',
      'issue',
      'pages',
      'date',
      'DOI',
      'ISSN',
      'url',
      'language',
      'rights',
      'shortTitle',
      'libraryCatalog',
      'archive',
      'archiveLocation',
      'extra',
    ],
    creators: ['author', 'contributor', 'translator', 'editor'],
    primary: 'author',
  },
  {
    id: 2,
    name: 'preprint',
    fields: [
      'title',
      'abstractNote',
      'date',
      'DOI',
      'arXivID',
      'url',
      'language',
      'rights',
      'repository',
      'extra',
    ],
    creators: ['author', 'contributor'],
    primary: 'author',
  },
  {
    id: 3,
    name: 'book',
    fields: [
      'title',
      'abstractNote',
      'numPages',
      'series',
      'seriesNumber',
      'volume',
      'edition',
      'place',
      'publisher',
      'date',
      'ISBN',
      'url',
      'language',
      'rights',
      'shortTitle',
      'callNumber',
      'libraryCatalog',
      'extra',
    ],
    creators: ['author', 'contributor', 'editor', 'translator', 'seriesEditor'],
    primary: 'author',
  },
  {
    id: 4,
    name: 'bookSection',
    fields: [
      'title',
      'abstractNote',
      'bookTitle',
      'series',
      'seriesNumber',
      'volume',
      'edition',
      'place',
      'publisher',
      'pages',
      'date',
      'ISBN',
      'url',
      'language',
      'rights',
      'shortTitle',
      'extra',
    ],
    creators: ['author', 'bookAuthor', 'contributor', 'editor', 'translator', 'seriesEditor'],
    primary: 'author',
  },
  {
    id: 5,
    name: 'conferencePaper',
    fields: [
      'title',
      'abstractNote',
      'proceedingsTitle',
      'conferenceName',
      'place',
      'publisher',
      'pages',
      'date',
      'DOI',
      'url',
      'language',
      'rights',
      'ISBN',
      'shortTitle',
      'extra',
    ],
    creators: ['author', 'contributor', 'translator', 'editor'],
    primary: 'author',
  },
  {
    id: 6,
    name: 'thesis',
    fields: [
      'title',
      'abstractNote',
      'thesisType',
      'university',
      'place',
      'date',
      'numPages',
      'url',
      'language',
      'rights',
      'shortTitle',
      'extra',
    ],
    creators: ['author', 'contributor'],
    primary: 'author',
  },
  {
    id: 7,
    name: 'report',
    fields: [
      'title',
      'abstractNote',
      'reportType',
      'reportNumber',
      'series',
      'place',
      'publisher',
      'pages',
      'date',
      'url',
      'language',
      'rights',
      'shortTitle',
      'extra',
    ],
    creators: ['author', 'contributor', 'translator'],
    primary: 'author',
  },
  {
    id: 8,
    name: 'document',
    fields: [
      'title',
      'abstractNote',
      'date',
      'DOI',
      'ISBN',
      'url',
      'language',
      'rights',
      'publisher',
      'extra',
      'numPages',
      'pages',
    ],
    creators: ['author', 'contributor', 'editor', 'translator'],
    primary: 'author',
  },
];

FIELDS.push({ id: 39, name: 'repository' });

const FIELD_BY_NAME = new Map(FIELDS.map((f) => [f.name, f]));
const CREATOR_BY_NAME = new Map(CREATOR_TYPES.map((c) => [c.name, c]));

/** Build and validate the rows used by the bulk seed statements. */
export function buildSeedRows() {
  const itemTypeFields = [];
  const itemTypeCreatorTypes = [];

  for (const itemType of ITEM_TYPES) {
    for (let orderIndex = 0; orderIndex < itemType.fields.length; orderIndex++) {
      const name = itemType.fields[orderIndex];
      const field = FIELD_BY_NAME.get(name);
      if (!field) throw new Error(`Unknown field "${name}" for itemType "${itemType.name}"`);
      itemTypeFields.push({ itemTypeId: itemType.id, fieldId: field.id, orderIndex });
    }

    for (const name of itemType.creators) {
      const creatorType = CREATOR_BY_NAME.get(name);
      if (!creatorType) {
        throw new Error(`Unknown creator type "${name}" for itemType "${itemType.name}"`);
      }
      itemTypeCreatorTypes.push({
        itemTypeId: itemType.id,
        creatorTypeId: creatorType.id,
        primaryCreator: name === itemType.primary ? 1 : 0,
      });
    }
  }

  return { itemTypeFields, itemTypeCreatorTypes };
}

/**
 * Insert schema definitions. Idempotent via ON CONFLICT.
 */
export async function seed() {
  await initDb();
  const { itemTypeFields, itemTypeCreatorTypes } = buildSeedRows();

  await withTransaction(async (client) => {
    await execute(
      `INSERT INTO "fields"("fieldID", "fieldName", "fieldFormatID")
       SELECT * FROM UNNEST($1::integer[], $2::text[], $3::integer[])
       ON CONFLICT ("fieldID") DO UPDATE SET "fieldName" = EXCLUDED."fieldName"`,
      [FIELDS.map((f) => f.id), FIELDS.map((f) => f.name), FIELDS.map(() => null)],
      client,
    );

    await execute(
      `INSERT INTO "creatorTypes"("creatorTypeID", "creatorType")
       SELECT * FROM UNNEST($1::integer[], $2::text[])
       ON CONFLICT ("creatorTypeID") DO UPDATE SET "creatorType" = EXCLUDED."creatorType"`,
      [CREATOR_TYPES.map((c) => c.id), CREATOR_TYPES.map((c) => c.name)],
      client,
    );

    await execute(
      `INSERT INTO "itemTypes"("itemTypeID", "typeName", custom)
       SELECT * FROM UNNEST($1::integer[], $2::text[], $3::integer[])
       ON CONFLICT ("itemTypeID") DO UPDATE SET "typeName" = EXCLUDED."typeName"`,
      [ITEM_TYPES.map((t) => t.id), ITEM_TYPES.map((t) => t.name), ITEM_TYPES.map(() => 0)],
      client,
    );

    await execute(
      `INSERT INTO "itemTypeFields"("itemTypeID", "fieldID", "orderIndex")
       SELECT * FROM UNNEST($1::integer[], $2::integer[], $3::integer[])
       ON CONFLICT ("itemTypeID", "fieldID")
       DO UPDATE SET "orderIndex" = EXCLUDED."orderIndex"`,
      [
        itemTypeFields.map((row) => row.itemTypeId),
        itemTypeFields.map((row) => row.fieldId),
        itemTypeFields.map((row) => row.orderIndex),
      ],
      client,
    );

    await execute(
      `INSERT INTO "itemTypeCreatorTypes"("itemTypeID", "creatorTypeID", "primaryCreator")
       SELECT * FROM UNNEST($1::integer[], $2::integer[], $3::integer[])
       ON CONFLICT ("itemTypeID", "creatorTypeID")
       DO UPDATE SET "primaryCreator" = EXCLUDED."primaryCreator"`,
      [
        itemTypeCreatorTypes.map((row) => row.itemTypeId),
        itemTypeCreatorTypes.map((row) => row.creatorTypeId),
        itemTypeCreatorTypes.map((row) => row.primaryCreator),
      ],
      client,
    );

    if (BASE_FIELD_MAPPINGS.length > 0) {
      await execute(
        `INSERT INTO "baseFieldMappings"("baseFieldID", "itemTypeID", "fieldID")
         SELECT * FROM UNNEST($1::integer[], $2::integer[], $3::integer[])
         ON CONFLICT DO NOTHING`,
        [
          BASE_FIELD_MAPPINGS.map((row) => row.baseId),
          BASE_FIELD_MAPPINGS.map((row) => row.itemTypeId),
          BASE_FIELD_MAPPINGS.map((row) => row.fieldId),
        ],
        client,
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
    console.log(
      `Seed OK: ${res.itemTypes} itemTypes, ${res.fields} fields, ${res.creatorTypes} creatorTypes`,
    );
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
