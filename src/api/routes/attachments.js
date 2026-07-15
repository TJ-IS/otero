import { Router } from 'express';
import path from 'node:path';
import { queryOne } from '../../db/connection.js';
import { config } from '../../config.js';
import { resolveStoredPath, getStoredFileStream, storedFileExists } from '../../services/storageService.js';
import { resolveFullTextAsset } from '../../services/fulltextService.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const attachmentsRouter = Router();

/**
 * Stream a stored attachment file by its item key.
 * GET /api/attachments/:key/file
 */
attachmentsRouter.get('/:key/file', asyncHandler(async (req, res) => {
  const row = await queryOne(`
    SELECT a.path, a."contentType" AS "contentType"
    FROM items i
    JOIN "itemAttachments" a ON a."itemID" = i."itemID"
    WHERE i.key = $1 AND i.deleted = 0
  `, [req.params.key]);

  if (!row || !row.path) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  // Path-traversal guard for filesystem mode.
  if (config.storage.type === 'filesystem') {
    const abs = resolveStoredPath(row.path);
    const storageAbs = path.resolve(config.storageDir);
    if (!abs.startsWith(storageAbs + path.sep) && abs !== storageAbs) {
      return res.status(400).json({ error: 'invalid path' });
    }
  }

  const exists = await storedFileExists(row.path);
  if (!exists) {
    return res.status(404).json({ error: 'file missing' });
  }

  try {
    const contentType = row.contentType || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${req.params.key}.pdf"`);
    const stream = await getStoredFileStream(row.path);
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}));

/**
 * Serve a file from an item's extracted full-text directory (MinerU assets).
 * GET /api/attachments/:key/fulltext/*
 * Resolved via resolveFullTextAsset, which is storage-mode-aware (filesystem
 * or MinIO).
 */
attachmentsRouter.get('/:key/fulltext/*', asyncHandler(async (req, res) => {
  const subPath = req.params[0];
  if (!subPath) return res.status(400).json({ error: 'path required' });
  const resolved = await resolveFullTextAsset(req.params.key, subPath);
  if (!resolved) return res.status(404).json({ error: 'not found' });

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  try {
    const stream = await getStoredFileStream(resolved);
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}));

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};
