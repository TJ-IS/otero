import { Router } from 'express';
import { Collection, Collections } from '../../models/Collection.js';
import { Item } from '../../models/Item.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const collectionsRouter = Router();

collectionsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const collections = await Collections.list();
    res.json({ collections: collections.map((c) => c.toJSON()) });
  }),
);

collectionsRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const c = await Collection.loadByKey(req.params.key);
    if (!c) return res.status(404).json({ error: 'not found' });
    const items = await c.items();
    res.json({ ...c.toJSON(), items: items.map((r) => ({ key: r.key, itemType: r.itemTypeID })) });
  }),
);

collectionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, parentKey } = req.body ?? {};
    if (!name) return res.status(400).json({ error: 'name required' });
    let parentCollectionID = null;
    if (parentKey) {
      const parent = await Collection.loadByKey(parentKey);
      if (!parent) return res.status(400).json({ error: 'parent collection not found' });
      parentCollectionID = parent.id;
    }
    const c = new Collection({ name, parentCollectionID });
    await c.save();
    res.status(201).json(c.toJSON());
  }),
);

collectionsRouter.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const c = await Collection.loadByKey(req.params.key);
    if (!c) return res.status(404).json({ error: 'not found' });
    const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
    await c.delete(permanent);
    res.json({ deleted: true, permanent });
  }),
);

collectionsRouter.post(
  '/:key/items',
  asyncHandler(async (req, res) => {
    const c = await Collection.loadByKey(req.params.key);
    if (!c) return res.status(404).json({ error: 'collection not found' });
    const { itemKey } = req.body ?? {};
    if (!itemKey) return res.status(400).json({ error: 'itemKey required' });
    const it = await Item.loadByKey(itemKey);
    if (!it) return res.status(404).json({ error: 'item not found' });
    await c.addItem(it.id);
    res.json({ added: true });
  }),
);
