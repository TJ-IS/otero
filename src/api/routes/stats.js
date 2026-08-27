import { Router } from 'express';
import {
  getOverviewStats,
  getItemTypeDistribution,
  getPublicationYearHistogram,
  getJournalBreakdown,
  getFullTextStatusCounts,
  getIngestionActivity,
  getDoiCoverageStats,
  getDoiCoverageBreakdown,
  getMissingTargetDois,
} from '../../repositories/statsRepo.js';
import { UNFILED } from '../../services/journalWhitelist.js';
import { publicItemScope } from '../../services/itemVisibility.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const statsRouter = Router();

statsRouter.get('/overview', asyncHandler(async (req, res) => {
  res.json(await getOverviewStats(publicItemScope(req)));
}));

statsRouter.get('/doi-coverage', asyncHandler(async (req, res) => {
  res.json(await getDoiCoverageStats());
}));

statsRouter.get('/doi-coverage/breakdown', asyncHandler(async (req, res) => {
  res.json(await getDoiCoverageBreakdown());
}));

statsRouter.get('/doi-coverage/missing', asyncHandler(async (req, res) => {
  const journal = typeof req.query.journal === 'string' && req.query.journal
    ? req.query.journal
    : null;
  const yearRaw = req.query.year;
  const year = yearRaw != null && yearRaw !== '' ? Number(yearRaw) : null;
  res.json(await getMissingTargetDois({
    journal,
    year: Number.isFinite(year) ? year : null,
  }));
}));

statsRouter.get('/item-types', asyncHandler(async (req, res) => {
  res.json({ itemTypes: await getItemTypeDistribution(publicItemScope(req)) });
}));

statsRouter.get('/years', asyncHandler(async (req, res) => {
  res.json({ years: await getPublicationYearHistogram(publicItemScope(req)) });
}));

statsRouter.get('/journals', asyncHandler(async (req, res) => {
  let journals = await getJournalBreakdown();
  // Same visibility rule as GET /api/journals: the "待归档" bucket is only
  // shown to whitelisted editors.
  if (!req.auth?.canEdit) {
    journals = journals.filter(j => j.name !== UNFILED);
  }
  res.json({ journals });
}));

statsRouter.get('/fulltext', asyncHandler(async (req, res) => {
  res.json({ counts: await getFullTextStatusCounts() });
}));

statsRouter.get('/ingestion', asyncHandler(async (req, res) => {
  res.json({ activity: await getIngestionActivity() });
}));
