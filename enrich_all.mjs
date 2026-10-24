#!/usr/bin/env node
/**
 * Batch enrich metadata for items that already have a DOI, by querying the
 * CrossRef official API and overwriting fields/creators with the returned data.
 *
 * Usage:
 *   node enrich_all.mjs                         # full run, 10 concurrency
 *   node enrich_all.mjs --limit=10 --dry-run    # preview 10 items, no DB writes
 *   node enrich_all.mjs --concurrency=5         # slower, safer
 *
 * Flags:
 *   --limit=N          process at most N items (0 = all, default 0)
 *   --dry-run          query CrossRef only, do not write to the database
 *   --concurrency=N    parallel CrossRef calls (default 10)
 *   --log=PATH         CSV log path (default ./enrich_log.csv)
 *   --delay=Ms         delay between batches in ms (default 200)
 */

import fs from 'node:fs';
import { ensureDataDirs } from './src/config.js';
import { runMigrations } from './src/db/migrate.js';
import { seed } from './src/db/seed.js';
import { initDb, closeDb, query } from './src/db/connection.js';
import { fieldIdByName } from './src/repositories/itemRepo.js';
import { fetchByDoi } from './src/services/recognizers/crossref.js';
import { mapRecognized } from './src/services/metadataMapper.js';
import { Item } from './src/models/Item.js';

// ---- CLI args ---------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const LIMIT = Math.max(0, Number(args.limit ?? 0));
const DRY_RUN = Boolean(args['dry-run']);
const CONCURRENCY = Math.max(1, Math.min(20, Number(args.concurrency ?? 10)));
const LOG_PATH = args.log ?? './enrich_log.csv';
const BATCH_DELAY = Math.max(0, Number(args.delay ?? 200));

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

// ---- CSV helper -------------------------------------------------------------
function csvCell(s) {
  const v = String(s ?? '');
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function csvRow(cells) {
  return cells.map(csvCell).join(',') + '\n';
}

const CSV_HEADER = [
  'key',
  'doi',
  'crossrefTitle',
  'crossrefJournal',
  'itemType',
  'fieldsUpdated',
  'creatorsUpdated',
  'creatorCount',
  'error',
];

// ---- Query all top-level non-deleted items with a DOI ----------------------
async function listItemsWithDoi() {
  const doiFid = await fieldIdByName('DOI');
  if (!doiFid) return [];

  const rows = await query(
    `
    SELECT i.key, i."itemID", v.value AS doi
    FROM items i
    JOIN "itemData" d ON d."itemID" = i."itemID" AND d."fieldID" = $1
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE i."parentItemID" IS NULL AND i.deleted = 0
    ORDER BY i."dateAdded" DESC
  `,
    [doiFid],
  );

  return rows.map((r) => ({ key: r.key, itemID: r.itemID, doi: r.doi }));
}

// ---- Main -------------------------------------------------------------------
let processed = 0,
  okCount = 0,
  notFoundCount = 0,
  failCount = 0;
const startTime = Date.now();

function progressLine(total) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  return `\r  ${processed}/${total} (ok:${okCount} notFound:${notFoundCount} fail:${failCount}) ${elapsed}s`;
}

async function processOne(item, total) {
  let crossrefTitle = '',
    crossrefJournal = '',
    itemType = '';
  let fieldsUpdated = [],
    creatorsUpdated = false,
    creatorCount = 0;
  let error = '';

  try {
    const recognized = await fetchByDoi(item.doi);
    if (!recognized) {
      notFoundCount++;
      error = 'CrossRef not found';
      fs.appendFileSync(LOG_PATH, csvRow([item.key, item.doi, '', '', '', '', 'no', 0, error]));
      return;
    }

    const mapped = mapRecognized(recognized);
    crossrefTitle = mapped.fields.title || '';
    crossrefJournal = mapped.fields.publicationTitle || '';
    itemType = mapped.itemType;
    creatorCount = mapped.creators?.length || 0;

    if (DRY_RUN) {
      fieldsUpdated = Object.keys(mapped.fields);
      creatorsUpdated = mapped.creators?.length > 0;
      okCount++;
    } else {
      const it = await Item.loadByKey(item.key);
      if (!it) throw new Error('Item not found in DB');

      // Update itemType if different and valid
      if (mapped.itemType && mapped.itemType !== it.itemType) {
        try {
          await it.setItemType(mapped.itemType);
        } catch {
          /* unknown type, keep original */
        }
      }

      // Overwrite all fields from CrossRef
      for (const [name, value] of Object.entries(mapped.fields)) {
        if (value === null || value === undefined || value === '') continue;
        try {
          it.setField(name, value);
          fieldsUpdated.push(name);
        } catch {
          /* field not allowed for type, skip */
        }
      }

      // Replace creators
      if (mapped.creators?.length) {
        it.setCreators(mapped.creators);
        creatorsUpdated = true;
      }

      await it.save();
      okCount++;
    }
  } catch (err) {
    error = err.message;
    failCount++;
  } finally {
    processed++;
  }

  fs.appendFileSync(
    LOG_PATH,
    csvRow([
      item.key,
      item.doi,
      crossrefTitle,
      crossrefJournal,
      itemType,
      fieldsUpdated.join(' '),
      creatorsUpdated ? 'yes' : 'no',
      creatorCount,
      error,
    ]),
  );
  process.stdout.write(progressLine(total));
}

async function main() {
  ensureDataDirs();
  await initDb();
  await runMigrations();
  await seed();

  const all = await listItemsWithDoi();
  const targets = LIMIT > 0 ? all.slice(0, LIMIT) : all;

  console.log(`有 DOI 的顶层条目：${all.length} 条`);
  console.log(`本次处理：${targets.length} 条 (concurrency=${CONCURRENCY}, dryRun=${DRY_RUN})`);
  console.log(`CSV 日志：${LOG_PATH}\n`);

  fs.writeFileSync(LOG_PATH, csvRow(CSV_HEADER));

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((t) => processOne(t, targets.length)));
    if (BATCH_DELAY > 0 && i + CONCURRENCY < targets.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n=== Done ===');
  console.log(`  Total:     ${processed}`);
  console.log(`  OK:        ${okCount}`);
  console.log(`  NotFound:  ${notFoundCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(
    `  Time:      ${elapsed}s  (avg ${(processed ? elapsed / processed : 0).toFixed(2)}s/item)`,
  );
  console.log(`  Log:       ${LOG_PATH}`);

  await closeDb();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
});
