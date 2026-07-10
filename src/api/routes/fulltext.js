import { Router } from 'express';
import { Item } from '../../models/Item.js';
import {
  parseItem, getFullText, getFullTextStructure, deleteFullText, enqueueBatchParse, retryFailed,
} from '../../services/fulltextService.js';
import { listFullTextPaged, getFullTextCounts } from '../../repositories/fulltextRepo.js';

export const fulltextRouter = Router();

const ALLOWED_FILTERS = new Set(['all', 'active', 'done', 'failed']);

// GET /api/fulltext/pending?filter=&page=&pageSize=
// Paged task-log view. Returns current page plus per-state counts so the
// UI can render summary + pagination without a second round-trip.
fulltextRouter.get('/fulltext/pending', (req, res) => {
  const filter = ALLOWED_FILTERS.has(req.query.filter) ? req.query.filter : 'all';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const { items, total } = listFullTextPaged({ filter, page, pageSize });
  res.json({
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    counts: getFullTextCounts(),
  });
});

// POST /api/fulltext/parse-batch  { keys: [key, ...] }
// Enqueues all items for background submission and returns immediately.
// Each valid item gets a 'submitting' DB row at once so it shows up in the
// task log; actual MinerU submission is drained by a bounded-concurrency
// queue in fulltextService.
fulltextRouter.post('/fulltext/parse-batch', async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : [];
  if (keys.length === 0) return res.status(400).json({ error: 'keys required' });
  const summary = await enqueueBatchParse(keys);
  res.json({ results: [], summary });
});

// POST /api/fulltext/retry-failed
// Re-enqueues every row currently in 'failed' state. Useful after a burst
// of HTTP 429 rate-limit failures.
fulltextRouter.post('/fulltext/retry-failed', async (_req, res) => {
  const summary = await retryFailed();
  res.json({ summary });
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

// GET /api/items/:key/fulltext/structure
// Structured MinerU output (outline, figures, tables, equations, charts,
// references, footnotes, publisher stamp) derived from content_list.json.
fulltextRouter.get('/items/:key/fulltext/structure', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(getFullTextStructure(req.params.key));
});

// DELETE /api/items/:key/fulltext
fulltextRouter.delete('/items/:key/fulltext', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(deleteFullText(req.params.key));
});
