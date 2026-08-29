import express from 'express';
import { json } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { itemsRouter } from './routes/items.js';
import { collectionsRouter } from './routes/collections.js';
import { journalsRouter } from './routes/journals.js';
import { importRouter } from './routes/import.js';
import { attachmentsRouter } from './routes/attachments.js';
import { fulltextRouter } from './routes/fulltext.js';
import { calibrateRouter } from './routes/calibrate.js';
import { crossrefRouter } from './routes/crossref.js';
import { extractRouter } from './routes/extract.js';
import { merkleRouter } from './routes/merkle.js';
import { chatRouter } from './routes/chat.js';
import { authorsRouter } from './routes/authors.js';
import { statsRouter } from './routes/stats.js';
import { authRouter } from './routes/auth.js';
import { openRouter } from './routes/open.js';
import { adminRouter } from './routes/admin.js';
import { seoRouter, spaSeoFallback } from './routes/seo.js';
import { canonicalHostRedirect } from './middleware/canonicalHost.js';
import { optionalAuth, editorWriteGate, requireEditor } from './middleware/auth.js';
import { startFullTextWorker } from '../services/fulltextWorker.js';
import { recoverSubmittingOnStartup } from '../services/fulltextService.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');

/**
 * Build the Express app. Exported for testing.
 */
export function buildApp() {
  const app = express();
  app.use(json({ limit: '5mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

  app.use(canonicalHostRedirect);

  // Machine-readable SEO files (always available, even without a web build).
  app.use(seoRouter);

  app.use('/api/auth', authRouter);
  app.use('/api', optionalAuth(), editorWriteGate);

  // Admin routes: whitelist-only. editorWriteGate lets GETs through to anyone,
  // so gate the whole admin surface (including reads) behind requireEditor —
  // these endpoints expose connection strings, storage endpoints and creds.
  app.use('/api/admin', requireEditor, adminRouter);

  app.use('/api/items', itemsRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/journals', journalsRouter);
  app.use('/api/authors', authorsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/open/v1', openRouter);
  app.use('/api/import', importRouter);
  app.use('/api/attachments', attachmentsRouter);
  app.use('/api', fulltextRouter);
  app.use('/api', calibrateRouter);
  app.use('/api', crossrefRouter);
  app.use('/api', extractRouter);
  app.use('/api', merkleRouter);
  app.use('/api', chatRouter);

  // Serve built Vite assets when present. Disable the automatic index.html so
  // HTML navigations go through spaSeoFallback (meta + crawlable body inject).
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST, { index: false }));
  }
  app.get(/^\/(?!api|health).*/, spaSeoFallback);

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  return app;
}

/**
 * Start the REST API server. Returns the http.Server instance.
 */
export async function startServer({ port, host } = {}) {
  const app = buildApp();
  const listenPort = port ?? config.api.port;
  const listenHost = host ?? config.api.host;
  const server = app.listen(listenPort, listenHost, () => {
    console.log(`Otero API listening on http://${listenHost}:${listenPort}`);
  });
  startFullTextWorker();
  await recoverSubmittingOnStartup();
  return server;
}
