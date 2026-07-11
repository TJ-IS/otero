/**
 * Shared PostgreSQL test bootstrap.
 * Requires DATABASE_URL (compose postgres). Each suite should call
 * resetTestDb() in before() to get a clean schema + seed.
 */
import { initDb, closeDb, execute, setPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { clearSchemaCaches } from '../../src/repositories/itemRepo.js';

const WIPE_SQL = `
  TRUNCATE
    "itemTypeCreatorTypes", "itemTypeFields", "baseFieldMappings",
    "itemCreators", "itemData", "itemAttachments", "itemNotes",
    "itemAnnotations", "itemRelations", "itemFullText", "collectionItems",
    "collections", "items", "creators", "itemDataValues",
    "itemTypes", "fields", "creatorTypes", "settings", "schemaVersion"
  RESTART IDENTITY CASCADE
`;

export async function resetTestDb() {
  clearSchemaCaches();
  await initDb();
  await runMigrations();
  await execute(WIPE_SQL);
  clearSchemaCaches();
  await seed();
  clearSchemaCaches();
}

export { closeDb, setPool };
