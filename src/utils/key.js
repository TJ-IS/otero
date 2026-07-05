import { randomBytes } from 'node:crypto';

// 8-character base32 key, mirroring Zotero's Zotero.Utilities.generateObjectKey().
// Alphabet excludes 0/1/O/L to avoid visual ambiguity.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_LEN = 8;

/**
 * Generate a random 8-char key in the Otero key space.
 * Returns uppercase base32-style string.
 */
export function generateKey() {
  const bytes = randomBytes(KEY_LEN);
  let out = '';
  for (let i = 0; i < KEY_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** True when s looks like an Otero object key. */
export function isValidKey(s) {
  return typeof s === 'string' && /^[A-Z2-9]{8}$/.test(s);
}
