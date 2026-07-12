/**
 * Migrate PDF attachments from local filesystem storage to MinIO.
 *
 * Usage:
 *   node scripts/migrate-to-minio.mjs [--dry-run] [--limit N] [--concurrency N]
 *
 * Options:
 *   --dry-run        Print what would be done without uploading anything.
 *   --limit N        Only process the first N items (useful for validation).
 *   --concurrency N  Parallel upload workers (default: 4).
 *   --no-verify      Skip the post-upload existence check.
 *
 * The script copies PDFs to MinIO using the same object-name format as the
 * updated storageService.js: "<key[0:2]>/<key>.pdf". The original file on disk
 * is NOT deleted — it acts as the rollback copy. Once you've verified everything
 * works, you can remove the files with a follow-up script or manually.
 *
 * Set STORAGE_TYPE=s3 in your .env (or environment) BEFORE running so that
 * the server also reads from MinIO.
 *
 * Rollback:
 *   git checkout pre-minio-migration   (restores code to pre-MinIO state)
 *   Set STORAGE_TYPE=filesystem in .env (or remove the var entirely)
 *   Restore DB from data/otero_backup_<timestamp>.db if needed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_VERIFY = args.includes('--no-verify');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Number(args[i + 1]) || Infinity : Infinity;
})();
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return i >= 0 ? Math.max(1, Number(args[i + 1]) || 4) : 4;
})();

// Bootstrap config (loads .env)
const { config } = await import('../src/config.js');

if (config.storage.type !== 's3' && !DRY_RUN) {
  console.error('ERROR: STORAGE_TYPE is not "s3". Set STORAGE_TYPE=s3 in .env before running.');
  console.error('       Use --dry-run to preview without writing to object storage.');
  process.exit(1);
}

const { uploadFile, ensureBucket, objectExists } = await import('../src/services/s3Client.js');

// ---- Load items with PDF attachments from DB --------------------------------
const { initDb, closeDb, query } = await import('../src/db/connection.js');
const { runMigrations } = await import('../src/db/migrate.js');
await initDb();
await runMigrations();

const rows = await query(`
  SELECT i.key AS "itemKey", a.path AS "storedPath"
  FROM "itemAttachments" a
  JOIN items i ON i."itemID" = a."itemID"
  WHERE a."contentType" = 'application/pdf'
    AND a.path IS NOT NULL
    AND i.deleted = 0
  ORDER BY i."itemID"
`);

const total = Math.min(rows.length, LIMIT);
console.log(`Found ${rows.length} PDF attachments.${LIMIT < rows.length ? ` Processing first ${total}.` : ''}`);
if (DRY_RUN) console.log('DRY RUN — no files will be uploaded.\n');

// ---- Progress counters -------------------------------------------------------
let done = 0, skipped = 0, failed = 0;
const errors = [];
const startTime = Date.now();

function progress() {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r  ${done + skipped + failed}/${total}  ok:${done}  skip:${skipped}  fail:${failed}  ${elapsed}s`);
}

// ---- Worker ------------------------------------------------------------------
async function processOne(row) {
  const { itemKey, storedPath } = row;
  const objectName = storedPath.replace(/\\/g, '/');
  const absPath = path.join(config.storageDir, storedPath);

  if (!fs.existsSync(absPath)) {
    errors.push(`MISSING FILE: ${itemKey} → ${storedPath}`);
    failed++;
    return;
  }

  if (!DRY_RUN) {
    // Skip if already uploaded (idempotent).
    if (!NO_VERIFY) {
      const exists = await objectExists(objectName);
      if (exists) { skipped++; return; }
    }
    await uploadFile(absPath, objectName);
  }

  done++;
}

// ---- Queue runner -------------------------------------------------------------
if (!DRY_RUN) await ensureBucket();

const queue = rows.slice(0, total);
let qi = 0;

async function worker() {
  while (qi < queue.length) {
    const row = queue[qi++];
    try {
      await processOne(row);
    } catch (err) {
      errors.push(`ERROR: ${row.itemKey} — ${err.message}`);
      failed++;
    }
    progress();
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total || 1) }, worker));

// ---- Summary -----------------------------------------------------------------
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('\n');
console.log(`Done in ${elapsed}s: ${done} uploaded, ${skipped} already existed, ${failed} failed`);

if (errors.length > 0) {
  console.log('\nErrors:');
  for (const e of errors) console.log(' ', e);
}

if (!DRY_RUN && failed === 0) {
  console.log('\nAll PDFs are in MinIO. Next steps:');
  console.log('  1. Verify the app works with STORAGE_TYPE=s3');
  console.log('  2. Once confident, you can free disk space by removing the originals:');
  console.log('     find data/storage -name "*.pdf" -delete');
}

await closeDb();

