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

  app.use('/api/items', itemsRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/journals', journalsRouter);
  app.use('/api/import', importRouter);
  app.use('/api/attachments', attachmentsRouter);

  // In production, serve the built Vite frontend if present.
  if (fs.existsSync(WEB_DIST)) {
    app.use(express.static(WEB_DIST));
    // SPA fallback: non-/api, non-/health routes go to index.html
    app.get(/^\/(?!api|health).*/, (req, res, next) => {
      const indexFile = path.join(WEB_DIST, 'index.html');
      if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
      next();
    });
  }

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
  return server;
}
