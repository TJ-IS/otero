import { Router } from 'express';
import { Items, Item } from '../../models/Item.js';
import { getDb } from '../../db/connection.js';

export const itemsRouter = Router();

// GET /api/items
itemsRouter.get('/', (req, res) => {
  const { type, tag, collection, includeDeleted } = req.query;
  const topLevel = req.query.topLevel !== 'false' && req.query.topLevel !== '0';
  const items = Items.list({
    type,
    tag,
    collection,
    includeDeleted: includeDeleted === 'true' || includeDeleted === '1',
    topLevelOnly: topLevel,
  });
  res.json({ items: items.map(it => it.toJSON()) });
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
  if (body.tags) it.setTags(body.tags);
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
  if (body.tags) it.setTags(body.tags);
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
