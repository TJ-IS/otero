/**
 * Browser-side Merkle proof verification.
 *
 * Mirrors the server-side algorithm in src/services/merkleService.js so a
 * client can verify DOI membership without trusting the server response.
 */

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeDoi(doi) {
  return String(doi).trim().toLowerCase();
}

/**
 * Verify a Merkle proof for a DOI.
 *
 * @param {string} doi - The DOI string (will be normalized).
 * @param {object} proof - The proof object from /api/merkle/exists.
 * @param {string} proof.root - The expected Merkle root.
 * @param {Array<{hash: string, side: 'left'|'right'}>} proof.siblings
 * @returns {Promise<boolean>}
 */
export async function verifyDoiProof(doi, proof) {
  let hash = await sha256Hex(normalizeDoi(doi));
  for (const sib of proof.siblings) {
    if (sib.side === 'left') {
      hash = await sha256Hex(sib.hash + hash);
    } else {
      hash = await sha256Hex(hash + sib.hash);
    }
  }
  return hash === proof.root;
}

/**
 * Verify a proof step-by-step, returning intermediate hashes.
 * Returns an array of { step, inputHash, siblingHash, siblingSide, outputHash, verified }
 * where `verified` means the client independently recomputed outputHash from inputHash
 * and siblingHash.
 *
 * @param {string} doi
 * @param {object} proof - Must contain proof.path from the server.
 * @returns {Promise<Array>}
 */
export async function verifyDoiProofPath(doi, proof) {
  const results = [];
  let currentHash = await sha256Hex(normalizeDoi(doi));

  for (const step of proof.path) {
    const combined = step.siblingSide === 'left'
      ? step.siblingHash + currentHash
      : currentHash + step.siblingHash;
    const recomputed = await sha256Hex(combined);
    results.push({
      step: step.step,
      inputHash: currentHash,
      siblingHash: step.siblingHash,
      siblingSide: step.siblingSide,
      serverOutputHash: step.outputHash,
      clientOutputHash: recomputed,
      verified: recomputed === step.outputHash,
    });
    currentHash = recomputed;
  }

  return { steps: results, rootVerified: currentHash === proof.root };
}

/** API client helpers for the Merkle endpoints. */
const API_BASE = '/api/merkle';

export async function fetchMerkleRoot() {
  const res = await fetch(`${API_BASE}/root`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchMerkleExists(doi) {
  const encoded = encodeURIComponent(doi);
  const res = await fetch(`${API_BASE}/exists?doi=${encoded}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function verifyMerkleProofServerSide(doi, proof) {
  const res = await fetch(`${API_BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doi, proof }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function rebuildMerkleTree() {
  const res = await fetch(`${API_BASE}/rebuild`, { method: 'POST' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
