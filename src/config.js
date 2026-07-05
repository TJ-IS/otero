import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

export const config = {
  projectRoot,
  dataDir: path.join(projectRoot, 'data'),
  dbPath: path.join(projectRoot, 'data', 'otero.db'),
  storageDir: path.join(projectRoot, 'data', 'storage'),
  schemaVersion: 1,
  api: {
    port: Number(process.env.OTERO_PORT ?? 3000),
    host: process.env.OTERO_HOST ?? '127.0.0.1',
  },
  recognizers: {
    crossref: 'https://api.crossref.org/works/',
    arxiv: 'http://export.arxiv.org/api/query',
    openlibrary: 'https://openlibrary.org/api/books',
    userAgent: 'Otero/0.1 (https://example.com/otero; mailto:otero@example.com)',
    timeoutMs: 15000,
  },
};

import fs from 'node:fs';

export function ensureDataDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
}
