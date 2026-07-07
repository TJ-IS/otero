import { Router } from 'express';
import { listJournals } from '../../repositories/itemRepo.js';

export const journalsRouter = Router();

journalsRouter.get('/', (_req, res) => {
  const journals = listJournals();
  res.json({ journals });
});
