import { Router } from 'express';
import { listJournals } from '../../repositories/itemRepo.js';
import { UNFILED } from '../../services/journalWhitelist.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const journalsRouter = Router();

journalsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    let journals = await listJournals();
    // The "待归档" bucket (unfiled literature) is only visible to whitelisted
    // editors. Anonymous or non-editor sessions never see it.
    if (!req.auth?.canEdit) {
      journals = journals.filter((j) => j.name !== UNFILED);
    }
    res.json({ journals });
  }),
);
