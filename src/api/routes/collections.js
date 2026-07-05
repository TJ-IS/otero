import { Router } from 'express';
import { Collection, Collections } from '../../models/Collection.js';
import { Item } from '../../models/Item.js';

export const collectionsRouter = Router();

collectionsRouter.get('/', (_req, res) => {
  res.json({ collections: Collections.list().map(c => c.toJSON()) });
});

collectionsRouter.get('/:key', (req, res) => {
  const c = Collection.loadByKey(req.params.key);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json({ ...c.toJSON(), items: c.items().map(r => ({ key: r.key, itemType: r.itemTypeID })) });
});

collectionsRouter.post('/', (req, res) => {
  const { name, parentKey } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name required' });
  let parentCollectionID = null;
  if (parentKey) {
    const parent = Collection.loadByKey(parentKey);
    if (!parent) return res.status(400).json({ error: 'parent collection not found' });
    parentCollectionID = parent.id;
  }
  const c = new Collection({ name, parentCollectionID });
  c.save();
  res.status(201).json(c.toJSON());
});

collectionsRouter.delete('/:key', (req, res) => {
  const c = Collection.loadByKey(req.params.key);
  if (!c) return res.status(404).json({ error: 'not found' });
  const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
  c.delete(permanent);
  res.json({ deleted: true, permanent });
});

collectionsRouter.post('/:key/items', (req, res) => {
  const c = Collection.loadByKey(req.params.key);
  if (!c) return res.status(404).json({ error: 'collection not found' });
  const { itemKey } = req.body ?? {};
  if (!itemKey) return res.status(400).json({ error: 'itemKey required' });
  const it = Item.loadByKey(itemKey);
  if (!it) return res.status(404).json({ error: 'item not found' });
  c.addItem(it.id);
  res.json({ added: true });
});
