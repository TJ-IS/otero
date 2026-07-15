import { Router } from 'express';
import { merkleTree } from '../../services/merkleService.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const merkleRouter = Router();

merkleRouter.get('/merkle/root', asyncHandler(async (_req, res) => {
  res.json({
    root: await merkleTree.getRoot(),
    leafCount: await merkleTree.getLeafCount(),
  });
}));

merkleRouter.get('/merkle/exists', asyncHandler(async (req, res) => {
  const doi = req.query.doi;
  if (!doi || typeof doi !== 'string') {
    return res.status(400).json({ error: 'doi query parameter is required' });
  }

  const proof = await merkleTree.getProof(doi);
  res.json({
    doi,
    exists: proof !== null,
    proof,
    root: await merkleTree.getRoot(),
  });
}));

merkleRouter.post('/merkle/verify', (req, res) => {
  const { doi, proof } = req.body ?? {};
  if (!doi || typeof doi !== 'string' || !proof || !Array.isArray(proof.siblings)) {
    return res.status(400).json({ error: 'doi and proof.siblings are required' });
  }

  const valid = merkleTree.verify(doi, proof);
  res.json({ valid });
});

merkleRouter.post('/merkle/rebuild', asyncHandler(async (req, res) => {
  if (!req.auth?.canEdit) {
    return res.status(req.auth ? 403 : 401).json({ error: req.auth ? 'not an editor' : 'unauthorized' });
  }
  await merkleTree.rebuild();
  res.json({ root: await merkleTree.getRoot() });
}));
