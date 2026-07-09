import { Router } from 'express';
import { merkleTree } from '../../services/merkleService.js';

export const merkleRouter = Router();

/**
 * GET /api/merkle/root
 * Return the current Merkle root of the DOI set.
 */
merkleRouter.get('/merkle/root', (_req, res) => {
  res.json({ root: merkleTree.getRoot(), leafCount: merkleTree.getLeafCount() });
});

/**
 * GET /api/merkle/exists?doi=<doi>
 * Membership query with proof. If the DOI exists, the response includes a
 * Merkle proof that can be verified independently. If it does not exist,
 * proof is null.
 */
merkleRouter.get('/merkle/exists', (req, res) => {
  const doi = req.query.doi;
  if (!doi || typeof doi !== 'string') {
    return res.status(400).json({ error: 'doi query parameter is required' });
  }

  const proof = merkleTree.getProof(doi);
  res.json({
    doi,
    exists: proof !== null,
    proof,
    root: merkleTree.getRoot(),
  });
});

/**
 * POST /api/merkle/verify
 * Body: { doi: string, proof: MerkleProof }
 * Server-side verification helper. Clients can also verify locally using the
 * same algorithm; this endpoint is convenient for quick checks.
 */
merkleRouter.post('/merkle/verify', (req, res) => {
  const { doi, proof } = req.body ?? {};
  if (!doi || typeof doi !== 'string' || !proof || !Array.isArray(proof.siblings)) {
    return res.status(400).json({ error: 'doi and proof.siblings are required' });
  }

  const valid = merkleTree.verify(doi, proof);
  res.json({ valid });
});

/**
 * POST /api/merkle/rebuild
 * Rebuild the in-memory tree from the current database state.
 * Useful after bulk imports or metadata changes.
 */
merkleRouter.post('/merkle/rebuild', (req, res) => {
  if (!req.auth?.canEdit) {
    return res.status(req.auth ? 403 : 401).json({ error: req.auth ? 'not an editor' : 'unauthorized' });
  }
  merkleTree.rebuild();
  res.json({ root: merkleTree.getRoot() });
});
