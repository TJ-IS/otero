import { Router } from 'express';
import {
  buildRobotsTxt,
  buildLlmsTxt,
  buildSitemapXml,
  renderSpaShellForRequest,
} from '../../services/seoService.js';

export const seoRouter = Router();

function noStore(res) {
  // Cloudflare's zone Browser Cache TTL is 4h when origin sends no
  // Cache-Control; that previously kept a stale robots.txt advertising the
  // old domain. Keep robots/llms at the origin.
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store',
  });
}

seoRouter.get('/robots.txt', (_req, res) => {
  noStore(res);
  res.type('text/plain; charset=utf-8').send(buildRobotsTxt());
});

seoRouter.get('/llms.txt', (_req, res) => {
  noStore(res);
  res.type('text/plain; charset=utf-8').send(buildLlmsTxt());
});

function sendSitemap(res, xml) {
  res
    .type('application/xml; charset=utf-8')
    .set('Cache-Control', 'public, max-age=3600')
    .send(xml);
}

seoRouter.get('/sitemap.xml', async (_req, res, next) => {
  try {
    sendSitemap(res, await buildSitemapXml('index'));
  } catch (err) {
    next(err);
  }
});

seoRouter.get('/sitemap-static.xml', async (_req, res, next) => {
  try {
    sendSitemap(res, await buildSitemapXml('static'));
  } catch (err) {
    next(err);
  }
});

seoRouter.get('/sitemap-items.xml', async (_req, res, next) => {
  try {
    sendSitemap(res, await buildSitemapXml('items'));
  } catch (err) {
    next(err);
  }
});

seoRouter.get('/sitemap-authors.xml', async (_req, res, next) => {
  try {
    sendSitemap(res, await buildSitemapXml('authors'));
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
