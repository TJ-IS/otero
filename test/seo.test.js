import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { config } from '../src/config.js';
import { buildApp } from '../src/api/server.js';
import {
  publicBaseUrl,
  absoluteUrl,
  ogImageUrl,
  injectSpaShell,
  buildRobotsTxt,
  buildLlmsTxt,
  buildSitemapXml,
  renderSpaShellForRequest,
} from '../src/services/seoService.js';

const CANONICAL = 'https://ais-basket.xyz';
const OLD_DOMAIN = 'wtf-is.eu.cc';

let app;
let saved;

before(() => {
  saved = {
    publicBaseUrl: config.publicBaseUrl,
    publicOgImage: config.publicOgImage,
    googleSiteVerification: config.googleSiteVerification,
    enforceCanonicalHost: config.enforceCanonicalHost,
  };
  config.publicBaseUrl = CANONICAL;
  config.publicOgImage = '/og.png';
  config.googleSiteVerification = '';
  config.enforceCanonicalHost = false;
  app = buildApp();
});

after(() => {
  Object.assign(config, saved);
});

test('PUBLIC_BASE_URL override is reflected in absolute URLs', () => {
  const prev = config.publicBaseUrl;
  config.publicBaseUrl = 'https://example.test';
  try {
    assert.equal(publicBaseUrl(), 'https://example.test');
    assert.equal(absoluteUrl('/'), 'https://example.test/');
    assert.equal(absoluteUrl('/journals'), 'https://example.test/journals');
    assert.equal(ogImageUrl(), 'https://example.test/og.png');
    const robots = buildRobotsTxt();
    assert.match(robots, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
    assert.match(robots, /Disallow: \/api\/admin/);
    assert.equal(robots.includes('Disallow: /api/\n'), false);
    assert.ok(!robots.includes(OLD_DOMAIN));
    assert.ok(!robots.includes(CANONICAL));
  } finally {
    config.publicBaseUrl = prev;
  }
});

test('robots.txt uses the public base and does not mention the old domain', async () => {
  const res = await request(app).get('/robots.txt').expect(200);
  assert.match(res.text, new RegExp(`^# Otero — ${CANONICAL}`, 'm'));
  assert.match(res.text, /Sitemap: https:\/\/ais-basket\.xyz\/sitemap\.xml/);
  assert.ok(!res.text.includes(OLD_DOMAIN));
  assert.match(res.text, /Disallow: \/admin/);
  assert.match(res.text, /Disallow: \/api\/admin/);
  assert.equal(res.text.includes('Disallow: /api/\n'), false);
});

test('sitemap index and static sitemap use the new base and include /journals', async () => {
  const index = await request(app).get('/sitemap.xml').expect(200);
  assert.match(index.text, /<loc>https:\/\/ais-basket\.xyz\/sitemap-static\.xml<\/loc>/);
  assert.match(index.text, /<loc>https:\/\/ais-basket\.xyz\/sitemap-items\.xml<\/loc>/);
  assert.match(index.text, /<loc>https:\/\/ais-basket\.xyz\/sitemap-authors\.xml<\/loc>/);
  assert.ok(!index.text.includes(OLD_DOMAIN));

  const xml = await buildSitemapXml('static');
  assert.match(xml, /<loc>https:\/\/ais-basket\.xyz\/journals<\/loc>/);
  assert.match(xml, /<loc>https:\/\/ais-basket\.xyz\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/ais-basket\.xyz\/library<\/loc>/);
  assert.ok(!xml.includes(OLD_DOMAIN));
});

test('llms.txt links the new origin and the journals page', () => {
  const txt = buildLlmsTxt();
  assert.match(txt, /https:\/\/ais-basket\.xyz\/journals/);
  assert.match(txt, /npx skills add https:\/\/ais-basket\.xyz/);
  assert.ok(!txt.includes(OLD_DOMAIN));
});

test('injectSpaShell writes canonical, og:url, og:image, and lang=en', () => {
  const html = injectSpaShell(
    '<html lang="zh-CN"><head><title>x</title></head><body><div id="root"></div></body></html>',
    {
      title: 'Journals | Otero',
      description: 'Basket journals',
      canonicalPath: '/journals',
    },
  );
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ais-basket\.xyz\/journals" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/ais-basket\.xyz\/journals" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/ais-basket\.xyz\/og\.png" \/>/);
  assert.match(html, /<meta property="og:locale" content="en_US" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.ok(!html.includes(OLD_DOMAIN));
});

test('unknown paths return 404 with noindex', async () => {
  const res = await request(app).get('/this-page-does-not-exist').expect(404);
  assert.match(res.text, /<meta name="robots" content="noindex, follow" \/>/);
  assert.match(res.text, /<title>Not found \| Otero<\/title>/);
});

test('homepage shell lists the 11 basket journals for crawlers', async () => {
  const result = await renderSpaShellForRequest({ path: '/', query: {} });
  assert.equal(result.status, 200);
  assert.match(result.html, /<h1>AIS Senior Scholars' Basket of Journals<\/h1>/);
  assert.match(result.html, /MIS Quarterly/);
  assert.match(result.html, /Information Systems Research/);
  assert.match(result.html, /<meta name="robots" content="index, follow" \/>/);
});

test('/journals shell is indexable and lists the 11 basket journals', async () => {
  const result = await renderSpaShellForRequest({ path: '/journals', query: {} });
  assert.equal(result.status, 200);
  assert.match(result.html, /<link rel="canonical" href="https:\/\/ais-basket\.xyz\/journals" \/>/);
  assert.match(result.html, /AIS Senior Scholars/);
  assert.match(result.html, /MIS Quarterly/);
  assert.match(result.html, /Information &amp; Management/);
  assert.match(result.html, /"@type":"CollectionPage"/);
  assert.match(result.html, /<meta name="robots" content="index, follow" \/>/);
});

test('canonical host middleware 301s a foreign Host when enabled', async () => {
  config.enforceCanonicalHost = true;
  try {
    const res = await request(app)
      .get('/library')
      .set('Host', 'wtf-is.eu.cc')
      .expect(301);
    assert.equal(res.headers.location, `${CANONICAL}/library`);

    await request(app)
      .get('/health')
      .set('Host', 'wtf-is.eu.cc')
      .expect(200);

    await request(app)
      .get('/library')
      .set('Host', '127.0.0.1')
      .expect(200);
  } finally {
    config.enforceCanonicalHost = false;
  }
});

test('canonical host middleware is off by default', async () => {
  const res = await request(app)
    .get('/robots.txt')
    .set('Host', 'wtf-is.eu.cc')
    .expect(200);
  assert.match(res.text, /Sitemap:/);
});
