import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { initDb, closeDb, queryOne, execute } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.postgres.sql');

const TARGET_VERSION = config.schemaVersion;

/**
 * Additive column upgrades for existing databases.
 * CREATE TABLE IF NOT EXISTS does not add new columns to pre-existing tables,
 * so each version bump that widens a table must ALTER here.
 * NEVER DROP / TRUNCATE / DELETE business data in these steps.
 *
 * Each entry is checked first via information_schema so we do not take an
 * AccessExclusiveLock on every server boot once the column already exists.
 */
const ADDITIVE_COLUMNS = [
  // v5: MinerU full-text search columns on itemFullText
  { table: 'itemFullText', column: 'plainText', ddl: 'ALTER TABLE "itemFullText" ADD COLUMN IF NOT EXISTS "plainText" TEXT' },
  { table: 'itemFullText', column: 'tsv', ddl: 'ALTER TABLE "itemFullText" ADD COLUMN IF NOT EXISTS tsv tsvector' },
  { table: 'itemFullText', column: 'indexedAt', ddl: 'ALTER TABLE "itemFullText" ADD COLUMN IF NOT EXISTS "indexedAt" TEXT' },
];

const ADDITIVE_INDEXES = [
  { name: 'itemFullText_tsv_gin', ddl: 'CREATE INDEX IF NOT EXISTS "itemFullText_tsv_gin" ON "itemFullText" USING GIN (tsv)' },
  { name: 'itemCreators_creator_idx', ddl: 'CREATE INDEX IF NOT EXISTS "itemCreators_creator_idx" ON "itemCreators"("creatorID")' },
];

const TRGM_INDEXES = [
  {
    name: 'creators_name_trgm_idx',
    ddl: `CREATE INDEX IF NOT EXISTS "creators_name_trgm_idx" ON creators USING GIN ((COALESCE("firstName",'') || ' ' || COALESCE("lastName",'')) gin_trgm_ops)`,
  },
  {
    name: 'creators_lastName_trgm_idx',
    ddl: `CREATE INDEX IF NOT EXISTS "creators_lastName_trgm_idx" ON creators USING GIN ("lastName" gin_trgm_ops)`,
  },
  {
    name: 'itemDataValues_value_trgm_idx',
    ddl: `CREATE INDEX IF NOT EXISTS "itemDataValues_value_trgm_idx" ON "itemDataValues" USING GIN (value gin_trgm_ops)`,
  },
];

async function ensureTrgmExtension() {
  try {
    await execute('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    return true;
  } catch (err) {
    console.warn(`[migrate] pg_trgm unavailable, skipping trigram indexes: ${err.message}`);
    return false;
  }
}

async function columnExists(table, column) {
  const row = await queryOne(
    `SELECT 1 AS ok
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return !!row;
}

async function indexExists(name) {
  const row = await queryOne(
    `SELECT 1 AS ok FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
    [name]
  );
  return !!row;
}

/**
 * Apply schema.postgres.sql and record the schema version.
 * Safe to run repeatedly: uses CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
 * Legacy SQLite data-fix migrations (v1–v4) are not replayed on empty PG
 * databases; fresh installs seed directly at TARGET_VERSION.
 */
export async function runMigrations() {
  ensureDataDirs();
  await initDb();
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await execute(sql);

  for (const { table, column, ddl } of ADDITIVE_COLUMNS) {
    if (!(await columnExists(table, column))) {
      await execute(ddl);
    }
  }
  for (const { name, ddl } of ADDITIVE_INDEXES) {
    if (!(await indexExists(name))) {
      await execute(ddl);
    }
  }
  if (await ensureTrgmExtension()) {
    for (const { name, ddl } of TRGM_INDEXES) {
      if (!(await indexExists(name))) {
        await execute(ddl);
      }
    }
    // Partial short-value index cannot be used by bare ILIKE predicates.
    await execute('DROP INDEX IF EXISTS "itemDataValues_short_trgm_idx"');
  }

  const row = await queryOne(
    'SELECT version FROM "schemaVersion" ORDER BY version DESC LIMIT 1'
  );
  const current = row?.version ?? 0;

  if (current < TARGET_VERSION) {
    await execute(
      'INSERT INTO "schemaVersion"(version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
      [TARGET_VERSION]
    );
  }
  return { applied: TARGET_VERSION, previous: current };
}

// CLI entry: `node src/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const res = await runMigrations();
    console.log(`Migration OK: schema v${res.applied} (previous v${res.previous})`);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
