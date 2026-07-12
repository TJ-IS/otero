import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config.js';
import { Item } from '../models/Item.js';
import { Attachment } from '../models/Attachment.js';
import {
  resolveStoredPath, storedFileExists, downloadToTemp, useS3,
  uploadDir, deleteStoredPrefix, listStoredPrefix, readStoredFile, getStoredFileStream,
} from './storageService.js';
import {
  getFullTextRowByKey, getFullTextRow, upsertFullText,
  listPendingFullText, listSubmittingFullText, listFailedFullText, listAllFullText, deleteFullTextRow,
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

/** MinIO object-key prefix for an item's extracted full-text assets.
 * Uses the same two-letter shard as PDF storage: <key[0:2]>/<key>/fulltext */
function fulltextPrefixFor(key) {
  return `${key.slice(0, 2)}/${key}/fulltext`;
}

/**
 * Drop MinerU artifacts we never read: source-PDF duplicate, layout debug
 * dump, and per-page model output. Keeps full.md, content_list.json, images/.
 */
async function pruneUnusedMineruFiles(dir) {
  for await (const p of walk(dir)) {
    let st;
    try { st = await fs.promises.stat(p); } catch { continue; }
    if (!st.isFile()) continue;
    const base = path.basename(p);
    if (
      base.endsWith('_origin.pdf')
      || base === 'layout.json'
      || base.endsWith('_model.json')
    ) {
      try { await fs.promises.unlink(p); } catch { /* ignore */ }
    }
  }
}

/**
 * Given a flat list of object names (or file basenames), pick the best
 * content_list.json candidate: prefer an exact "content_list.json" match,
 * shallowest first; fall back to a "*_content_list.json" (non-_v2) match.
 */
export function pickContentListObjectName(names) {
  const depth = n => n.split('/').length;
  const isPrimary = n => n.split('/').pop() === 'content_list.json';
  const isSecondary = n => {
    const b = n.split('/').pop();
    return b.endsWith('_content_list.json') && !b.endsWith('_v2.json');
  };
  const primary = names.filter(isPrimary).sort((a, b) => depth(a) - depth(b));
  if (primary.length) return primary[0];
  const secondary = names.filter(isSecondary).sort((a, b) => depth(a) - depth(b));
  return secondary[0] || null;
}

/**
 * Find the stored PDF relative-path for an item.
 * In filesystem mode also checks the file actually exists on disk.
 * In MinIO mode, just returns the stored path string (existence is checked
 * lazily when we actually need the file).
 */
async function findPdfRelPath(item) {
  const atts = await Attachment.listByParent(item.id);
  const pdf = atts.find(a => (a.contentType || '').includes('pdf'));
  if (!pdf || !pdf.path) return null;
  const exists = await storedFileExists(pdf.path);
  return exists ? pdf.path : null;
}

/**
 * Trigger parsing for an item. Idempotent: if state is done and !force, returns
 * the existing result; if pending/running, returns current progress without
 * resubmitting.
 */
export async function parseItem(key, { force = false } = {}) {
  const item = await Item.loadByKey(key);
  if (!item) throw new Error('item not found');

  const existing = await getFullTextRow(item.id);
  if (existing && !force) {
    if (['submitting', 'pending', 'running', 'converting'].includes(existing.state)) {
      return { ...existing, itemKey: key, alreadyRunning: true };
    }
    if (existing.state === 'done') {
      return { ...existing, itemKey: key, alreadyDone: true };
    }
  }

  const pdfRelPath = await findPdfRelPath(item);
  if (!pdfRelPath) throw new Error('no PDF attachment available to parse');

  // Use <key>.pdf as the MinerU file_name so polling can match results back
  // to items by file_name regardless of submission path (single or batch).
  const fileName = `${key}.pdf`;
  // In MinIO mode, download the PDF to a temp file so submitLocalPdf can stream it.
  const filePath = await downloadToTemp(pdfRelPath);
  const isTemp = filePath !== resolveStoredPath(pdfRelPath);
  let batchId;
  try {
    ({ batchId } = await submitLocalPdf({ filePath, fileName, modelVersion: config.mineru.modelVersion }));
  } finally {
    if (isTemp) try { await fs.promises.unlink(filePath); } catch { /* ignore */ }
  }

  // Clean any prior extracted assets so a re-parse starts fresh.
  await cleanupAssets(key);

  const row = await upsertFullText(item.id, {
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
// Async submission queue (one-by-one)
//
// The batch endpoint enqueues hundreds of items here instead of submitting
// them synchronously. Each enqueued item gets a DB row in state='submitting'
// right away so it shows up in the task log immediately. A bounded-concurrency
// drain loop submits ONE file at a time to MinerU via submitLocalPdf, then
// flips the row to 'pending' (success) or 'failed' (error) for the polling
// worker to pick up. One-by-one submission avoids the 429 / -60019 quota
// storms that the 200-file chunked approach triggered.
// ---------------------------------------------------------------------------
const submitQueue = [];
let submitQueueRunning = false;
const SUBMIT_CONCURRENCY = Math.max(1, Math.min(4, Number(config.mineru.submitConcurrency ?? 2)));
const SUBMIT_INTERVAL_MS = Math.max(0, Number(config.mineru.submitIntervalMs ?? 800));
const SUBMIT_MAX_RETRIES = Math.max(0, Number(config.mineru.submitMaxRetries ?? 5));

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Exponential backoff with full jitter for 429 retries.
 */
function backoffDelay(attempt) {
  const base = Math.max(100, Number(config.mineru.submitRetryBaseMs ?? 2000));
  const cap = Math.max(base, Number(config.mineru.submitRetryMaxMs ?? 60000));
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

const ENQUEUE_CONCURRENCY = 8;

/**
 * Enqueue a batch of items for background submission to MinerU.
 * Creates a 'submitting' row for each valid item immediately and returns
 * a summary right away — does NOT block on network I/O.
 *
 * Per-key lookups (loadByKey, getFullTextRow, findPdfRelPath, cleanupAssets)
 * are DB/storage round trips; a bounded worker pool runs them concurrently
 * instead of one key at a time so a large batch doesn't serialize on latency.
 */
export async function enqueueBatchParse(keys) {
  let queued = 0;
  let skippedDone = 0;
  let skippedRunning = 0;
  let noPdf = 0;
  let notFound = 0;

  const queue = keys.slice();
  async function worker() {
    while (queue.length) {
      const key = queue.shift();
      const item = await Item.loadByKey(key);
      if (!item) { notFound++; continue; }

      const existing = await getFullTextRow(item.id);
      if (existing) {
        if (existing.state === 'done') { skippedDone++; continue; }
        if (['submitting', 'pending', 'running', 'converting'].includes(existing.state)) {
          skippedRunning++; continue;
        }
      }

      const pdfRelPath = await findPdfRelPath(item);
      if (!pdfRelPath) { noPdf++; continue; }

      // Record immediately so the item is visible in the task log.
      await cleanupAssets(key);
      await upsertFullText(item.id, {
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
      submitQueue.push({ itemId: item.id, key, pdfRelPath });
      queued++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(ENQUEUE_CONCURRENCY, keys.length) }, worker));

  // Kick the drain loop if not already running.
  if (!submitQueueRunning && submitQueue.length > 0) {
    drainSubmitQueue();
  }

  return { queued, skippedDone, skippedRunning, noPdf, notFound, total: keys.length };
}

/**
 * Drain the submit queue one item at a time with bounded concurrency.
 * Each item is submitted via submitLocalPdf (single-file MinerU batch).
 */
async function drainSubmitQueue() {
  if (submitQueueRunning) return;
  submitQueueRunning = true;
  try {
    const workers = Array.from({ length: SUBMIT_CONCURRENCY }, () => runSubmitWorker());
    await Promise.all(workers);
  } finally {
    submitQueueRunning = false;
  }
}

async function runSubmitWorker() {
  while (submitQueue.length > 0) {
    const job = submitQueue.shift();
    if (!job) break;
    await submitOne(job);
    // Brief gap between submissions to be gentle on MinerU rate limits.
    if (submitQueue.length > 0 && SUBMIT_INTERVAL_MS > 0) await sleep(SUBMIT_INTERVAL_MS);
  }
}

/**
 * Submit a single item to MinerU with 429 backoff retry.
 * pdfRelPath is the storage-relative path; we download to a temp file if
 * STORAGE_TYPE=s3 before handing off to submitLocalPdf.
 */
async function submitOne({ itemId, key, pdfRelPath }) {
  let attempt = 0;
  while (true) {
    // Obtain a real file path. In MinIO mode this downloads to /tmp first.
    const filePath = await downloadToTemp(pdfRelPath);
    const isTemp = filePath !== resolveStoredPath(pdfRelPath);
    try {
      const { batchId } = await submitLocalPdf({
        filePath,
        fileName: `${key}.pdf`,
        modelVersion: config.mineru.modelVersion,
      });
      await upsertFullText(itemId, {
        state: 'pending',
        mineruBatchId: batchId,
        errMsg: null,
        errCode: null,
      });
      return;
    } catch (err) {
      const status = err.status ?? null;
      const isTransient = status === 429 || status === 503 || status === 502;
      if (isTransient && attempt < SUBMIT_MAX_RETRIES) {
        const delay = backoffDelay(attempt);
        attempt++;
        console.warn(`[fulltext] submit ${key} throttled (HTTP ${status}); retry ${attempt}/${SUBMIT_MAX_RETRIES} after ${delay}ms`);
        await upsertFullText(itemId, { state: 'submitting', errMsg: `rate-limited, retry ${attempt}/${SUBMIT_MAX_RETRIES}` });
        await sleep(delay);
        continue;
      }
      await upsertFullText(itemId, {
        state: 'failed',
        errMsg: err.message,
        errCode: status != null ? String(status) : String(err.mineruCode ?? ''),
      });
      console.error(`[fulltext] submit failed for ${key}: ${err.message}`);
      return;
    } finally {
      if (isTemp) try { await fs.promises.unlink(filePath); } catch { /* ignore */ }
    }
  }
}

/**
 * On server startup, re-enqueue any 'submitting' rows left over from a
 * previous run that was interrupted. Their MinerU submission never
 * completed, so we retry them.
 */
export async function recoverSubmittingOnStartup() {
  const orphans = await listSubmittingFullText();
  if (orphans.length === 0) return;
  console.log(`[fulltext] recovering ${orphans.length} interrupted submission(s)`);
  for (const row of orphans) {
    const item = await Item.loadById(row.itemID);
    if (!item) continue;
    const pdfRelPath = await findPdfRelPath(item);
    if (!pdfRelPath) {
      await upsertFullText(row.itemID, { state: 'failed', errMsg: 'no PDF attachment' });
      continue;
    }
    submitQueue.push({ itemId: row.itemID, key: row.itemKey, pdfRelPath });
  }
  if (!submitQueueRunning && submitQueue.length > 0) drainSubmitQueue();
}

/**
 * Re-enqueue every row currently in 'failed' state.
 */
export async function retryFailed() {
  const failed = await listFailedFullText();
  const keys = failed.map(r => r.itemKey).filter(Boolean);
  if (keys.length === 0) return { queued: 0, skippedDone: 0, skippedRunning: 0, noPdf: 0, notFound: 0, total: 0 };
  return enqueueBatchParse(keys);
}

/**
 * One polling tick: query MinerU for each distinct batchId among pending
 * rows, then match results back to items by file_name (<key>.pdf). Multiple
 * items sharing a batchId (from a 200-file chunk) are resolved with a single
 * query, so request count scales with batch count, not item count.
 * Concurrency is capped at config.mineru.maxConcurrent.
 */
export async function pollOnce() {
  const pending = await listPendingFullText();
  if (pending.length === 0) return { checked: 0, finalized: 0, failed: 0 };

  // Group rows by batchId so each batch is queried only once.
  const byBatch = new Map();
  for (const row of pending) {
    if (!row.mineruBatchId) continue;
    if (!byBatch.has(row.mineruBatchId)) byBatch.set(row.mineruBatchId, []);
    byBatch.get(row.mineruBatchId).push(row);
  }
  if (byBatch.size === 0) return { checked: 0, finalized: 0, failed: 0 };

  const limit = Math.max(1, config.mineru.maxConcurrent);
  let finalized = 0;
  let failed = 0;
  let checked = 0;

  const queue = [...byBatch.entries()]; // [[batchId, rows[]], ...]
  async function worker() {
    while (queue.length) {
      const [batchId, rows] = queue.shift();
      checked++;
      try {
        const data = await getBatchResult(batchId);
        const results = data.extract_result || [];
        // Index results by file_name for O(1) lookup.
        const byName = new Map(results.map(r => [r.file_name, r]));
        for (const row of rows) {
          const expectedName = `${row.itemKey}.pdf`;
          const r = byName.get(expectedName);
          if (!r) continue; // not in results yet; leave state as-is
          if (r.state === 'done' && r.full_zip_url) {
            await finalizeDone(row, r.full_zip_url);
            finalized++;
          } else if (r.state === 'failed') {
            await upsertFullText(row.itemID, {
              state: 'failed',
              errMsg: r.err_msg || 'parse failed',
            });
            failed++;
          } else {
            const prog = r.extract_progress || {};
            await upsertFullText(row.itemID, {
              state: mapState(r.state),
              extractedPages: prog.extracted_pages ?? null,
              totalPages: prog.total_pages ?? null,
            });
          }
        }
      } catch (err) {
        const mineruCode = err.mineruCode ?? null;
        // -60012: task not found or expired (e.g. batch was submitted under
        //   a different token, or the result TTL elapsed). These won't ever
        //   resolve — mark failed so the user can retry with the current token.
        // A0202/A0211: invalid/expired token — same treatment.
        if (mineruCode === -60012 || mineruCode === 'A0202' || mineruCode === 'A0211') {
          for (const row of rows) {
            await upsertFullText(row.itemID, {
              state: 'failed',
              errMsg: err.message,
              errCode: String(mineruCode),
            });
            failed++;
          }
          console.warn(`[fulltext] batch ${batchId} unreachable (code ${mineruCode}); marked ${rows.length} item(s) as failed`);
        } else {
          // Transient network errors: leave state as-is for next tick.
          console.error(`[fulltext] poll error for batch ${batchId} (${rows.length} items):`, err.message);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, byBatch.size) }, worker));
  return { checked, finalized, failed };
}

function mapState(s) {
  // MinerU batch states: waiting-file, pending, running, converting, done, failed
  if (s === 'waiting-file') return 'pending';
  if (s === 'uploading') return 'pending';
  return s || 'pending';
}

async function finalizeDone(row, zipUrl) {
  // MinerU's zip extraction (AdmZip) needs a real directory, so we always
  // extract locally first. In MinIO mode, the local dir is a throwaway temp
  // dir: after extraction we upload every file to MinIO and delete it.
  const localDir = useS3()
    ? path.join(os.tmpdir(), `otero-fulltext-${row.itemKey}-${Date.now()}`)
    : fulltextDirFor(row.itemKey);

  const { fullMdPath } = await downloadAndExtract(zipUrl, localDir);
  await rewriteAssetPaths(fullMdPath, row.itemKey);
  await pruneUnusedMineruFiles(localDir);

  let markdownPath, assetDir;
  if (useS3()) {
    const prefix = fulltextPrefixFor(row.itemKey);
    await deleteStoredPrefix(prefix); // clear any partial prior upload
    await uploadDir(localDir, prefix);
    const relMd = path.relative(localDir, fullMdPath).replace(/\\/g, '/');
    markdownPath = `${prefix}/${relMd}`;
    assetDir = prefix;
    try { await fs.promises.rm(localDir, { recursive: true, force: true }); } catch { /* ignore */ }
  } else {
    markdownPath = relToStorage(fullMdPath);
    assetDir = relToStorage(localDir);
  }


  await upsertFullText(row.itemID, {
    state: 'done',
    markdownPath,
    assetDir,
    extractedPages: null,
    totalPages: null,
    errCode: null,
    errMsg: null,
    completedAt: nowStr(),
  });

  // Build Postgres FTS index from the freshly extracted markdown (best-effort).
  try {
    const { indexFullText } = await import('./fulltextIndexService.js');
    let markdown = null;
    try {
      const buf = await readStoredFile(markdownPath);
      markdown = buf.toString('utf8');
    } catch { /* indexFullText will re-read if needed */ }
    await indexFullText(row.itemID, { markdown, markdownPath });
  } catch (err) {
    console.error(`[fulltext-index] post-parse index failed itemID=${row.itemID}:`, err.message);
  }
}

/** Public read API: status + inline markdown content (when done). */
export async function getFullText(key) {
  const row = await getFullTextRowByKey(key);
  if (!row) return { state: 'idle', itemKey: key };
  const result = { ...row, itemKey: key };
  if (row.state === 'done' && row.markdownPath) {
    try {
      const buf = await readStoredFile(row.markdownPath);
      result.markdown = buf.toString('utf8');
    } catch (err) {
      result.markdown = null;
      result.errMsg = `markdown file missing: ${err.message}`;
    }
    result.imagesBaseUrl = `/api/attachments/${key}/fulltext`;
  }
  return result;
}

const DOI_RE = /https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s)"']+)|\b(10\.\d{4,9}\/[^\s)"']+)/i;

async function findContentList(dir) {
  try {
    for (const f of await fs.promises.readdir(dir)) {
      if (f === 'content_list.json' || (f.endsWith('_content_list.json') && !f.endsWith('_v2.json'))) {
        return path.join(dir, f);
      }
    }
  } catch { /* dir missing */ }
  return null;
}

async function* walk(dir) {
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    yield p;
    if (e.isDirectory()) yield* walk(p);
  }
}

async function findContentListRecursive(dir) {
  const direct = await findContentList(dir);
  if (direct) return direct;
  for await (const p of walk(dir)) {
    let st;
    try { st = await fs.promises.stat(p); } catch { continue; }
    if (st.isDirectory()) {
      const found = await findContentList(p);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Read and parse the content_list.json for a key, in either storage mode.
 * Returns { blocks, listDirRel } where listDirRel is the directory containing
 * content_list.json, expressed relative to the item's fulltext root (posix
 * separators) — used to resolve image paths referenced within the JSON.
 * Returns null if no content_list.json can be found or parsed.
 */
export async function getContentListBlocks(key) {
  if (useS3()) {
    const prefix = fulltextPrefixFor(key);
    const names = await listStoredPrefix(prefix);
    const relNames = names
      .filter(n => n.startsWith(`${prefix}/`))
      .map(n => n.slice(prefix.length + 1));
    const picked = pickContentListObjectName(relNames);
    if (!picked) return null;
    try {
      const buf = await readStoredFile(`${prefix}/${picked}`);
      const blocks = JSON.parse(buf.toString('utf8'));
      if (!Array.isArray(blocks)) return null;
      return { blocks, listDirRel: path.posix.dirname(picked) };
    } catch { return null; }
  }

  const dir = fulltextDirFor(key);
  const contentListPath = await findContentListRecursive(dir);
  if (!contentListPath) return null;
  try {
    const raw = await fs.promises.readFile(contentListPath, 'utf8');
    const blocks = JSON.parse(raw);
    if (!Array.isArray(blocks)) return null;
    const listDirRel = path.relative(dir, path.dirname(contentListPath)).replace(/\\/g, '/');
    return { blocks, listDirRel };
  } catch { return null; }
}

/**
 * Public read API: structured MinerU output derived from content_list.json.
 * Returns outline, figures, tables, equations, charts, references, footnotes,
 * and publisher stamp (header/footer) regardless of whether a markdown file
 * exists, so the article page can render rich assets even when full.md is absent.
 */
export async function getFullTextStructure(key) {
  const row = await getFullTextRowByKey(key);
  const base = {
    state: row?.state || 'idle',
    itemKey: key,
    pageCount: 0,
    outline: [],
    publisherStamp: { lines: [], doi: '' },
    figures: [],
    tables: [],
    equations: [],
    charts: [],
    references: [],
    footnotes: [],
  };
  if (!row || row.state !== 'done' || !row.assetDir) return base;

  const found = await getContentListBlocks(key);
  if (!found) return base;
  const { blocks, listDirRel } = found;

  const maxPage = blocks
    .map(b => b.page_idx)
    .filter(n => typeof n === 'number' && n >= 0)
    .reduce((a, b) => Math.max(a, b), -1);
  base.pageCount = maxPage + 1;

  const imgUrl = (imgPath) => {
    if (!imgPath) return null;
    const joined = path.posix.join(listDirRel, imgPath.replace(/\\/g, '/'));
    const rel = path.posix.normalize(joined).replace(/^(\.\.\/)+/, '');
    return `/api/attachments/${key}/fulltext/${rel}`;
  };

  const seenStamp = new Set();
  let id = 0;
  for (const b of blocks) {
    const type = b.type;
    const pageIdx = typeof b.page_idx === 'number' ? b.page_idx : 0;

    if (type === 'text' && b.text_level != null && b.text) {
      base.outline.push({ id: `o${id++}`, level: Number(b.text_level) || 1, text: String(b.text).trim(), pageIdx });
    } else if (['header', 'footer', 'page_header', 'page_footer'].includes(type)) {
      const text = (b.text || '').trim();
      if (!text || pageIdx > 1) continue;
      if (seenStamp.has(text)) continue;
      seenStamp.add(text);
      base.publisherStamp.lines.push(text);
      if (!base.publisherStamp.doi) {
        const m = text.match(DOI_RE);
        if (m) base.publisherStamp.doi = (m[1] || m[2] || '').replace(/[.,;]+$/, '').trim();
      }
    } else if (type === 'image' && b.img_path) {
      base.figures.push({
        id: `f${id++}`,
        pageIdx,
        imgUrl: imgUrl(b.img_path),
        caption: (b.image_caption || []).join('\n'),
        footnote: (b.image_footnote || []).join('\n'),
      });
    } else if (type === 'table') {
      base.tables.push({
        id: `t${id++}`,
        pageIdx,
        imgUrl: b.img_path ? imgUrl(b.img_path) : null,
        caption: (b.table_caption || []).join('\n'),
        html: b.table_body || null,
      });
    } else if (type === 'equation') {
      base.equations.push({
        id: `e${id++}`,
        pageIdx,
        text: b.text || '',
        imgUrl: b.img_path ? imgUrl(b.img_path) : null,
      });
    } else if (type === 'chart' && b.img_path) {
      base.charts.push({
        id: `c${id++}`,
        pageIdx,
        imgUrl: imgUrl(b.img_path),
        caption: b.text || (b.image_caption || []).join('\n'),
      });
    } else if (type === 'ref_text') {
      base.references.push({ id: `r${id++}`, pageIdx, text: b.text || '' });
    } else if (type === 'page_footnote' || type === 'aside_text') {
      base.footnotes.push({ id: `n${id++}`, pageIdx, text: b.text || '' });
    }
  }

  return base;
}

/** Remove extracted assets + DB row so a fresh parse can be triggered. */
export async function deleteFullText(key) {
  const row = await getFullTextRowByKey(key);
  if (!row) return { deleted: false };
  await cleanupAssets(key);
  await deleteFullTextRow(row.itemID);
  return { deleted: true };
}

async function cleanupAssets(key) {
  if (useS3()) {
    await deleteStoredPrefix(fulltextPrefixFor(key));
    return;
  }
  const dir = fulltextDirFor(key);
  try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** List all full-text rows (for admin/queue view). */
export async function listAll() {
  return listAllFullText();
}

/**
 * Resolve a sub-path under an item's fulltext assets, with traversal guard.
 * Returns a value suitable for storageService's getStoredFileStream()/
 * storedFileExists() — an absolute filesystem path in filesystem mode, or a
 * MinIO object name in MinIO mode. Returns null if the path escapes the
 * root or the asset doesn't exist.
 */
export async function resolveFullTextAsset(key, subPath) {
  if (useS3()) {
    const clean = path.posix.normalize(String(subPath || '').replace(/\\/g, '/')).replace(/^\/+/, '');
    if (!clean || clean === '.' || clean.startsWith('..') || clean.includes('/../')) return null;
    const objectName = `${fulltextPrefixFor(key)}/${clean}`;
    const exists = await storedFileExists(objectName);
    return exists ? objectName : null;
  }
  const root = fulltextDirFor(key);
  const abs = path.resolve(root, subPath || '');
  const rootResolved = path.resolve(root);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return null;
  }
  try { await fs.promises.access(abs); } catch { return null; }
  return abs;
}
