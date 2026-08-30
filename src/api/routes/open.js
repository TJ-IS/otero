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
  getOpenItemByKey,
  getMarkdownByKey,
  getPdfUrlByKey,
  getStructureByKey,
  exportItemByKey,
  exportOpenArticles,
  getOpenFacets,
  getOpenOverviewStats,
  getOpenTimeline,
  buildSkillMarkdown,
} from '../../services/openApiService.js';
import { requestBaseUrl } from '../../services/pdfAccess.js';

export const openRouter = Router();

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

openRouter.get('/items/:key/markdown', async (req, res) => {
  try {
    res.json(await getMarkdownByKey(req.params.key));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/:key/pdf-url', async (req, res) => {
  try {
    const result = await getPdfUrlByKey(req.params.key);
    res.json({ ...result, absoluteUrl: `${requestBaseUrl(req)}${result.url}` });
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/:key/structure', async (req, res) => {
  try {
    res.json(await getStructureByKey(req.params.key));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/:key/export', async (req, res) => {
  try {
    const result = await exportItemByKey(req.params.key, req.query.format);
    res.type(result.format === 'ris' ? 'application/x-research-info-systems' : 'application/x-bibtex');
    res.send(result.content);
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/items/:key', async (req, res) => {
  try {
    res.json(await getOpenItemByKey(req.params.key));
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

openRouter.get('/articles/export', async (req, res) => {
  try {
    const filters = parseOpenFilters(req.query);
    const result = await exportOpenArticles({ q: req.query.q, format: req.query.format, ...filters });
    const ext = result.format === 'ris' ? 'ris' : 'bib';
    res.setHeader('X-Export-Count', String(result.count));
    res.setHeader('Content-Disposition', `attachment; filename="otero-open-export.${ext}"`);
    res.type(result.format === 'ris' ? 'application/x-research-info-systems' : 'application/x-bibtex');
    res.send(result.content);
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/facets', async (req, res) => {
  try {
    const filters = parseOpenFilters(req.query);
    res.json(await getOpenFacets({ q: req.query.q, ...filters }));
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/stats/overview', async (_req, res) => {
  try {
    res.json(await getOpenOverviewStats());
  } catch (err) {
    sendError(res, err);
  }
});

openRouter.get('/stats/timeline', async (req, res) => {
  try {
    const filters = parseOpenFilters(req.query);
    res.json({ years: await getOpenTimeline({ q: req.query.q, ...filters }) });
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
