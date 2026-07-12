import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDoi } from '../utils/doi.js';

const TARGET_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../target_dois.txt');

let cached = null;

/** Case-insensitive key for set membership across target list and DB. */
export function doiCompareKey(doi) {
  const n = normalizeDoi(doi);
  return n ? n.toLowerCase() : null;
}

/**
 * Unique normalized DOI keys from target_dois.txt (AIS Basket inventory).
 * Loaded once and cached for process lifetime.
 * Missing file → empty set (coverage UI shows zeros; does not crash the server).
 * @returns {Set<string>}
 */
export function getTargetDoiKeys() {
  if (cached) return cached;
  const keys = new Set();
  if (!existsSync(TARGET_PATH)) {
    console.warn(`[targetDois] ${TARGET_PATH} not found; DOI coverage target list is empty`);
    cached = keys;
    return cached;
  }
  const text = readFileSync(TARGET_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const key = doiCompareKey(line);
    if (key) keys.add(key);
  }
  cached = keys;
  return cached;
}
