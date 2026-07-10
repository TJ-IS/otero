import { Router } from 'express';
import { Items, Item } from '../../models/Item.js';
import { getDb } from '../../db/connection.js';
import { toBibtex, toRis, toBibtexBatch, toRisBatch } from '../../services/exportService.js';
import { UNFILED } from '../../services/journalWhitelist.js';

export const itemsRouter = Router();

// GET /api/items
itemsRouter.get('/', (req, res) => {
  const { type, journal, collection, search, includeDeleted } = req.query;
  // The "待归档" bucket (unfiled literature) is editor-only. Non-editors get
  // an empty result rather than the unfiled items.
  if (journal === UNFILED && !req.auth?.canEdit) {
    return res.json({ items: [] });
  }
  const topLevel = req.query.topLevel !== 'false' && req.query.topLevel !== '0';
  const items = Items.list({
    type,
    journal,
    collection,
    search,
    includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
    topLevelOnly: topLevel,
  });
  res.json({ items: items.map(it => it.toJSON()) });
});

// GET /api/items/export?format=bibtex|ris
itemsRouter.get('/export', (req, res) => {
  const { format, type, journal, search } = req.query;
  const items = Items.list({ type, journal, search, includeDeleted: false, topLevelOnly: true });
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

// GET /api/items/:key/export?format=bibtex|ris
itemsRouter.get('/:key/export', (req, res) => {
  const it = Item.loadByKey(req.params.key);
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
itemsRouter.get('/:key', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  res.json(it.toJSON());
});

// POST /api/items
itemsRouter.post('/', (req, res) => {
  const body = req.body ?? {};
  const it = new Item();
  if (!body.itemType) return res.status(400).json({ error: 'itemType required' });
  it.setItemType(body.itemType);
  if (body.fields) for (const [k, v] of Object.entries(body.fields)) it.setField(k, v);
  if (body.creators) it.setCreators(body.creators);
  it.save();
  res.status(201).json(it.toJSON());
});

// PATCH /api/items/:key
itemsRouter.patch('/:key', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const body = req.body ?? {};
  if (body.itemType) it.setItemType(body.itemType);
  if (body.fields) {
    for (const [k, v] of Object.entries(body.fields)) {
      if (v === null) it.setField(k, null);
      else it.setField(k, v);
    }
  }
  if (body.creators) it.setCreators(body.creators);
  it.save();
  res.json(it.toJSON());
});

// DELETE /api/items/:key
itemsRouter.delete('/:key', (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
  it.delete(permanent);
  res.json({ deleted: true, permanent });
});

// GET /api/items/:key/attachments
itemsRouter.get('/:key/attachments', async (req, res) => {
  const it = Item.loadByKey(req.params.key);
  if (!it) return res.status(404).json({ error: 'not found' });
  const { Attachment } = await import('../../models/Attachment.js');
  const atts = Attachment.listByParent(it.id);
  res.json({ attachments: atts.map(a => a.toJSON()) });
});
