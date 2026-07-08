import { Router } from 'express';
import { Item } from '../../models/Item.js';
import {
  parseItem, getFullText, deleteFullText, listAll, enqueueBatchParse,
} from '../../services/fulltextService.js';

export const fulltextRouter = Router();

// GET /api/fulltext/pending  — admin queue view (all rows)
fulltextRouter.get('/fulltext/pending', (_req, res) => {
  res.json({ items: listAll() });
});

// POST /api/fulltext/parse-batch  { keys: [key, ...] }
// Enqueues all items for background submission and returns immediately.
// Each valid item gets a 'submitting' DB row at once so it shows up in the
// task log; actual MinerU submission is drained by a bounded-concurrency
// queue in fulltextService.
fulltextRouter.post('/fulltext/parse-batch', (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  if (keys.length === 0) return res.status(400).json({ error: 'keys required' });
  const summary = enqueueBatchParse(keys);
  res.json({ results: [], summary });
});

// POST /api/items/:key/fulltext/parse  ?force=true
fulltextRouter.post('/items/:key/fulltext/parse', async (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const force = req.query.force === 'true' || req.query.force === '1';
  try {
    const r = await parseItem(req.params.key, { force });
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/items/:key/fulltext
fulltextRouter.get('/items/:key/fulltext', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(getFullText(req.params.key));
});

// DELETE /api/items/:key/fulltext
fulltextRouter.delete('/items/:key/fulltext', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(deleteFullText(req.params.key));
});
