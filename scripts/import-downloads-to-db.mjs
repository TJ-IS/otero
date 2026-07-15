#!/usr/bin/env node
/**
 * Import PDFs into PostgreSQL. Filename is a DOI with '/' replaced by '_';
 * metadata comes from Crossref; PDFs go to configured storage (S3/R2 or filesystem).
 *
 * Usage:
 *   node scripts/import-downloads-to-db.mjs
 *   node scripts/import-downloads-to-db.mjs --dir /path/to/pdfs
 *   node scripts/import-downloads-to-db.mjs --dry-run --concurrency 3
 *
 * Default dirs (when --dir omitted): data/downloads/{unpaywall,scihub}
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDataDirs, config } from '../src/config.js';
import { initDb, closeDb, query, execute } from '../src/db/connection.js';
import { storeFile } from '../src/services/storageService.js';
import { fetchByDoi } from '../src/services/recognizers/crossref.js';
import { mapRecognized } from '../src/services/metadataMapper.js';
import { Item } from '../src/models/Item.js';
import { Attachment } from '../src/models/Attachment.js';
import { generateKey } from '../src/utils/key.js';

config.recognizers.timeoutMs = 20000;
config.recognizers.userAgent = 'Otero/0.1 (mailto:otero@example.com; literature-import)';

// Keep idle socket errors from killing the whole batch import.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message || err);
});

const DEFAULT_ROOT = path.resolve(config.projectRoot, 'data/downloads');
const DEFAULT_DIRS = [
  path.join(DEFAULT_ROOT, 'unpaywall'),
  path.join(DEFAULT_ROOT, 'scihub'),
];

/** Shared across concurrent workers; filled in main() before import starts. */
let existingDois = new Map();

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const concurrencyIdx = args.indexOf('--concurrency');
const CONCURRENCY = concurrencyIdx >= 0
  ? Math.max(1, Number(args[concurrencyIdx + 1]) || 1)
  : 2;
const dirIdx = args.indexOf('--dir');
const DIR_ARG = dirIdx >= 0 ? path.resolve(args[dirIdx + 1] || '') : null;

function collectPdfDirs() {
  if (DIR_ARG) {
    if (!fs.existsSync(DIR_ARG) || !fs.statSync(DIR_ARG).isDirectory()) {
      throw new Error(`--dir is not a directory: ${DIR_ARG}`);
    }
    return [DIR_ARG];
  }
  return DEFAULT_DIRS;
}

function logPathFor(dirs) {
  if (DIR_ARG) {
    const inDir = path.join(DIR_ARG, 'import-to-db-log.jsonl');
    try {
      fs.accessSync(DIR_ARG, fs.constants.W_OK);
      return inDir;
    } catch {
      // Source dirs may be root-owned (e.g. copied as root); fall back.
      return path.join(DEFAULT_ROOT, `import-to-db-${path.basename(DIR_ARG)}.jsonl`);
    }
  }
  return path.join(DEFAULT_ROOT, 'import-to-db-log.jsonl');
}

/** Filename DOI: first '_' → '/', except MISQ-style 10.25300_* where all '_' → '/'. */
function doiFromFilename(name) {
  const stem = name.replace(/\.pdf$/i, '');
  if (stem.startsWith('10.25300_')) return stem.replaceAll('_', '/');
  return stem.replace('_', '/');
}

function normDoi(doi) {
  return String(doi || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^doi:\s*/i, '')
    .trim();
}

async function existingDoiKeys() {
  const rows = await query(`
    SELECT i.key, lower(v.value) AS doi
    FROM items i
    JOIN "itemData" d ON d."itemID" = i."itemID"
    JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" = 'DOI'
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE i."parentItemID" IS NULL AND i.deleted = 0
  `);
  const map = new Map();
  for (const r of rows) map.set(normDoi(r.doi), r.key);
  return map;
}

async function importOne(filePath, sourceDir, doi) {
  const recognized = await fetchByDoi(doi);
  if (!recognized) throw new Error(`CrossRef miss: ${doi}`);
  const mapped = mapRecognized(recognized);

  // Ensure DOI field is set even if Crossref omits it.
  mapped.fields.DOI = mapped.fields.DOI || doi;
  const canonical = normDoi(mapped.fields.DOI);
  const fileDoi = normDoi(doi);

  // Filename DOI often differs from Crossref's canonical DOI (e.g. Elsevier
  // j.dss.* vs s0167-9236*). Skip if either form is already in the library.
  const hit = existingDois.get(canonical) || existingDois.get(fileDoi);
  if (hit) {
    return {
      ok: true,
      skipped: true,
      file: path.basename(filePath),
      sourceDir,
      doi: mapped.fields.DOI,
      key: hit,
      title: mapped.fields.title || '',
      itemType: mapped.itemType,
      creators: mapped.creators?.length || 0,
    };
  }

  const fileKey = generateKey();
  const stored = await storeFile(filePath, fileKey, { ext: 'pdf' });

  const attachment = new Attachment({
    linkMode: 0,
    contentType: 'application/pdf',
    path: stored.path,
    md5: stored.md5,
    mtime: stored.mtime,
  });
  await attachment.save();

  const parent = new Item();
  await parent.setItemType(mapped.itemType || 'journalArticle');
  for (const [name, value] of Object.entries(mapped.fields)) {
    if (value === null || value === undefined || value === '') continue;
    try { parent.setField(name, value); }
    catch { /* skip unknown / disallowed fields */ }
  }
  for (const c of mapped.creators) parent.addCreator(c);
  await parent.save();

  await execute('UPDATE items SET "parentItemID"=$1 WHERE "itemID"=$2', [parent.id, attachment.id]);
  await execute('UPDATE "itemAttachments" SET "parentItemID"=$1 WHERE "itemID"=$2', [parent.id, attachment.id]);

  existingDois.set(canonical, parent.key);
  existingDois.set(fileDoi, parent.key);

  return {
    ok: true,
    file: path.basename(filePath),
    sourceDir,
    doi: mapped.fields.DOI || doi,
    key: parent.key,
    title: mapped.fields.title || '',
    itemType: mapped.itemType,
    creators: mapped.creators.length,
  };
}

async function importOneWithRetry(filePath, sourceDir, doi, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await importOne(filePath, sourceDir, doi);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const transient = /timeout|ECONN|EPIPE|TLS|socket|hang up|terminated|deadlock|40P01|53300|57P01|ECONNRESET/i.test(msg);
      if (!transient || i === attempts) throw err;
      const waitMs = 2000 * i;
      console.error(`  retry ${i}/${attempts} after ${waitMs}ms: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, waitMs));
      try { await closeDb(); } catch { /* ignore */ }
      try { await initDb(); } catch (e) { console.error(`  re-initDb failed: ${e.message}`); }
    }
  }
  throw lastErr;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function main() {
  ensureDataDirs();
  await initDb();

  const dirs = collectPdfDirs();
  const LOG_PATH = logPathFor(dirs);

  console.log(`DB: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Storage: ${config.storage.type} (${config.storage.s3.endpoint}/${config.storage.s3.bucket})`);
  console.log(`Dirs: ${dirs.join(', ')}`);
  console.log(`Concurrency: ${CONCURRENCY}${DRY_RUN ? ' (dry-run)' : ''}`);

  const files = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const sourceDir = path.basename(dir);
    for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.pdf')).sort()) {
      files.push({
        file: f,
        path: path.join(dir, f),
        sourceDir,
        doi: doiFromFilename(f),
      });
    }
  }

  const existing = await existingDoiKeys();
  existingDois = existing;
  const todo = files.filter((f) => !existing.has(normDoi(f.doi)));
  const skipped = files.length - todo.length;

  console.log(`PDFs: ${files.length}  already in DB: ${skipped}  to import: ${todo.length}`);
  if (DRY_RUN || todo.length === 0) {
    if (DRY_RUN) {
      for (const f of todo.slice(0, 20)) console.log(`  would import ${f.sourceDir}/${f.file} → ${f.doi}`);
      if (todo.length > 20) console.log(`  ... and ${todo.length - 20} more`);
    }
    await closeDb();
    return;
  }

  // Fresh log for this run (append a separator).
  fs.appendFileSync(LOG_PATH, `\n# run ${new Date().toISOString()} count=${todo.length}\n`);

  let ok = 0;
  let fail = 0;
  let skippedAlias = 0;
  const start = Date.now();

  await mapPool(todo, CONCURRENCY, async (item, idx) => {
    const label = `[${idx + 1}/${todo.length}] ${item.sourceDir}/${item.file}`;
    try {
      const r = await importOneWithRetry(item.path, item.sourceDir, item.doi);
      fs.appendFileSync(LOG_PATH, JSON.stringify(r) + '\n');
      if (r.skipped) {
        skippedAlias++;
        console.log(`SKIP ${label} → ${r.key}  (canonical DOI already in DB)`);
      } else {
        ok++;
        console.log(`OK  ${label} → ${r.key}  ${r.title.slice(0, 70)}`);
      }
      return r;
    } catch (err) {
      fail++;
      const r = { ok: false, file: item.file, sourceDir: item.sourceDir, doi: item.doi, error: err.message };
      fs.appendFileSync(LOG_PATH, JSON.stringify(r) + '\n');
      console.error(`ERR ${label}: ${err.message}`);
      return r;
    }
  });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n=== Done ===');
  console.log(`  ok=${ok} fail=${fail} skippedFilename=${skipped} skippedCanonical=${skippedAlias} elapsed=${elapsed}s`);
  console.log(`  log=${LOG_PATH}`);

  // Verify DOIs now present.
  const after = await existingDoiKeys();
  let present = 0;
  const stillMissing = [];
  for (const f of files) {
    if (after.has(normDoi(f.doi))) present++;
    else stillMissing.push(f);
  }
  console.log(`  verify: ${present}/${files.length} DOIs present in DB`);
  if (stillMissing.length) {
    console.log(`  still missing (${stillMissing.length}):`);
    for (const f of stillMissing.slice(0, 50)) console.log(`    ${f.sourceDir}/${f.file} (${f.doi})`);
    if (stillMissing.length > 50) console.log(`    ... and ${stillMissing.length - 50} more`);
  }

  await closeDb();
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
