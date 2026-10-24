import fs from 'node:fs';
import path from 'node:path';
import { query, queryOne, execute, nowUtc } from '../db/connection.js';
import { config } from '../config.js';
import { readStoredFile, useS3 } from './storageService.js';
import { getFullTextRow, getFullTextRowByKey } from '../repositories/fulltextRepo.js';

/**
 * Strip Markdown / HTML noise into plain text suitable for Postgres FTS.
 */
export function markdownToPlain(md) {
  if (!md) return '';
  let s = String(md);
  // Postgres text/tsvector reject NUL bytes.
  s = s.replace(/\u0000/g, '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/!\[[^\]]*]\([^)]*\)/g, ' ');
  s = s.replace(/\[([^\]]*)]\([^)]*\)/g, '$1');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/[#*_`>~|\\]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Prefer a local data/storage copy when present (faster than R2 for backfill),
 * otherwise fall through to the configured storage backend.
 */
async function readMarkdownForIndex(markdownPath) {
  if (useS3() && markdownPath) {
    const localAbs = path.join(config.storageDir, markdownPath);
    try {
      return await fs.promises.readFile(localAbs);
    } catch {
      /* miss — download from S3 */
    }
  }
  return readStoredFile(markdownPath);
}

/**
 * Write plainText + tsv for one itemFullText row (UPDATE only — never DELETE).
 * @param {number} itemId
 * @param {{ markdown?: string, markdownPath?: string|null }} [opts]
 */
export async function indexFullText(itemId, opts = {}) {
  let markdown = opts.markdown ?? null;
  if (markdown == null) {
    const row = opts.markdownPath
      ? { markdownPath: opts.markdownPath, state: 'done' }
      : await getFullTextRow(itemId);
    if (!row || row.state !== 'done' || !row.markdownPath) {
      return { ok: false, reason: 'not_ready' };
    }
    try {
      const buf = await readMarkdownForIndex(row.markdownPath);
      markdown = buf.toString('utf8');
    } catch (err) {
      console.error(`[fulltext-index] read failed itemID=${itemId}:`, err.message);
      return { ok: false, reason: 'read_failed', error: err.message };
    }
  }

  const plainText = markdownToPlain(markdown);
  if (!plainText) {
    return { ok: false, reason: 'empty' };
  }

  const indexedAt = nowUtc();
  await execute(
    `UPDATE "itemFullText"
     SET "plainText" = $1,
         tsv = to_tsvector('simple', $1),
         "indexedAt" = $2
     WHERE "itemID" = $3`,
    [plainText, indexedAt, itemId],
  );
  return { ok: true, chars: plainText.length, indexedAt };
}

/**
 * Index by item key (convenience for CLI / hooks).
 */
export async function indexFullTextByKey(key) {
  const row = await getFullTextRowByKey(key);
  if (!row) return { ok: false, reason: 'missing_row' };
  return indexFullText(row.itemID, { markdownPath: row.markdownPath });
}

/**
 * Backfill FTS for all done rows that are missing tsv.
 * @param {{ force?: boolean, limit?: number, concurrency?: number, onProgress?: Function }} [opts]
 */
/**
 * Prefer rows whose markdown already exists under data/storage (local cache)
 * so backfill avoids slow remote object-store round trips when possible.
 */
export async function backfillFullTextIndex({
  force = false,
  limit = 0,
  concurrency = 4,
  onProgress = null,
} = {}) {
  const where = force
    ? `WHERE f.state = 'done' AND f."markdownPath" IS NOT NULL`
    : `WHERE f.state = 'done' AND f."markdownPath" IS NOT NULL AND f.tsv IS NULL`;
  // Load candidates first (paths only). Apply --limit after local-first ordering
  // so we don't spend a batch on remote-only rows while local cache sits unused.
  let rows = await query(`
    SELECT f."itemID", f."markdownPath", i.key AS "itemKey"
    FROM "itemFullText" f
    JOIN items i ON i."itemID" = f."itemID"
    ${where}
    ORDER BY f."itemID"
  `);

  if (useS3() && rows.length > 1) {
    const local = [];
    const remote = [];
    for (const row of rows) {
      const abs = path.join(config.storageDir, row.markdownPath);
      try {
        await fs.promises.access(abs);
        local.push(row);
      } catch {
        remote.push(row);
      }
    }
    rows = [...local, ...remote];
  }

  if (limit > 0) rows = rows.slice(0, Math.floor(limit));

  let ok = 0;
  let fail = 0;
  let idx = 0;

  async function worker() {
    while (idx < rows.length) {
      const i = idx++;
      const row = rows[i];
      try {
        const r = await indexFullText(row.itemID, { markdownPath: row.markdownPath });
        if (r.ok) ok++;
        else fail++;
        if (onProgress)
          onProgress({ ...r, itemKey: row.itemKey, done: ok + fail, total: rows.length });
      } catch (err) {
        fail++;
        console.error(`[fulltext-index] ${row.itemKey}:`, err.message);
        if (onProgress) {
          onProgress({
            ok: false,
            reason: 'error',
            error: err.message,
            itemKey: row.itemKey,
            done: ok + fail,
            total: rows.length,
          });
        }
      }
    }
  }

  const n = Math.max(1, Math.min(concurrency, rows.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { total: rows.length, ok, fail };
}

export async function countUnindexedFullText() {
  const row = await queryOne(`
    SELECT COUNT(*)::int AS n
    FROM "itemFullText"
    WHERE state = 'done' AND "markdownPath" IS NOT NULL AND tsv IS NULL
  `);
  return row?.n ?? 0;
}
