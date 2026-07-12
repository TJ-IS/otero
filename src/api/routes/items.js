import { Router } from 'express';
import { Items, Item } from '../../models/Item.js';
import { toBibtex, toRis, toBibtexBatch, toRisBatch } from '../../services/exportService.js';
import { UNFILED } from '../../services/journalWhitelist.js';

export const itemsRouter = Router();

// GET /api/items
itemsRouter.get('/', async (req, res) => {
  const { type, journal, collection, search, includeDeleted, page, pageSize, sortField, sortDir } = req.query;
  if (journal === UNFILED && !req.auth?.canEdit) {
    return res.json({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 });
  }
  const topLevel = req.query.topLevel !== 'false' && req.query.topLevel !== '0';
  const result = await Items.list({
    type,
    journal,
    collection,
    search,
    includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
    topLevelOnly: topLevel,
    page: page ? parseInt(page, 10) : 1,
    pageSize: pageSize ? parseInt(pageSize, 10) : 100,
    sortField: sortField || 'dateModified',
    sortDir: sortDir || 'desc',
  });
  res.json({
    items: result.items.map(it => it.toJSON()),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  });
});

// GET /api/items/export?format=bibtex|ris
itemsRouter.get('/export', async (req, res) => {
  const { format, type, journal, search } = req.query;
  const items = await Items.listAll({ type, journal, search, includeDeleted: false, topLevelOnly: true });
  if (format === 'ris') {
    res.setHeader('Content-Type', 'application/x-research-info-systems');
    res.setHeader('Content-Disposition', 'attachment; filename="otero-export.ris"');
    res.send(toRisBatch(items));
  } else {
    res.setHeader('Content-Type', 'application/x-bibtex');
    res.setHeader('Content-Disposition', 'attachment; filename="otero-export.bib"');
    res.send(toBibtexBatch(items));
  }
});

// GET /api/items/keys — all item keys matching a filter (for batch actions).
itemsRouter.get('/keys', async (req, res) => {
  const { type, journal, collection, search, includeDeleted } = req.query;
  if (journal === UNFILED && !req.auth?.canEdit) {
    return res.json({ keys: [] });
  }
  const keys = await Items.listKeys({
    type,
    journal,
    collection,
    search,
    includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
  });
  res.json({ keys });
});

// GET /api/items/:key/export?format=bibtex|ris
itemsRouter.get('/:key/export', async (req, res) => {
  const it = await Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const json = it.toJSON();
  const format = req.query.format || 'bibtex';
  if (format === 'ris') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(toRis(json));
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(toBibtex(json));
  }
});

// GET /api/items/:key
itemsRouter.get('/:key', async (req, res) => {
  const it = await Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it.toJSON());
});

// POST /api/items
itemsRouter.post('/', async (req, res) => {
  const body = req.body ?? {};
  const it = new Item();
  if (!body.itemType) return res.status(400).json({ error: 'itemType required' });
  await it.setItemType(body.itemType);
  if (body.fields) for (const [k, v] of Object.entries(body.fields)) it.setField(k, v);
  if (body.creators) it.setCreators(body.creators);
  await it.save();
  res.status(201).json(it.toJSON());
});

// PATCH /api/items/:key
itemsRouter.patch('/:key', async (req, res) => {
  const it = await Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const body = req.body ?? {};
  if (body.itemType) await it.setItemType(body.itemType);
  if (body.fields) {
    for (const [k, v] of Object.entries(body.fields)) {
      if (v === null) it.setField(k, null);
      else it.setField(k, v);
    }
  }
  if (body.creators) it.setCreators(body.creators);
  await it.save();
  res.json(it.toJSON());
});

// DELETE /api/items/:key
itemsRouter.delete('/:key', async (req, res) => {
  const it = await Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
  await it.delete(permanent);
  res.json({ deleted: true, permanent });
});

// GET /api/items/:key/attachments
itemsRouter.get('/:key/attachments', async (req, res) => {
  const it = await Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const { Attachment } = await import('../../models/Attachment.js');
  const atts = await Attachment.listByParent(it.id);
  res.json({ attachments: atts.map(a => a.toJSON()) });
});
