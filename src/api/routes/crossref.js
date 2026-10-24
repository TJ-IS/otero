import { Router } from 'express';
import { enrichFromCrossref } from '../../services/crossrefEnrichService.js';

export const crossrefRouter = Router();

// POST /api/items/:key/crossref
// Fetch CrossRef metadata for the item's DOI and return a comparison against
// current fields/creators. Does NOT modify the database.
crossrefRouter.post('/items/:key/crossref', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await enrichFromCrossref(req.params.key, {
      doi: typeof body.doi === 'string' ? body.doi : undefined,
      fields: body.fields && typeof body.fields === 'object' ? body.fields : undefined,
      creators: Array.isArray(body.creators) ? body.creators : undefined,
      itemType: typeof body.itemType === 'string' ? body.itemType : undefined,
    });
    res.json(result);
  } catch (err) {
    const msg = err.message || 'crossref enrich failed';
    const status = /not found|未找到/i.test(msg) ? 404 : /没有 DOI|no DOI/i.test(msg) ? 400 : 400;
    res.status(status).json({ error: msg });
  }
});
