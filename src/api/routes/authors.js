import { Router } from 'express';
import { getCoauthorGraph, getAuthorDetail, getAuthorAnalytics } from '../../repositories/authorRepo.js';
import { Item } from '../../models/Item.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { JOURNAL_WHITELIST } from '../../services/journalWhitelist.js';
import { hideFromPublic, publicItemScope } from '../../services/itemVisibility.js';

export const authorsRouter = Router();

const MAX_GRAPH_NODES = 600;

function parseIntegerParam(value, { name, fallback, min, max }) {
  if (value == null || value === '') return { value: fallback };
  if (Array.isArray(value) || !/^\d+$/.test(String(value))) {
    return { error: `${name} must be an integer` };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return { error: `${name} must be between ${min} and ${max}` };
  }
  return { value: parsed };
}

// GET /api/authors/graph?minPapers=3&minCollaborations=1&journal=&yearFrom=&yearTo=
authorsRouter.get('/graph', asyncHandler(async (req, res) => {
  const minPapersResult = parseIntegerParam(req.query.minPapers, {
    name: 'minPapers', fallback: 3, min: 1, max: 1000,
  });
  const minCollaborationsResult = parseIntegerParam(req.query.minCollaborations, {
    name: 'minCollaborations', fallback: 1, min: 1, max: 100,
  });
  const yearFromResult = parseIntegerParam(req.query.yearFrom, {
    name: 'yearFrom', fallback: null, min: 1500, max: 2099,
  });
  const yearToResult = parseIntegerParam(req.query.yearTo, {
    name: 'yearTo', fallback: null, min: 1500, max: 2099,
  });
  const invalid = [
    minPapersResult, minCollaborationsResult, yearFromResult, yearToResult,
  ].find((result) => result.error);
  if (invalid) return res.status(400).json({ error: invalid.error });

  const journal = typeof req.query.journal === 'string' ? req.query.journal.trim() : '';
  if (req.query.journal != null && typeof req.query.journal !== 'string') {
    return res.status(400).json({ error: 'journal must be a single value' });
  }
  if (journal && !JOURNAL_WHITELIST.includes(journal)) {
    return res.status(400).json({ error: 'journal must be an AIS Basket journal' });
  }
  if (yearFromResult.value != null && yearToResult.value != null
    && yearFromResult.value > yearToResult.value) {
    return res.status(400).json({ error: 'yearFrom must be less than or equal to yearTo' });
  }

  return res.json(await getCoauthorGraph({
    minPapers: minPapersResult.value,
    minCollaborations: minCollaborationsResult.value,
    maxNodes: MAX_GRAPH_NODES,
    journal: journal || undefined,
    yearFrom: yearFromResult.value,
    yearTo: yearToResult.value,
    basketOnly: true,
    requireDoiForArticles: !req.auth?.canEdit,
  }));
}));

// GET /api/authors/analytics
authorsRouter.get('/analytics', asyncHandler(async (req, res) => {
  const topN = Math.min(100, Math.max(5, parseInt(req.query.topN, 10) || 25));
  const coreN = Math.min(20, Math.max(3, parseInt(req.query.coreN, 10) || 5));
  res.json(await getAuthorAnalytics({ topN, coreN, ...publicItemScope(req) }));
}));

// GET /api/authors/:id — author name + all their papers (full item JSON, same
// shape as GET /api/items), sorted newest first. Registered after '/graph' /
// '/analytics' so literal paths take precedence over this catch-all.
authorsRouter.get('/:id', asyncHandler(async (req, res) => {
  const creatorId = parseInt(req.params.id, 10);
  if (!Number.isInteger(creatorId)) {
    return res.status(400).json({ error: 'invalid author id' });
  }
  const detail = await getAuthorDetail(creatorId, publicItemScope(req));
  if (!detail) return res.status(404).json({ error: 'author not found' });

  const loaded = await Promise.all(detail.itemIds.map(id => Item.loadById(id)));
  const items = loaded
    .filter((it) => it && !hideFromPublic(req, it))
    .map(it => it.toJSON())
    .sort((a, b) => (b.fields?.date || '').localeCompare(a.fields?.date || ''));

  if (!req.auth?.canEdit && items.length === 0) {
    return res.status(404).json({ error: 'author not found' });
  }

  res.json({ id: detail.id, name: detail.name, items });
}));
