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

/** Prefer the first defined env key (supports renamed vars + legacy aliases). */
function envFirst(...keys) {
  for (const key of keys) {
    const val = process.env[key];
    if (val !== undefined && val !== '') return val;
  }
  return undefined;
}

function normalizeStorageType(type) {
  if (type === 'minio') return 's3'; // legacy alias
  return type;
}

export const config = {
  projectRoot,
  dataDir: path.join(projectRoot, 'data'),
  /** PostgreSQL connection string (required). */
  databaseUrl: process.env.DATABASE_URL || '',
  /**
   * Absolute public site origin for canonical URLs, sitemap, OG, and llms.txt.
   * Override locally with PUBLIC_BASE_URL.
   */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'https://ais-basket.xyz').replace(/\/$/, ''),
  /**
   * Default Open Graph image path or absolute URL. Relative paths are resolved
   * against publicBaseUrl.
   */
  publicOgImage: (process.env.PUBLIC_OG_IMAGE || '/og.png').trim(),
  /** Optional Google Search Console HTML-tag verification token. */
  googleSiteVerification: (process.env.GOOGLE_SITE_VERIFICATION || '').trim(),
  /**
   * When true, 301 any Host that is not publicBaseUrl's host to the canonical
   * origin. Off by default so local/dev and in-container probes keep working.
   */
  enforceCanonicalHost: /^(1|true|yes)$/i.test(process.env.OTERO_ENFORCE_CANONICAL_HOST || ''),
  storageDir: path.join(projectRoot, 'data', 'storage'),
  schemaVersion: 6,
  storage: {
    // 'filesystem' keeps PDFs on disk; 's3' uses any S3-compatible API
    // (Cloudflare R2, AWS S3, local MinIO, …). Legacy value 'minio' maps to 's3'.
    type: normalizeStorageType(process.env.STORAGE_TYPE || 'filesystem'),
    s3: {
      endpoint: envFirst('S3_ENDPOINT', 'MINIO_ENDPOINT') || '127.0.0.1',
      port: Number(envFirst('S3_PORT', 'MINIO_PORT') ?? 9000),
      useSSL: envFirst('S3_USE_SSL', 'MINIO_USE_SSL') === 'true',
      accessKey: envFirst('S3_ACCESS_KEY', 'MINIO_ACCESS_KEY') || 'otero',
      secretKey: envFirst('S3_SECRET_KEY', 'MINIO_SECRET_KEY') || 'otero-secret-change-me',
      bucket: envFirst('S3_BUCKET', 'MINIO_BUCKET') || 'otero-pdfs',
      // R2 requires "auto". Other S3 APIs accept it too.
      region: envFirst('S3_REGION', 'MINIO_REGION') || 'auto',
      // Hosted buckets are created in the dashboard — default off for safety.
      // Set S3_CREATE_BUCKET=true only for local bootstrap.
      createBucket: envFirst('S3_CREATE_BUCKET', 'MINIO_CREATE_BUCKET') === 'true',
    },
  },
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
  chat: {
    // Full-text markdown is truncated to this many chars before being folded
    // into the chat system prompt (kept separate from maxMarkdownChars since
    // chat needs room for conversation turns on top of the context).
    maxMarkdownChars: Number(process.env.OTERO_CHAT_MAX_CHARS ?? 12000),
    timeoutMs: Number(process.env.OTERO_CHAT_TIMEOUT_MS ?? 120000),
    // Caps how many prior turns (user+assistant messages) the client may
    // replay back to the server per request, to bound token usage.
    maxHistoryMessages: Number(process.env.OTERO_CHAT_MAX_HISTORY ?? 20),
  },
  auth: {
    secret: process.env.OTERO_AUTH_SECRET || 'dev-insecure-secret',
    pdfSigningSecret: process.env.OTERO_PDF_SIGNING_SECRET || '',
    editorWhitelist: (process.env.OTERO_EDITOR_WHITELIST || '')
      .split(',')
      .map(a => a.trim().toLowerCase())
      .filter(Boolean),
    jwtTtlSec: Number(process.env.OTERO_AUTH_JWT_TTL_SEC ?? 60 * 60 * 24 * 7),
    nonceTtlSec: Number(process.env.OTERO_AUTH_NONCE_TTL_SEC ?? 300),
    pdfUrlTtlSec: Number(process.env.OTERO_PDF_URL_TTL_SEC ?? 600),
  },
};

export function ensureDataDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.storageDir, { recursive: true });
}
