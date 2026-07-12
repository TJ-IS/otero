/**
 * Shared PostgreSQL test bootstrap.
 *
 * IMPORTANT: This helper NEVER truncates, drops, or deletes library data.
 * A previous TRUNCATE … CASCADE here wiped the remote production DB when
 * DATABASE_URL pointed at it. Do not reintroduce wipe/reset SQL.
 */
import { initDb, closeDb, setPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { clearSchemaCaches } from '../../src/repositories/itemRepo.js';

/**
 * Ensure schema + dictionary seed exist. Idempotent. Does not touch items.
 */
export async function prepareTestDb() {
  clearSchemaCaches();
  await initDb();
  await runMigrations();
  await seed();
  clearSchemaCaches();
}

/**
 * @deprecated Alias of prepareTestDb. Kept so older test imports still work.
 * Does NOT wipe the database.
 */
export async function resetTestDb() {
  return prepareTestDb();
}

export { closeDb, setPool };
