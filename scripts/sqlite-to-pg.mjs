#!/usr/bin/env node
/**
 * Copy data from a SQLite otero.db into PostgreSQL.
 *
 * Usage:
 *   node scripts/sqlite-to-pg.mjs --wipe
 *   node scripts/sqlite-to-pg.mjs --sqlite=./data/otero.db --wipe
 *
 * Requires DATABASE_URL in the environment / .env.
 * Source SQLite is opened read-only via node:sqlite (no better-sqlite3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';
import { config, ensureDataDirs } from '../src/config.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { initDb, closeDb, execute, query, queryOne } from '../src/db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SQLITE_PATH = path.resolve(projectRoot, args.sqlite || 'data/otero.db');
const WIPE = Boolean(args.wipe);

/** Tables in FK-safe insert order (parents before children). */
const TABLES = [
  'itemTypes',
  'fields',
  'itemTypeFields',
  'baseFieldMappings',
  'creatorTypes',
  'itemTypeCreatorTypes',
  'itemDataValues',
  'items',
  'itemData',
  'creators',
  'itemCreators',
  'collections',
  'collectionItems',
  'itemAttachments',
  'itemNotes',
  'itemAnnotations',
  'itemRelations',
  'settings',
  'itemFullText',
  'schemaVersion',
];

/** IDENTITY columns that need setval after import. */
const IDENTITY_COLUMNS = [
  ['items', 'itemID'],
  ['itemDataValues', 'valueID'],
  ['creators', 'creatorID'],
  ['collections', 'collectionID'],
];

function sqliteAll(db, sql) {
  return db.prepare(sql).all();
}

function sqliteCount(db, table) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row?.n ?? 0);
}

async function wipePg() {
  // CASCADE truncates dependents regardless of order.
  const names = TABLES.map(t => `"${t}"`).join(', ');
  await execute(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function copyTable(sqlite, table) {
  let rows;
  try {
    rows = sqliteAll(sqlite, `SELECT * FROM ${table}`);
  } catch (err) {
    if (/no such table/i.test(err.message)) {
      console.log(`  skip ${table} (missing in SQLite)`);
      return { table, sqlite: 0, inserted: 0 };
    }
    throw err;
  }
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows`);
    return { table, sqlite: 0, inserted: 0 };
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map(quoteIdent).join(', ');
  const batchSize = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    if (table === 'itemAttachments') {
      for (const row of batch) {
        if (row.mtime != null) row.mtime = Math.round(Number(row.mtime));
      }
    }
    // Row-by-row for itemDataValues (large abstracts + hash unique index).
    if (table === 'itemDataValues') {
      for (const row of batch) {
        const params = cols.map(c => row[c] ?? null);
        const placeholders = cols.map((_, ci) => `$${ci + 1}`).join(', ');
        await execute(
          `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES (${placeholders})
           ON CONFLICT DO NOTHING`,
          params
        );
        inserted++;
      }
      continue;
    }
    const params = [];
    const valueGroups = batch.map((row, ri) => {
      const placeholders = cols.map((c, ci) => {
        params.push(row[c] ?? null);
        return `$${ri * cols.length + ci + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await execute(
      `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${valueGroups.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
    inserted += batch.length;
  }

  console.log(`  ${table}: ${rows.length} rows`);
  return { table, sqlite: rows.length, inserted };
}

async function syncSequences() {
  for (const [table, col] of IDENTITY_COLUMNS) {
    const row = await queryOne(`SELECT MAX(${quoteIdent(col)})::bigint AS m FROM ${quoteIdent(table)}`);
    const max = row?.m;
    if (max == null) continue;
    // Quoted relation/column names for camelCase tables.
    await execute(
      `SELECT setval(pg_get_serial_sequence($1, $2), $3::bigint, true)`,
      [`"${table}"`, col, Number(max)]
    );
    console.log(`  sequence ${table}.${col} -> ${max}`);
  }
}

async function verifyCounts(sqlite) {
  const mismatches = [];
  for (const table of TABLES) {
    let src = 0;
    try { src = sqliteCount(sqlite, table); } catch { continue; }
    const dst = (await queryOne(`SELECT COUNT(*)::int AS n FROM ${quoteIdent(table)}`)).n;
    if (src !== dst) {
      mismatches.push({ table, sqlite: src, postgres: dst });
    }
  }
  return mismatches;
}

async function main() {
  ensureDataDirs();
  if (!fs.existsSync(SQLITE_PATH)) {
    throw new Error(`SQLite file not found: ${SQLITE_PATH}`);
  }
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  console.log(`Source: ${SQLITE_PATH}`);
  console.log(`Target: ${config.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`Wipe:   ${WIPE}\n`);

  const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });

  await initDb();
  await runMigrations();

  if (WIPE) {
    console.log('Wiping PostgreSQL tables...');
    await wipePg();
  }

  // Seed dictionary tables first when wiping, then overwrite/merge from SQLite
  // so IDs match the source library.
  if (WIPE) {
    console.log('Seeding empty schema definitions (will be replaced by SQLite copy)...');
    await seed();
    // Clear seeded dict tables so SQLite IDs win exactly.
    await execute(`TRUNCATE "itemTypeCreatorTypes", "itemTypeFields", "baseFieldMappings",
      "itemTypes", "fields", "creatorTypes" RESTART IDENTITY CASCADE`);
  }

  console.log('Copying tables...');
  for (const table of TABLES) {
    await copyTable(sqlite, table);
  }

  console.log('\nSyncing IDENTITY sequences...');
  await syncSequences();

  console.log('\nVerifying row counts...');
  const mismatches = await verifyCounts(sqlite);
  if (mismatches.length) {
    console.error('Count mismatches:');
    for (const m of mismatches) {
      console.error(`  ${m.table}: sqlite=${m.sqlite} postgres=${m.postgres}`);
    }
    process.exitCode = 1;
  } else {
    console.log('All table counts match.');
  }

  // Spot-check: sample a few item keys
  const sample = sqliteAll(sqlite, 'SELECT key FROM items WHERE parentItemID IS NULL LIMIT 5');
  for (const s of sample) {
    const row = await queryOne('SELECT key FROM items WHERE key=$1', [s.key]);
    if (!row) {
      console.error(`Missing key after import: ${s.key}`);
      process.exitCode = 1;
    }
  }

  sqlite.close();
  await closeDb();
  console.log('\nDone.');
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
  try { await closeDb(); } catch { /* ignore */ }
});
