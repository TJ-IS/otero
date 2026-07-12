import { readFileSync } from 'node:fs';
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
 * @returns {Set<string>}
 */
export function getTargetDoiKeys() {
  if (cached) return cached;
  const text = readFileSync(TARGET_PATH, 'utf8');
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const key = doiCompareKey(line);
    if (key) keys.add(key);
  }
  cached = keys;
  return cached;
}
