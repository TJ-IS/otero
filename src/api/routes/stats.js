import { Router } from 'express';
import {
  getOverviewStats,
  getItemTypeDistribution,
  getPublicationYearHistogram,
  getJournalBreakdown,
  getFullTextStatusCounts,
  getIngestionActivity,
} from '../../repositories/statsRepo.js';
import { UNFILED } from '../../services/journalWhitelist.js';

export const statsRouter = Router();

statsRouter.get('/overview', async (req, res) => {
  res.json(await getOverviewStats());
});

statsRouter.get('/item-types', async (req, res) => {
  res.json({ itemTypes: await getItemTypeDistribution() });
});

statsRouter.get('/years', async (req, res) => {
  res.json({ years: await getPublicationYearHistogram() });
});

statsRouter.get('/journals', async (req, res) => {
  let journals = await getJournalBreakdown();
  // Same visibility rule as GET /api/journals: the "待归档" bucket is only
  // shown to whitelisted editors.
  if (!req.auth?.canEdit) {
    journals = journals.filter(j => j.name !== UNFILED);
  }
  res.json({ journals });
});

statsRouter.get('/fulltext', async (req, res) => {
  res.json({ counts: await getFullTextStatusCounts() });
});

statsRouter.get('/ingestion', async (req, res) => {
  res.json({ activity: await getIngestionActivity() });
});
