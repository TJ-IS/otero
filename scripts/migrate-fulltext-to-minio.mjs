/**
 * Migrate MinerU full-text extraction output (full.md, content_list.json,
 * images/, and other assets) from local filesystem storage to MinIO.
 *
 * Usage:
 *   node scripts/migrate-fulltext-to-minio.mjs [--dry-run] [--limit N] [--concurrency N] [--delete-local]
 *
 * Options:
 *   --dry-run        Print what would be done without uploading or touching the DB.
 *   --limit N        Only process the first N items (useful for validation).
 *   --concurrency N  Parallel item workers (default: 2 — each item uploads many
 *                     small files sequentially, so keep this modest).
 *   --delete-local   After a verified upload, delete the local fulltext directory.
 *                     Without this flag, local files are left in place as a rollback copy.
 *
 * For each item with itemFullText.state='done', the script:
 *   1. Locates the local extraction directory: data/storage/<key[0:2]>/<key>/fulltext/
 *   2. Uploads every file under it to MinIO under the object prefix "<key>/fulltext/..."
 *   3. Updates markdownPath/assetDir in the DB to the new MinIO-style prefix
 *      (mirrors the format fulltextService.js writes for newly-parsed items).
 *   4. Optionally deletes the local directory (only with --delete-local).
 *
 * Idempotent: rows whose assetDir is already in MinIO-prefix form ("<key>/fulltext",
 * no key-shard subdirectory) are skipped.
 *
 * This migrates ASSETS only — it does not change STORAGE_TYPE. The app only reads
 * full-text assets from MinIO when STORAGE_TYPE=minio (see fulltextService.js's
 * useMinio() checks), so set that in .env once you've validated the migration.
 *
 * Rollback:
 *   Local files are untouched unless --delete-local was passed, so restoring
 *   STORAGE_TYPE=filesystem (or removing the var) reverts reads immediately.
 *   Restore DB from data/otero_backup_<timestamp>.db if the DB update needs undoing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DELETE_LOCAL = args.includes('--delete-local');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? Number(args[i + 1]) || Infinity : Infinity;
})();
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return i >= 0 ? Math.max(1, Number(args[i + 1]) || 2) : 2;
})();

const { config } = await import('../src/config.js');
const { uploadDir } = await import('../src/services/storageService.js');
const { ensureBucket, objectExists } = await import('../src/services/minioClient.js');
const { getDb } = await import('../src/db/connection.js');
const { runMigrations } = await import('../src/db/migrate.js');
runMigrations();

const db = getDb();
const rows = db.prepare(`
  SELECT f.itemID AS itemID, i.key AS itemKey, f.markdownPath, f.assetDir
  FROM itemFullText f
  JOIN items i ON i.itemID = f.itemID
  WHERE f.state = 'done' AND f.assetDir IS NOT NULL AND i.deleted = 0
  ORDER BY f.itemID
`).all();

function fulltextDirFor(key) {
  return path.join(config.storageDir, key.slice(0, 2), key, 'fulltext');
}
// Same two-letter shard as PDF storage: <key[0:2]>/<key>/fulltext
function fulltextPrefixFor(key) {
  return `${key.slice(0, 2)}/${key}/fulltext`;
}
async function alreadyMigrated(row) {
  if (row.assetDir !== fulltextPrefixFor(row.itemKey)) return false;
  // Filesystem and MinIO assetDir are now the same string (A8/key/fulltext),
  // so verify the object actually exists in MinIO rather than trusting the path.
  if (!row.markdownPath) return false;
  return objectExists(row.markdownPath);
}

const total = Math.min(rows.length, LIMIT);
console.log(`Found ${rows.length} done full-text row(s).${LIMIT < rows.length ? ` Processing first ${total}.` : ''}`);
if (DRY_RUN) console.log('DRY RUN — no uploads, no DB writes, no deletions.\n');

let done = 0, skippedMigrated = 0, skippedMissing = 0, failed = 0;
const errors = [];
const startTime = Date.now();

function progress() {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  process.stdout.write(`\r  ${done + skippedMigrated + skippedMissing + failed}/${total}  ok:${done}  skip-done:${skippedMigrated}  skip-missing:${skippedMissing}  fail:${failed}  ${elapsed}s`);
}

async function processOne(row) {
  if (await alreadyMigrated(row)) { skippedMigrated++; return; }

  const localDir = fulltextDirFor(row.itemKey);
  if (!fs.existsSync(localDir)) {
    errors.push(`MISSING DIR: ${row.itemKey} -> ${localDir}`);
    skippedMissing++;
    return;
  }

  const prefix = fulltextPrefixFor(row.itemKey);

  // Compute the markdown path relative to the fulltext dir. The stored
  // markdownPath may use the old unsharded format (<key>/fulltext/file.md)
  // or the new sharded format (<key[0:2]>/<key>/fulltext/file.md) — either
  // way, we only need the portion after "/fulltext/".
  let relMd = null;
  if (row.markdownPath) {
    const marker = '/fulltext/';
    const idx = row.markdownPath.indexOf(marker);
    relMd = idx >= 0 ? row.markdownPath.slice(idx + marker.length) : null;
  }
  if (!relMd) relMd = fs.existsSync(path.join(localDir, 'full.md')) ? 'full.md' : null;

  if (DRY_RUN) { done++; return; }

  // Skip MinerU's bundled copy of the source PDF — duplicates the PDF we
  // already store separately as the item's attachment.
  for (const f of fs.readdirSync(localDir, { recursive: true })) {
    if (typeof f === 'string' && f.endsWith('_origin.pdf')) {
      try { fs.unlinkSync(path.join(localDir, f)); } catch { /* ignore */ }
    }
  }

  await uploadDir(localDir, prefix);

  // Spot-check the markdown file made it across.
  if (relMd) {
    const exists = await objectExists(`${prefix}/${relMd}`);
    if (!exists) throw new Error(`post-upload check failed: ${prefix}/${relMd} not found in MinIO`);
  }

  db.prepare('UPDATE itemFullText SET markdownPath=?, assetDir=? WHERE itemID=?')
    .run(relMd ? `${prefix}/${relMd}` : null, prefix, row.itemID);

  if (DELETE_LOCAL) {
    fs.rmSync(localDir, { recursive: true, force: true });
  }

  done++;
}

if (!DRY_RUN) await ensureBucket();

const queue = rows.slice(0, total);
let qi = 0;
async function worker() {
  while (qi < queue.length) {
    const row = queue[qi++];
    try {
      await processOne(row);
    } catch (err) {
      errors.push(`ERROR: ${row.itemKey} - ${err.message}`);
      failed++;
    }
    progress();
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total || 1) }, worker));

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('\n');
console.log(`Done in ${elapsed}s: ${done} migrated, ${skippedMigrated} already migrated, ${skippedMissing} missing locally, ${failed} failed`);

if (errors.length > 0) {
  console.log('\nErrors:');
  for (const e of errors) console.log(' ', e);
}

if (!DRY_RUN && failed === 0 && done > 0) {
  console.log('\nNext steps:');
  console.log('  1. Verify the app renders full text correctly with STORAGE_TYPE=minio.');
  console.log('  2. Re-run with --delete-local once confident, to free local disk space.');
}
