import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { getDb, closeDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const TARGET_VERSION = config.schemaVersion;

/**
 * Apply schema.sql and record the schema version.
 * Safe to run repeatedly: uses CREATE TABLE IF NOT EXISTS.
 */
export function runMigrations() {
  ensureDataDirs();
  const db = getDb();
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);

  // Migration v1: remove tag tables
  db.exec(`
    DROP TABLE IF EXISTS itemTags;
    DROP TABLE IF EXISTS tags;
  `);

  const row = db.prepare('SELECT version FROM schemaVersion ORDER BY version DESC LIMIT 1').get();
  const current = row?.version ?? 0;
  if (current < TARGET_VERSION) {
    db.prepare('INSERT INTO schemaVersion(version) VALUES (?)').run(TARGET_VERSION);
  }
  return { applied: TARGET_VERSION, previous: current };
}

// CLI entry: `node src/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const res = runMigrations();
    console.log(`Migration OK: schema v${res.applied} (previous v${res.previous})`);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
