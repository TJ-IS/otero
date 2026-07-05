import { Router } from 'express';
import { Tag } from '../../models/Tag.js';

export const tagsRouter = Router();

tagsRouter.get('/', (_req, res) => {
  res.json({ tags: Tag.list().map(t => t.toJSON()) });
});

tagsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id required' });
  Tag.delete(id);
  res.json({ deleted: true });
});
