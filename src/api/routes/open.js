import { Router } from 'express';
import {
  OpenApiError,
  parseOpenFilters,
  listOpenJournals,
  searchOpenArticles,
  searchOpenAuthors,
  getOpenAuthorItems,
  unifiedOpenSearch,
  getItemByDoi,
  getMarkdownByDoi,
  getPdfUrlByDoi,
  buildSkillMarkdown,
} from '../../services/openApiService.js';

export const openRouter = Router();

function requestBaseUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  return `${proto}://${host}`;
}

function sendError(res, err) {
  if (err instanceof OpenApiError) {
    const body = { error: err.message };
    if (err.extra) Object.assign(body, err.extra);
    return res.status(err.status).json(body);
  }
  console.error('[open-api]', err);
  return res.status(500).json({ error: err.message || 'internal error' });
}

openRouter.get('/journals', async (_req, res) => {
  try {
    res.json(await listOpenJournals());
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/by-doi/markdown', async (req, res) => {
  try {
    res.json(await getMarkdownByDoi(req.query.doi));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/by-doi/pdf-url', async (req, res) => {
  try {
    const result = await getPdfUrlByDoi(req.query.doi);
    res.json({
      ...result,
      absoluteUrl: `${requestBaseUrl(req)}${result.url}`,
    });
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/by-doi', async (req, res) => {
  try {
    res.json(await getItemByDoi(req.query.doi));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/SKILL.md', (req, res) => {
  const md = buildSkillMarkdown({ baseUrl: requestBaseUrl(req) });
  res.type('text/markdown; charset=utf-8').send(md);
});

openRouter.get('/articles', async (req, res) => {
  try {
    const filters = parseOpenFilters(req.query);
    res.json(await searchOpenArticles({ q: req.query.q, ...filters }));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/authors', async (req, res) => {
  try {
    const filters = parseOpenFilters(req.query);
    res.json(await searchOpenAuthors({ q: req.query.q, ...filters }));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/authors/:id/items', async (req, res) => {
  try {
    const creatorId = parseInt(req.params.id, 10);
    if (!Number.isInteger(creatorId)) {
      throw new OpenApiError(400, 'invalid author id');
    }
    const filters = parseOpenFilters(req.query);
    res.json(await getOpenAuthorItems(creatorId, filters));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/search', async (req, res) => {
  try {
    const filters = parseOpenFilters(req.query);
    res.json(await unifiedOpenSearch({ q: req.query.q, ...filters }));
  } catch (err) {
    sendError(res, err);
  }
});
