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

statsRouter.get('/overview', (req, res) => {
  res.json(getOverviewStats());
});

statsRouter.get('/item-types', (req, res) => {
  res.json({ itemTypes: getItemTypeDistribution() });
});

statsRouter.get('/years', (req, res) => {
  res.json({ years: getPublicationYearHistogram() });
});

statsRouter.get('/journals', (req, res) => {
  let journals = getJournalBreakdown();
  // Same visibility rule as GET /api/journals: the "待归档" bucket is only
  // shown to whitelisted editors.
  if (!req.auth?.canEdit) {
    journals = journals.filter(j => j.name !== UNFILED);
  }
  res.json({ journals });
});

statsRouter.get('/fulltext', (req, res) => {
  res.json({ counts: getFullTextStatusCounts() });
});

statsRouter.get('/ingestion', (req, res) => {
  res.json({ activity: getIngestionActivity() });
});
