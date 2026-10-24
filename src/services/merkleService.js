import { createHash } from 'node:crypto';
import { query } from '../db/connection.js';
import { fieldIdByName } from '../repositories/itemRepo.js';

const HASH_ALGORITHM = 'sha256';
const EMPTY_ROOT = null;

/** @param {string} input */
export function sha256Hex(input) {
  return createHash(HASH_ALGORITHM).update(input, 'utf8').digest('hex');
}

/** DOI comparison is case-insensitive and whitespace-tolerant. */
export function normalizeDoi(doi) {
  return String(doi).trim().toLowerCase();
}

/**
 * Build a deterministic Merkle tree from a list of DOI strings.
 * Returns { leaves, levels, root, doiToIndex }.
 *
 * - Leaves are sorted (lexicographically) so the root is stable for a given set.
 * - Duplicate DOIs are deduplicated at the set level because we only need presence.
 * - If a level has an odd number of nodes, the last node is duplicated to pair with itself.
 */
function buildTree(dois) {
  const unique = [...new Set(dois.map(normalizeDoi))];
  unique.sort();

  if (unique.length === 0) {
    return {
      leaves: [],
      levels: [],
      root: EMPTY_ROOT,
      doiToIndex: new Map(),
      indexToDoi: new Map(),
    };
  }

  const leaves = unique.map((doi) => sha256Hex(doi));
  const doiToIndex = new Map(unique.map((doi, i) => [doi, i]));
  const indexToDoi = new Map(unique.map((doi, i) => [i, doi]));

  const levels = [leaves];
  let level = leaves;

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? left; // duplicate last node if odd
      next.push(sha256Hex(left + right));
    }
    levels.push(next);
    level = next;
  }

  return { leaves, levels, root: level[0], doiToIndex, indexToDoi };
}

/**
 * In-memory Merkle tree over the DOI field of top-level, non-deleted items.
 *
 * The tree is rebuilt lazily on first access and can be refreshed by calling
 * rebuild(). This keeps the implementation simple while still supporting
 * cryptographic membership proofs.
 */
class MerkleTree {
  constructor() {
    this._tree = null;
    this._building = null;
  }

  /**
   * Rebuild the tree from the current database state.
   * Returns the tree descriptor for inspection/testing.
   */
  async rebuild() {
    const fieldId = await fieldIdByName('DOI');
    if (!fieldId) {
      this._tree = { leaves: [], levels: [], root: EMPTY_ROOT, doiToIndex: new Map() };
      return this._tree;
    }

    const rows = await query(
      `
      SELECT v.value AS doi
      FROM "itemData" d
      JOIN "itemDataValues" v ON v."valueID" = d."valueID"
      JOIN items i ON i."itemID" = d."itemID"
      WHERE d."fieldID" = $1
        AND i.deleted = 0
        AND i."parentItemID" IS NULL
    `,
      [fieldId],
    );

    this._tree = buildTree(rows.map((r) => r.doi));
    return this._tree;
  }

  async _ensureBuilt() {
    if (this._tree) return;
    if (!this._building) {
      this._building = this.rebuild().finally(() => {
        this._building = null;
      });
    }
    await this._building;
  }

  /** Return the current Merkle root (or null if no DOIs). */
  async getRoot() {
    await this._ensureBuilt();
    return this._tree.root;
  }

  /** Return the number of unique DOIs in the tree. */
  async getLeafCount() {
    await this._ensureBuilt();
    return this._tree.leaves.length;
  }

  /**
   * Check whether a DOI exists in the current tree.
   * This is a plain membership test; for a proof use getProof().
   */
  async exists(doi) {
    await this._ensureBuilt();
    return this._tree.doiToIndex.has(normalizeDoi(doi));
  }

  /**
   * Generate a Merkle proof for a DOI.
   * Returns null if the DOI is not in the tree.
   *
   * Proof shape:
   *   {
   *     doi: string,          // normalized DOI
   *     leafHash: string,      // hash(normalized DOI)
   *     root: string,          // current Merkle root
   *     siblings: [            // path from leaf to root
   *       { hash: string, side: 'left' | 'right' }, ...
   *     ],
   *     path: [                // step-by-step derivation with intermediate hashes
   *       {
   *         step: number,
   *         inputHash: string,    // hash coming into this step
   *         siblingHash: string,  // sibling hash
   *         siblingSide: 'left' | 'right',
   *         combined: string,     // 'left+right' string that was hashed
   *         outputHash: string,   // resulting hash (input for next step)
   *       }, ...
   *     ]
   *   }
   *
   * `side` indicates where the sibling sits when recombining hashes.
   */
  async getProof(doi) {
    await this._ensureBuilt();
    const { root, levels, doiToIndex } = this._tree;
    if (!root) return null;

    const normalized = normalizeDoi(doi);
    let index = doiToIndex.get(normalized);
    if (index === undefined) return null;

    const siblings = [];
    const path = [];
    let currentHash = sha256Hex(normalized);

    for (let level = 0; level < levels.length - 1; level++) {
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;
      const siblingHash = levels[level][siblingIndex] ?? levels[level][index];
      const side = isRight ? 'left' : 'right';
      siblings.push({ hash: siblingHash, side });

      const combined = side === 'left' ? siblingHash + currentHash : currentHash + siblingHash;
      const outputHash = sha256Hex(combined);
      path.push({
        step: level,
        inputHash: currentHash,
        siblingHash,
        siblingSide: side,
        combined,
        outputHash,
      });
      currentHash = outputHash;
      index = Math.floor(index / 2);
    }

    return {
      doi: normalized,
      leafHash: sha256Hex(normalized),
      root,
      siblings,
      path,
    };
  }

  /**
   * Verify a proof without trusting the server.
   * Recomputes the root from the leaf and the supplied siblings.
   */
  verify(doi, proof) {
    let hash = sha256Hex(normalizeDoi(doi));
    for (const sib of proof.siblings) {
      if (sib.side === 'left') {
        hash = sha256Hex(sib.hash + hash);
      } else {
        hash = sha256Hex(hash + sib.hash);
      }
    }
    return hash === proof.root;
  }
}

/** Singleton instance used by the API. */
export const merkleTree = new MerkleTree();
