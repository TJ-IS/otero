import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ensureDataDirs } from '../config.js';

/**
 * Storage layout: data/storage/<key[0:2]>/<key>.<ext>
 * Mirrors Zotero's two-level prefix layout to keep dir entries small.
 */

export function storagePathForKey(key, ext = 'pdf') {
  return path.join(config.storageDir, key.slice(0, 2), `${key}.${ext}`);
}

/**
 * Copy or move a source file into storage under the given key.
 * Returns { path, md5, mtime, size }.
 */
export function storeFile(srcPath, key, { move = false, ext } = {}) {
  ensureDataDirs();
  const extFromPath = path.extname(srcPath).slice(1);
  const extension = ext ?? (extFromPath || 'bin');
  const dest = storagePathForKey(key, extension);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (move) fs.renameSync(srcPath, dest);
  else fs.copyFileSync(srcPath, dest);

  const buf = fs.readFileSync(dest);
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const stat = fs.statSync(dest);
  return { path: path.relative(config.storageDir, dest), md5, mtime: stat.mtimeMs, size: stat.size };
}

/** Absolute path on disk for a stored-relative path. */
export function resolveStoredPath(relPath) {
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(config.storageDir, relPath);
}

/** Read a stored file as a Buffer. */
export function readStoredFile(relPath) {
  return fs.readFileSync(resolveStoredPath(relPath));
}

/** Remove a stored file (no-op if missing). */
export function deleteStoredFile(relPath) {
  const abs = resolveStoredPath(relPath);
  try { fs.unlinkSync(abs); } catch { /* ignore */ }
}
