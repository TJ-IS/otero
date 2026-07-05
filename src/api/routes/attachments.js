import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../db/connection.js';
import { config } from '../../config.js';
import { resolveStoredPath } from '../../services/storageService.js';

export const attachmentsRouter = Router();

/**
 * Stream a stored attachment file by its item key.
 * GET /api/attachments/:key/file
 *
 * Returns the raw bytes with appropriate Content-Type. The Content-Disposition
 * is set to "inline" so browsers display the PDF in-page rather than forcing a
 * download. Path traversal is blocked by checking the resolved absolute path
 * stays within the configured storageDir.
 */
attachmentsRouter.get('/:key/file', (req, res) => {
  const row = getDb().prepare(`
    SELECT a.path, a.contentType
    FROM items i
    JOIN itemAttachments a ON a.itemID = i.itemID
    WHERE i.key = ? AND i.deleted = 0
  `).get(req.params.key);

  if (!row || !row.path) {
    return res.status(404).json({ error: 'attachment not found' });
  }

  const abs = resolveStoredPath(row.path);
  const storageAbs = path.resolve(config.storageDir);
  if (!abs.startsWith(storageAbs + path.sep) && abs !== storageAbs) {
    return res.status(400).json({ error: 'invalid path' });
  }
  if (!fs.existsSync(abs)) {
    return res.status(404).json({ error: 'file missing on disk' });
  }

  const contentType = row.contentType || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${req.params.key}.pdf"`);
  // Stream so we don't buffer large files in memory.
  fs.createReadStream(abs).pipe(res);
});
