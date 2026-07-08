import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import AdmZip from 'adm-zip';
import { config } from '../config.js';

const ENDPOINT = config.mineru.endpoint;

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.mineru.token}`,
    ...extra,
  };
}

async function asJson(res) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: res.status, body };
}

/**
 * Submit a single local PDF to MinerU via the batch file-upload endpoint.
 * Flow: POST /api/v4/file-urls/batch (1 file) -> get batch_id + signed OSS URL
 *       -> PUT upload the file -> MinerU auto-submits the parse task.
 * Returns { batchId }.
 */
export async function submitLocalPdf({ filePath, fileName, modelVersion, language, enableFormula, enableTable }) {
  const mv = modelVersion || config.mineru.modelVersion;
  const body = {
    files: [{ name: fileName }],
    model_version: mv,
    enable_formula: enableFormula ?? config.mineru.enableFormula,
    enable_table: enableTable ?? config.mineru.enableTable,
    language: language || config.mineru.language,
  };
  const res = await fetch(`${ENDPOINT}/api/v4/file-urls/batch`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const { status, body: rb } = await asJson(res);
  if (!res.ok || rb.code !== 0) {
    throw new Error(`MinerU submit failed: HTTP ${status} ${rb.msg || ''} (code ${rb.code ?? '?'})`);
  }
  const { batch_id: batchId, file_urls: urls } = rb.data;
  if (!urls || urls.length === 0) throw new Error('MinerU returned no upload url');

  // Upload the file to the signed OSS URL. No Content-Type header (per docs).
  const stat = fs.statSync(filePath);
  const src = fs.createReadStream(filePath);
  const upRes = await fetch(urls[0], {
    method: 'PUT',
    headers: { 'Content-Length': String(stat.size) },
    body: Readable.toWeb(src),
    duplex: 'half',
  });
  if (!upRes.ok) {
    const t = await upRes.text().catch(() => '');
    throw new Error(`MinerU OSS upload failed: HTTP ${upRes.status} ${t.slice(0, 200)}`);
  }
  return { batchId };
}

/**
 * Query a batch's results. Returns the extract_result array (one entry per file).
 * Each entry: { file_name, state, full_zip_url?, err_msg?, extract_progress? }
 */
export async function getBatchResult(batchId) {
  const res = await fetch(`${ENDPOINT}/api/v4/extract-results/batch/${batchId}`, {
    headers: authHeaders({ Accept: '*/*' }),
  });
  const { status, body: rb } = await asJson(res);
  if (!res.ok || rb.code !== 0) {
    throw new Error(`MinerU query failed: HTTP ${status} ${rb.msg || ''} (code ${rb.code ?? '?'})`);
  }
  return rb.data; // { batch_id, extract_result: [...] }
}

/**
 * Download the full_zip_url and extract its contents into destDir.
 * Only keeps full.md, images/, and content_list.json (best-effort).
 * Returns { fullMdPath, hasImages, contentListPath? }.
 */
export async function downloadAndExtract(zipUrl, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const tmpZip = path.join(destDir, '__tmp__.zip');
  try {
    const r = await fetch(zipUrl);
    if (!r.ok || !r.body) throw new Error(`zip download failed: HTTP ${r.status}`);
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmpZip));
    const zip = new AdmZip(tmpZip);
    zip.extractAllTo(destDir, true);

    // MinerU zip layout: a top dir like <stem>/ containing full.md, images/, etc.
    // Find full.md anywhere under destDir.
    const fullMdPath = findFile(destDir, 'full.md');
    if (!fullMdPath) throw new Error('full.md not found in MinerU zip');
    const contentListPath = findFile(destDir, 'content_list.json') || null;
    const imagesDir = findDir(destDir, 'images');
    return { fullMdPath, contentListPath, imagesDir };
  } finally {
    try { fs.unlinkSync(tmpZip); } catch { /* ignore */ }
  }
}

function findFile(root, name) {
  const entries = walk(root);
  return entries.find(p => path.basename(p) === name && fs.statSync(p).isFile()) || null;
}
function findDir(root, name) {
  const entries = walk(root);
  return entries.find(p => path.basename(p) === name && fs.statSync(p).isDirectory()) || null;
}
function* walk(dir) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    yield p;
    if (e.isDirectory()) yield* walk(p);
  }
}

/**
 * Rewrite image references in the markdown so they point at our attachment
 * serving endpoint instead of the relative `images/...` path MinerU emits.
 * `itemKey` is the parent item key used in the URL.
 *
 * Also rewrites any other asset references (e.g. videos) defensively.
 */
export function rewriteAssetPaths(fullMdPath, itemKey) {
  let md = fs.readFileSync(fullMdPath, 'utf8');
  const base = `/api/attachments/${itemKey}/fulltext`;
  // Match ![alt](images/...) and <img src="images/...">
  md = md.replace(/!\[([^\]]*)\]\((images\/[^)]+)\)/g, (_, alt, src) =>
    `![${alt}](${base}/${normalizeSrc(src)})`);
  md = md.replace(/<img([^>]+)src=["'](images\/[^"']+)["']/g, (_, attrs, src) =>
    `<img${attrs}src="${base}/${normalizeSrc(src)}"`);
  fs.writeFileSync(fullMdPath, md);
}

function normalizeSrc(src) {
  // Strip leading ./ and any URL-encoding of spaces.
  return src.replace(/^\.\//, '').replace(/ /g, '%20');
}
