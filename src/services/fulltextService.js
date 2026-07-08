import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { Item } from '../models/Item.js';
import { Attachment } from '../models/Attachment.js';
import { resolveStoredPath } from './storageService.js';
import {
  getFullTextRowByKey, getFullTextRow, upsertFullText,
  listPendingFullText, listSubmittingFullText, listAllFullText, deleteFullTextRow,
} from '../repositories/fulltextRepo.js';
import {
  submitLocalPdf, getBatchResult, downloadAndExtract, rewriteAssetPaths,
} from './mineruService.js';

/**
 * Storage layout for extracted full text:
 *   data/storage/<key[0:2]>/<key>/fulltext/   (extracted zip contents)
 *   data/storage/<key[0:2]>/<key>/fulltext/.../full.md
 */
function fulltextDirFor(key) {
  return path.join(config.storageDir, key.slice(0, 2), key, 'fulltext');
}

function relToStorage(absPath) {
  return path.relative(config.storageDir, absPath);
}

/** Find the stored PDF path for an item (its imported-file PDF attachment). */
function findPdfPath(item) {
  const atts = Attachment.listByParent(item.id);
  const pdf = atts.find(a => (a.contentType || '').includes('pdf'));
  if (!pdf || !pdf.path) return null;
  const abs = resolveStoredPath(pdf.path);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * Trigger parsing for an item. Idempotent: if state is done and !force, returns
 * the existing result; if pending/running, returns current progress without
 * resubmitting.
 */
export async function parseItem(key, { force = false } = {}) {
  const item = Item.loadByKey(key);
  if (!item) throw new Error('item not found');

  const existing = getFullTextRow(item.id);
  if (existing && !force) {
    if (['submitting', 'pending', 'running', 'converting'].includes(existing.state)) {
      return { ...existing, itemKey: key, alreadyRunning: true };
    }
    if (existing.state === 'done') {
      return { ...existing, itemKey: key, alreadyDone: true };
    }
  }

  const pdfPath = findPdfPath(item);
  if (!pdfPath) throw new Error('no PDF attachment available to parse');

  const fileName = path.basename(pdfPath) || `${key}.pdf`;
  const { batchId } = await submitLocalPdf({
    filePath: pdfPath,
    fileName,
    modelVersion: config.mineru.modelVersion,
  });

  // Clean any prior extracted assets so a re-parse starts fresh.
  cleanupAssets(key);

  const row = upsertFullText(item.id, {
    state: 'pending',
    mineruBatchId: batchId,
    modelVersion: config.mineru.modelVersion,
    extractedPages: null,
    totalPages: null,
    markdownPath: null,
    assetDir: null,
    errCode: null,
    errMsg: null,
    submittedAt: nowStr(),
    completedAt: null,
  });
  return { ...row, itemKey: key, justSubmitted: true };
}

// ---------------------------------------------------------------------------
// Async submission queue
//
// The batch endpoint enqueues hundreds of items here instead of submitting
// them synchronously (which would take minutes and time out the HTTP
// request). Each enqueued item gets a DB row in state='submitting' right
// away so it shows up in the task log immediately. A bounded-concurrency
// drain loop calls MinerU's upload+submit for each, then flips the row to
// 'pending' (success) or 'failed' (error) for the polling worker to pick up.
// ---------------------------------------------------------------------------
const submitQueue = [];
let submitQueueRunning = false;
const SUBMIT_CONCURRENCY = 2;

/**
 * Enqueue a batch of items for background submission to MinerU.
 * Creates a 'submitting' row for each valid item immediately and returns
 * a summary right away — does NOT block on network I/O.
 */
export function enqueueBatchParse(keys) {
  let queued = 0;
  let skippedDone = 0;
  let skippedRunning = 0;
  let noPdf = 0;
  let notFound = 0;

  for (const key of keys) {
    const item = Item.loadByKey(key);
    if (!item) { notFound++; continue; }

    const existing = getFullTextRow(item.id);
    if (existing) {
      if (existing.state === 'done') { skippedDone++; continue; }
      if (['submitting', 'pending', 'running', 'converting'].includes(existing.state)) {
        skippedRunning++; continue;
      }
    }

    const pdfPath = findPdfPath(item);
    if (!pdfPath) { noPdf++; continue; }

    // Record immediately so the item is visible in the task log.
    cleanupAssets(key);
    upsertFullText(item.id, {
      state: 'submitting',
      mineruBatchId: null,
      modelVersion: config.mineru.modelVersion,
      extractedPages: null,
      totalPages: null,
      markdownPath: null,
      assetDir: null,
      errCode: null,
      errMsg: null,
      submittedAt: nowStr(),
      completedAt: null,
    });
    submitQueue.push({ itemId: item.id, key, pdfPath });
    queued++;
  }

  // Kick the drain loop if not already running.
  if (!submitQueueRunning && submitQueue.length > 0) {
    drainSubmitQueue();
  }

  return { queued, skippedDone, skippedRunning, noPdf, notFound, total: keys.length };
}

async function drainSubmitQueue() {
  if (submitQueueRunning) return;
  submitQueueRunning = true;
  try {
    while (submitQueue.length > 0) {
      // Take up to SUBMIT_CONCURRENCY items and submit in parallel.
      const batch = submitQueue.splice(0, SUBMIT_CONCURRENCY);
      await Promise.all(batch.map(({ itemId, key, pdfPath }) => submitOne(itemId, key, pdfPath)));
    }
  } finally {
    submitQueueRunning = false;
  }
}

async function submitOne(itemId, key, pdfPath) {
  try {
    const fileName = path.basename(pdfPath) || `${key}.pdf`;
    const { batchId } = await submitLocalPdf({
      filePath: pdfPath,
      fileName,
      modelVersion: config.mineru.modelVersion,
    });
    upsertFullText(itemId, {
      state: 'pending',
      mineruBatchId: batchId,
      errMsg: null,
      errCode: null,
    });
  } catch (err) {
    upsertFullText(itemId, {
      state: 'failed',
      errMsg: err.message,
      errCode: null,
    });
    console.error(`[fulltext] submit failed for ${key}: ${err.message}`);
  }
}

/**
 * On server startup, re-enqueue any 'submitting' rows left over from a
 * previous run that was interrupted. Their MinerU submission never
 * completed, so we retry them.
 */
export function recoverSubmittingOnStartup() {
  const orphans = listSubmittingFullText();
  if (orphans.length === 0) return;
  console.log(`[fulltext] recovering ${orphans.length} interrupted submission(s)`);
  for (const row of orphans) {
    const item = Item.loadById(row.itemID);
    if (!item) continue;
    const pdfPath = findPdfPath(item);
    if (!pdfPath) {
      upsertFullText(row.itemID, { state: 'failed', errMsg: 'no PDF attachment' });
      continue;
    }
    submitQueue.push({ itemId: row.itemID, key: row.itemKey, pdfPath });
  }
  if (!submitQueueRunning && submitQueue.length > 0) drainSubmitQueue();
}

/**
 * One polling tick: walk all pending rows, query MinerU, update state, and
 * finalize (download + extract + rewrite) any that are done. Concurrency is
 * capped at config.mineru.maxConcurrent to respect rate limits.
 */
export async function pollOnce() {
  const pending = listPendingFullText();
  if (pending.length === 0) return { checked: 0, finalized: 0, failed: 0 };

  const limit = Math.max(1, config.mineru.maxConcurrent);
  let finalized = 0;
  let failed = 0;
  let checked = 0;

  // Simple concurrency limiter.
  const queue = pending.slice();
  async function worker() {
    while (queue.length) {
      const row = queue.shift();
      checked++;
      try {
        const data = await getBatchResult(row.mineruBatchId);
        const results = data.extract_result || [];
        const first = results[0];
        if (!first) {
          upsertFullText(row.itemID, { state: 'failed', errMsg: 'no result returned' });
          failed++;
          continue;
        }
        if (first.state === 'done' && first.full_zip_url) {
          await finalizeDone(row, first.full_zip_url);
          finalized++;
        } else if (first.state === 'failed') {
          upsertFullText(row.itemID, {
            state: 'failed',
            errMsg: first.err_msg || 'parse failed',
          });
          failed++;
        } else {
          // pending / running / converting / waiting-file
          const prog = first.extract_progress || {};
          upsertFullText(row.itemID, {
            state: mapState(first.state),
            extractedPages: prog.extracted_pages ?? null,
            totalPages: prog.total_pages ?? null,
          });
        }
      } catch (err) {
        // Don't mark failed on transient network errors; leave state as-is.
        console.error(`[fulltext] poll error for ${row.itemKey}:`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker));
  return { checked, finalized, failed };
}

function mapState(s) {
  // MinerU batch states: waiting-file, pending, running, converting, done, failed
  if (s === 'waiting-file') return 'pending';
  if (s === 'uploading') return 'pending';
  return s || 'pending';
}

async function finalizeDone(row, zipUrl) {
  const destDir = fulltextDirFor(row.itemKey);
  const { fullMdPath } = await downloadAndExtract(zipUrl, destDir);
  rewriteAssetPaths(fullMdPath, row.itemKey);
  upsertFullText(row.itemID, {
    state: 'done',
    markdownPath: relToStorage(fullMdPath),
    assetDir: relToStorage(destDir),
    extractedPages: null,
    totalPages: null,
    errCode: null,
    errMsg: null,
    completedAt: nowStr(),
  });
}

/** Public read API: status + inline markdown content (when done). */
export function getFullText(key) {
  const row = getFullTextRowByKey(key);
  if (!row) return { state: 'idle', itemKey: key };
  const result = { ...row, itemKey: key };
  if (row.state === 'done' && row.markdownPath) {
    const abs = resolveStoredPath(row.markdownPath);
    try {
      result.markdown = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      result.markdown = null;
      result.errMsg = `markdown file missing: ${err.message}`;
    }
    result.imagesBaseUrl = `/api/attachments/${key}/fulltext`;
  }
  return result;
}

/** Remove extracted assets + DB row so a fresh parse can be triggered. */
export function deleteFullText(key) {
  const row = getFullTextRowByKey(key);
  if (!row) return { deleted: false };
  cleanupAssets(key);
  deleteFullTextRow(row.itemID);
  return { deleted: true };
}

function cleanupAssets(key) {
  const dir = fulltextDirFor(key);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** List all full-text rows (for admin/queue view). */
export function listAll() {
  return listAllFullText();
}

/**
 * Resolve a sub-path under an item's fulltext dir, with traversal guard.
 * Returns the absolute path or null if it escapes the root.
 */
export function resolveFullTextAsset(key, subPath) {
  const root = fulltextDirFor(key);
  const abs = path.resolve(root, subPath || '');
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return null;
  }
  if (!fs.existsSync(abs)) return null;
  return abs;
}
