import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDirs } from '../config.js';
import { getDb, closeDb, tx } from './connection.js';
import { UNFILED } from '../services/journalWhitelist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const TARGET_VERSION = config.schemaVersion;

// CrossRef HTML-escapes ampersands (and a few other chars) inside JSON string
// values, so pre-fix imports stored e.g. "Information &amp; Management" as the
// publicationTitle. v3 decodes these entities in stored title/publicationTitle
// values so the canonical text matches the whitelist.
const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
const ENTITY_RE = /&(#39|amp|lt|gt|quot|apos);/g;
function decodeEntities(s) {
  return String(s).replace(ENTITY_RE, (_, e) => ENTITY_MAP[e] ?? _);
}

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

  // Migration v3: decode HTML entities in stored publicationTitle / title values.
  // Only touches values attached to those two fields to avoid disturbing other
  // text. When the decoded string already exists as another valueID, reassign
  // itemData rows to the existing one and drop the orphaned old value row
  // (itemDataValues.value is UNIQUE, so an in-place update would collide).
  if (current < 3) {
    migrateDecodeEntities(db);
  }

  // Migration v4: unify the "unfiled" sentinel. Early calibrate code wrote
  // "未归档" as publicationTitle; the canonical sentinel is UNFILED ("待归档").
  // Rename any lingering "未归档" publicationTitle values so they match the
  // whitelist's UNFILED exactly (classifyJournal would bucket either as
  // UNFILED anyway, but storing the canonical string keeps the data clean).
  if (current < 4) {
    migrateUnifyUnfiled(db);
  }

  if (current < TARGET_VERSION) {
    db.prepare('INSERT INTO schemaVersion(version) VALUES (?)').run(TARGET_VERSION);
  }
  return { applied: TARGET_VERSION, previous: current };
}

function migrateDecodeEntities(db) {
  const fieldRows = db.prepare(
    `SELECT fieldID FROM fields WHERE fieldName IN ('publicationTitle', 'title')`
  ).all();
  if (fieldRows.length === 0) return;

  let decodedCount = 0;
  let mergedCount = 0;
  for (const { fieldID } of fieldRows) {
    // Pre-filter with LIKE (index-friendly enough) then confirm in JS since
    // better-sqlite3 has no REGEXP built in.
    const rows = db.prepare(`
      SELECT DISTINCT v.valueID, v.value
      FROM itemDataValues v
      JOIN itemData d ON d.valueID = v.valueID
      WHERE d.fieldID = ? AND v.value LIKE '%&%'
    `).all(fieldID);
    const toFix = rows.filter(r => {
      ENTITY_RE.lastIndex = 0;
      return ENTITY_RE.test(r.value);
    });

    for (const r of toFix) {
      const decoded = decodeEntities(r.value);
      if (decoded === r.value) continue;
      const existing = db.prepare('SELECT valueID FROM itemDataValues WHERE value = ?').get(decoded);
      tx(() => {
        if (existing) {
          db.prepare('UPDATE itemData SET valueID = ? WHERE fieldID = ? AND valueID = ?')
            .run(existing.valueID, fieldID, r.valueID);
          db.prepare('DELETE FROM itemDataValues WHERE valueID = ?').run(r.valueID);
          mergedCount++;
        } else {
          db.prepare('UPDATE itemDataValues SET value = ? WHERE valueID = ?').run(decoded, r.valueID);
          decodedCount++;
        }
      });
    }
  }
  if (decodedCount || mergedCount) {
    console.log(`[migrate v3] decoded ${decodedCount} value(s), merged ${mergedCount} duplicate(s)`);
  }
}

const LEGACY_UNFILED = '未归档';

function migrateUnifyUnfiled(db) {
  const jfid = db.prepare("SELECT fieldID FROM fields WHERE fieldName='publicationTitle'").get()?.fieldID;
  if (!jfid) return;
  // Find the valueID holding the legacy sentinel.
  const legacy = db.prepare('SELECT valueID FROM itemDataValues WHERE value = ?').get(LEGACY_UNFILED);
  if (!legacy) return;
  // Find or create the canonical UNFILED valueID.
  let canonical = db.prepare('SELECT valueID FROM itemDataValues WHERE value = ?').get(UNFILED);
  tx(() => {
    if (!canonical) {
      // Reuse the legacy valueID by renaming it (no rows to merge).
      db.prepare('UPDATE itemDataValues SET value = ? WHERE valueID = ?').run(UNFILED, legacy.valueID);
      console.log(`[migrate v4] renamed "未归档" -> "${UNFILED}"`);
      return;
    }
    // Both exist: reassign itemData rows pointing at the legacy valueID to the
    // canonical one, then drop the orphaned legacy value row.
    const n = db.prepare('UPDATE itemData SET valueID = ? WHERE fieldID = ? AND valueID = ?')
      .run(canonical.valueID, jfid, legacy.valueID).changes;
    db.prepare('DELETE FROM itemDataValues WHERE valueID = ?').run(legacy.valueID);
    console.log(`[migrate v4] merged ${n} row(s) from "未归档" into "${UNFILED}"`);
  });
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
