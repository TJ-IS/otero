import { Router } from 'express';
import { getCoauthorGraph, getAuthorDetail } from '../../repositories/authorRepo.js';
import { Item } from '../../models/Item.js';

export const authorsRouter = Router();

// GET /api/authors/graph?minPapers=3
authorsRouter.get('/graph', (req, res) => {
  const minPapers = Math.max(1, parseInt(req.query.minPapers, 10) || 3);
  res.json(getCoauthorGraph({ minPapers }));
});

// GET /api/authors/:id — author name + all their papers (full item JSON, same
// shape as GET /api/items), sorted newest first. Registered after '/graph' so
// that literal path takes precedence over this catch-all param route.
authorsRouter.get('/:id', (req, res) => {
  const creatorId = parseInt(req.params.id, 10);
  if (!Number.isInteger(creatorId)) {
    return res.status(400).json({ error: 'invalid author id' });
  }
  const detail = getAuthorDetail(creatorId);
  if (!detail) return res.status(404).json({ error: 'author not found' });

  const items = detail.itemIds
    .map(id => Item.loadById(id))
    .filter(Boolean)
    .map(it => it.toJSON())
    .sort((a, b) => (b.fields?.date || '').localeCompare(a.fields?.date || ''));

  res.json({ id: detail.id, name: detail.name, items });
});
