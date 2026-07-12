import { Router } from 'express';
import { getCoauthorGraph, getAuthorDetail, getAuthorAnalytics } from '../../repositories/authorRepo.js';
import { Item } from '../../models/Item.js';

export const authorsRouter = Router();

// GET /api/authors/graph?minPapers=3
authorsRouter.get('/graph', async (req, res) => {
  const minPapers = Math.max(1, parseInt(req.query.minPapers, 10) || 3);
  res.json(await getCoauthorGraph({ minPapers }));
});

// GET /api/authors/analytics
authorsRouter.get('/analytics', async (req, res) => {
  const topN = Math.min(100, Math.max(5, parseInt(req.query.topN, 10) || 25));
  const coreN = Math.min(20, Math.max(3, parseInt(req.query.coreN, 10) || 5));
  res.json(await getAuthorAnalytics({ topN, coreN }));
});

// GET /api/authors/:id — author name + all their papers (full item JSON, same
// shape as GET /api/items), sorted newest first. Registered after '/graph' /
// '/analytics' so literal paths take precedence over this catch-all.
authorsRouter.get('/:id', async (req, res) => {
  const creatorId = parseInt(req.params.id, 10);
  if (!Number.isInteger(creatorId)) {
    return res.status(400).json({ error: 'invalid author id' });
  }
  const detail = await getAuthorDetail(creatorId);
  if (!detail) return res.status(404).json({ error: 'author not found' });

  const loaded = await Promise.all(detail.itemIds.map(id => Item.loadById(id)));
  const items = loaded
    .filter(Boolean)
    .map(it => it.toJSON())
    .sort((a, b) => (b.fields?.date || '').localeCompare(a.fields?.date || ''));

  res.json({ id: detail.id, name: detail.name, items });
});
