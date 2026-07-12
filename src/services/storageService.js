import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { config, ensureDataDirs } from '../config.js';
import { uploadFile, getObjectStream, deleteObject, objectExists, listObjectNames, deleteObjectsWithPrefix } from './s3Client.js';

export const useS3 = () => config.storage.type === 's3';

/**
 * Storage layout (filesystem):  data/storage/<key[0:2]>/<key>.<ext>
 * Storage layout (S3):          <key[0:2]>/<key>.<ext>  (same logical path as object name)
 */
export function storagePathForKey(key, ext = 'pdf') {
  return path.join(key.slice(0, 2), `${key}.${ext}`);
}

function absPathForKey(key, ext = 'pdf') {
  return path.join(config.storageDir, storagePathForKey(key, ext));
}

function md5ofBuffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/**
 * Copy or move a source file into storage under the given key.
 * Returns { path, md5, mtime, size }.
 *   - On filesystem mode: `path` is storage-relative (e.g. "AB/ABCdef12.pdf")
 *   - On MinIO mode:      `path` is the MinIO object name (same format)
 *
 * Async in both modes so callers can always await it.
 */
export async function storeFile(srcPath, key, { move = false, ext } = {}) {
  const extFromPath = path.extname(srcPath).slice(1);
  const extension = ext ?? (extFromPath || 'bin');
  const relPath = storagePathForKey(key, extension);

  const stat = fs.statSync(srcPath);
  const buf = fs.readFileSync(srcPath);
  const md5 = md5ofBuffer(buf);
  const size = stat.size;
  const mtime = stat.mtimeMs;

  if (useS3()) {
    await uploadFile(srcPath, relPath);
    if (move) fs.unlinkSync(srcPath);
    return { path: relPath, md5, mtime, size };
  }

  ensureDataDirs();
  const dest = path.join(config.storageDir, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (move) fs.renameSync(srcPath, dest);
  else fs.copyFileSync(srcPath, dest);
  return { path: relPath, md5, mtime, size };
}

/** Absolute path on disk for a stored-relative path (filesystem mode only). */
export function resolveStoredPath(relPath) {
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(config.storageDir, relPath);
}

/**
 * Read a stored file as a Buffer.
 * In MinIO mode, downloads into memory (only used for PDF parsing — acceptable
 * for single files; large-scale bulk reads go through streaming).
 */
export async function readStoredFile(relPath) {
  if (useS3()) {
    const stream = await getObjectStream(relPath);
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
  return fs.readFileSync(resolveStoredPath(relPath));
}

/**
 * Get a readable stream for an object (MinIO) or a fs.ReadStream (filesystem).
 * Use this in HTTP handlers to avoid buffering large files.
 */
export async function getStoredFileStream(relPath) {
  if (useS3()) {
    return getObjectStream(relPath);
  }
  return fs.createReadStream(resolveStoredPath(relPath));
}

/** Remove a stored file. */
export async function deleteStoredFile(relPath) {
  if (useS3()) {
    await deleteObject(relPath);
    return;
  }
  const abs = resolveStoredPath(relPath);
  try { fs.unlinkSync(abs); } catch { /* ignore */ }
}

/** Check whether a stored file exists. */
export async function storedFileExists(relPath) {
  if (useS3()) {
    return objectExists(relPath);
  }
  return fs.existsSync(resolveStoredPath(relPath));
}

/**
 * Download a stored file to a temporary location on disk and return its path.
 * Useful when downstream code (pdfjs, MinerU upload) needs a real file path.
 * The caller is responsible for deleting the temp file when done.
 */
export async function downloadToTemp(relPath) {
  if (!useS3()) {
    return resolveStoredPath(relPath);
  }
  const ext = path.extname(relPath) || '.bin';
  const tmp = path.join(os.tmpdir(), `otero-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  const stream = await getObjectStream(relPath);
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp);
    stream.pipe(ws);
    ws.on('finish', resolve);
    ws.on('error', reject);
    stream.on('error', reject);
  });
  return tmp;
}

/**
 * Recursively upload every file under localDir to MinIO.
 * Each file is stored as <objectPrefix>/<relative-path-from-localDir>.
 * Returns the list of object names written.
 */
export async function uploadDir(localDir, objectPrefix) {
  const names = [];
  function* walkSync(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) yield* walkSync(full);
      else yield full;
    }
  }
  for (const absFile of walkSync(localDir)) {
    const rel = path.relative(localDir, absFile).replace(/\\/g, '/');
    const objectName = `${objectPrefix}/${rel}`;
    await uploadFile(absFile, objectName);
    names.push(objectName);
  }
  return names;
}

/**
 * Delete all MinIO objects under a stored prefix (e.g. "<key>/fulltext").
 * No-op in filesystem mode.
 */
export async function deleteStoredPrefix(prefix) {
  if (!useS3()) return;
  await deleteObjectsWithPrefix(prefix);
}

/**
 * List all object names under a stored prefix.
 * Returns [] in filesystem mode.
 */
export async function listStoredPrefix(prefix) {
  if (!useS3()) return [];
  return listObjectNames(prefix);
}
