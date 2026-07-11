import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { initDb, closeDb, queryOne, execute } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.postgres.sql');

const TARGET_VERSION = config.schemaVersion;

/**
 * Apply schema.postgres.sql and record the schema version.
 * Safe to run repeatedly: uses CREATE TABLE IF NOT EXISTS.
 * Legacy SQLite data-fix migrations (v1–v4) are not replayed on empty PG
 * databases; fresh installs seed directly at TARGET_VERSION.
 */
export async function runMigrations() {
  ensureDataDirs();
  await initDb();
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await execute(sql);

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
