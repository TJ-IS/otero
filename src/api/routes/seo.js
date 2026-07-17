import { Router } from 'express';
import {
  buildRobotsTxt,
  buildLlmsTxt,
  buildSitemapXml,
  renderSpaShellForRequest,
} from '../../services/seoService.js';

export const seoRouter = Router();

seoRouter.get('/robots.txt', (_req, res) => {
  res.type('text/plain; charset=utf-8').send(buildRobotsTxt());
});

seoRouter.get('/llms.txt', (_req, res) => {
  res.type('text/plain; charset=utf-8').send(buildLlmsTxt());
});

seoRouter.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const xml = await buildSitemapXml('index');
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
});

seoRouter.get('/sitemap-static.xml', async (_req, res, next) => {
  try {
    const xml = await buildSitemapXml('static');
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
});

seoRouter.get('/sitemap-items.xml', async (_req, res, next) => {
  try {
    const xml = await buildSitemapXml('items');
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
});

seoRouter.get('/sitemap-authors.xml', async (_req, res, next) => {
  try {
    const xml = await buildSitemapXml('authors');
    res.type('application/xml; charset=utf-8').send(xml);
  } catch (err) {
    next(err);
  }
});

/**
 * SPA fallback with SEO shell injection. Mount after express.static so real
 * assets (JS/CSS) still win; only unmatched HTML navigations hit this.
 */
export async function spaSeoFallback(req, res, next) {
  try {
    // Skip non-GET and obvious asset requests
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path) && !req.path.endsWith('.html')) {
      return next();
    }

    const result = await renderSpaShellForRequest(req);
    if (!result?.html) return next();
    res.status(result.status || 200).type('html').send(result.html);
  } catch (err) {
    next(err);
  }
}
