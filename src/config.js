import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Minimal .env loader: parses <projectRoot>/.env if present so commands run
// without `node --env-file`. Only sets keys not already present in process.env.
function loadDotEnv() {
  const envPath = path.join(projectRoot, '.env');
  let txt;
  try { txt = fs.readFileSync(envPath, 'utf8'); } catch { return; }
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

export const config = {
  projectRoot,
  dataDir: path.join(projectRoot, 'data'),
  dbPath: path.join(projectRoot, 'data', 'otero.db'),
  storageDir: path.join(projectRoot, 'data', 'storage'),
  schemaVersion: 2,
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
  mineru: {
    endpoint: 'https://mineru.net',
    token: process.env.OTERO_MINERU_TOKEN || '',
    modelVersion: process.env.OTERO_MINERU_MODEL || 'vlm',
    pollIntervalMs: Number(process.env.OTERO_MINERU_POLL_MS ?? 15000),
    maxConcurrent: Number(process.env.OTERO_MINERU_MAX_CONCURRENT ?? 3),
    enableFormula: process.env.OTERO_MINERU_FORMULA !== 'false',
    enableTable: process.env.OTERO_MINERU_TABLE !== 'false',
    language: process.env.OTERO_MINERU_LANGUAGE || 'ch',
    // Submit queue throttling & 429 backoff.
    submitConcurrency: Number(process.env.OTERO_MINERU_SUBMIT_CONCURRENCY ?? 2),
    submitIntervalMs: Number(process.env.OTERO_MINERU_SUBMIT_INTERVAL_MS ?? 800),
    submitMaxRetries: Number(process.env.OTERO_MINERU_SUBMIT_MAX_RETRIES ?? 5),
    submitRetryBaseMs: Number(process.env.OTERO_MINERU_SUBMIT_RETRY_BASE_MS ?? 2000),
    submitRetryMaxMs: Number(process.env.OTERO_MINERU_SUBMIT_RETRY_MAX_MS ?? 60000),
    // How many files to pack into one /file-urls/batch request (max 200).
    batchSize: Number(process.env.OTERO_MINERU_BATCH_SIZE ?? 200),
  },
  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
    model: process.env.OPENAI_MODEL || 'deepseek-v4-flash',
    timeoutMs: Number(process.env.OTERO_LLM_TIMEOUT_MS ?? 90000),
    maxMarkdownChars: Number(process.env.OTERO_LLM_MAX_CHARS ?? 16000),
  },
};

export function ensureDataDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
}
