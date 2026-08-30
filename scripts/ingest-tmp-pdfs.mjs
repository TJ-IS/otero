#!/usr/bin/env node
/**
 * Ingest tmp/{infoandorg,isj} manifest PDFs: create or attach, Crossref-fill
 * bibliographic fields, MinerU-parse, then extract remaining empty fields.
 *
 *   node scripts/ingest-tmp-pdfs.mjs
 *   node scripts/ingest-tmp-pdfs.mjs --phase=import
 *   node scripts/ingest-tmp-pdfs.mjs --phase=parse
 *   node scripts/ingest-tmp-pdfs.mjs --phase=validate
 *   node scripts/ingest-tmp-pdfs.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDataDirs, config } from '../src/config.js';
import { initDb, closeDb, query, execute } from '../src/db/connection.js';
import { storeFile } from '../src/services/storageService.js';
import { fetchByDoi } from '../src/services/recognizers/crossref.js';
import { mapRecognized } from '../src/services/metadataMapper.js';
import { Item } from '../src/models/Item.js';
import { Attachment } from '../src/models/Attachment.js';
import { generateKey } from '../src/utils/key.js';
import { normalizeDoi } from '../src/utils/doi.js';
import { normalizeJournalName } from '../src/services/extractService.js';
import {
  enqueueBatchParse, pollOnce, recoverSubmittingOnStartup, retryFailed,
} from '../src/services/fulltextService.js';
import { extractItem, applyExtraction } from '../src/services/extractService.js';
import { backfillFullTextIndex } from '../src/services/fulltextIndexService.js';

config.recognizers.timeoutMs = 20000;
config.recognizers.userAgent = 'Otero/0.1 (mailto:otero@example.com; literature-import)';

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err?.message || err);
});

const ROOT = config.projectRoot;
const SOURCES = [
  { src: 'I&O', dir: path.join(ROOT, 'tmp/infoandorg') },
  { src: 'ISJ', dir: path.join(ROOT, 'tmp/isj') },
];
const LOG_PATH = path.join(config.dataDir, 'ingest-tmp-log.jsonl');
const CORE_FIELDS = ['title', 'DOI', 'publicationTitle', 'date', 'abstractNote', 'volume', 'issue', 'pages'];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseArg = args.find((a) => a.startsWith('--phase='));
const PHASE = phaseArg ? phaseArg.slice('--phase='.length) : 'all';
const concurrencyIdx = args.indexOf('--concurrency');
const CONCURRENCY = concurrencyIdx >= 0
  ? Math.max(1, Number(args[concurrencyIdx + 1]) || 1)
  : 2;

function normDoi(doi) {
  const n = normalizeDoi(doi);
  return n ? n.toLowerCase() : '';
}

function doiAliases(doi) {
  const n = normDoi(doi);
  const out = new Set([n]);
  if (n.includes('/j.infoandorg.')) out.add(n.replace('/j.infoandorg.', '/i.infoandorg.'));
  if (n.includes('/i.infoandorg.')) out.add(n.replace('/i.infoandorg.', '/j.infoandorg.'));
  return [...out].filter(Boolean);
}

function cleanText(s) {
  if (!s) return '';
  return String(s)
    .replace(/<jats:title>[\s\S]*?<\/jats:title>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadManifest(dir, src) {
  const p = path.join(dir, 'manifest.tsv');
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const row = { src, dir };
    header.forEach((h, i) => { row[h] = cols[i]; });
    row.pdfPath = path.join(dir, 'pdfs', row.filename);
    return row;
  }).filter((r) => r.doi && r.filename);
}

function logJson(obj) {
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(obj)}\n`);
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function loadExistingDois() {
  const rows = await query(`
    SELECT i.key, i."itemID", lower(v.value) AS doi,
      EXISTS (
        SELECT 1 FROM "itemAttachments" a
        WHERE a."parentItemID" = i."itemID" AND a.path IS NOT NULL
      ) AS has_pdf,
      (SELECT ft.state FROM "itemFullText" ft WHERE ft."itemID" = i."itemID") AS ft_state
    FROM items i
    JOIN "itemData" d ON d."itemID" = i."itemID"
    JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" = 'DOI'
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    WHERE i."parentItemID" IS NULL AND i.deleted = 0
  `);
  const map = new Map();
  for (const r of rows) {
    const rec = {
      key: r.key,
      itemID: r.itemID,
      doi: r.doi,
      hasPdf: r.has_pdf,
      ftState: r.ft_state,
    };
    for (const alias of doiAliases(r.doi)) map.set(alias, rec);
  }
  return map;
}

function findExisting(existing, doi) {
  for (const alias of doiAliases(doi)) {
    const hit = existing.get(alias);
    if (hit) return hit;
  }
  return null;
}

async function applyMapped(item, mapped, { overwrite = false, forceDoi = null } = {}) {
  const fields = { ...mapped.fields };
  if (fields.title) fields.title = cleanText(fields.title);
  if (fields.abstractNote) fields.abstractNote = cleanText(fields.abstractNote);
  if (fields.publicationTitle) {
    fields.publicationTitle = normalizeJournalName(fields.publicationTitle) || cleanText(fields.publicationTitle);
  }
  if (forceDoi) fields.DOI = forceDoi;

  if (mapped.itemType && mapped.itemType !== item.itemType) {
    try { await item.setItemType(mapped.itemType); } catch { /* keep */ }
  }

  const applied = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    const cur = item.getField(name);
    const dirty = typeof cur === 'string' && /<[^>]+>/.test(cur);
    const should = overwrite || !cur || dirty || (name === 'DOI' && normDoi(cur) !== normDoi(value));
    if (!should) continue;
    try {
      item.setField(name, value);
      applied.push(name);
    } catch { /* skip unknown */ }
  }
  if ((overwrite || item.creators.length === 0) && mapped.creators?.length) {
    item.setCreators(mapped.creators);
    applied.push('creators');
  }
  if (applied.length) await item.save();
  return applied;
}

async function attachPdf(parent, filePath) {
  const fileKey = generateKey();
  const stored = await storeFile(filePath, fileKey, { ext: 'pdf' });
  const attachment = new Attachment({
    linkMode: 0,
    contentType: 'application/pdf',
    path: stored.path,
    md5: stored.md5,
    mtime: stored.mtime,
  });
  await attachment.save();
  await execute('UPDATE items SET "parentItemID"=$1 WHERE "itemID"=$2', [parent.id, attachment.id]);
  await execute('UPDATE "itemAttachments" SET "parentItemID"=$1 WHERE "itemID"=$2', [parent.id, attachment.id]);
  return attachment;
}

async function createFromCrossref(doi, filePath) {
  const recognized = await fetchByDoi(doi);
  if (!recognized) throw new Error(`CrossRef miss: ${doi}`);
  const mapped = mapRecognized(recognized);
  mapped.fields.DOI = mapped.fields.DOI || doi;
  if (mapped.fields.title) mapped.fields.title = cleanText(mapped.fields.title);
  if (mapped.fields.abstractNote) mapped.fields.abstractNote = cleanText(mapped.fields.abstractNote);
  if (mapped.fields.publicationTitle) {
    mapped.fields.publicationTitle =
      normalizeJournalName(mapped.fields.publicationTitle) || cleanText(mapped.fields.publicationTitle);
  }

  const parent = new Item();
  await parent.setItemType(mapped.itemType || 'journalArticle');
  for (const [name, value] of Object.entries(mapped.fields)) {
    if (value == null || value === '') continue;
    try { parent.setField(name, value); } catch { /* skip */ }
  }
  for (const c of mapped.creators || []) parent.addCreator(c);
  await parent.save();
  await attachPdf(parent, filePath);
  return { parent, mapped };
}

async function importOne(row, existing) {
  const doi = row.doi;
  const hit = findExisting(existing, doi);
  if (hit) {
    const item = await Item.loadByKey(hit.key);
    if (!item) throw new Error(`stale key ${hit.key}`);
    const dbDoi = item.getField('DOI') || '';
    const doiFixed = normDoi(dbDoi) !== normDoi(doi);
    if (doiFixed && !DRY_RUN) {
      item.setField('DOI', doi);
      await item.save();
    }
    let attached = false;
    if (!hit.hasPdf) {
      if (!DRY_RUN) await attachPdf(item, row.pdfPath);
      hit.hasPdf = true;
      attached = true;
    }
    for (const alias of doiAliases(doi)) existing.set(alias, { ...hit, key: item.key });
    return {
      action: (attached || doiFixed) ? 'updated' : 'exists',
      key: item.key,
      doi,
      title: item.getField('title') || row.title || '',
    };
  }

  if (DRY_RUN) {
    return { action: 'would-create', key: null, doi, title: row.title || '' };
  }

  const { parent } = await createFromCrossref(doi, row.pdfPath);
  const rec = { key: parent.key, itemID: parent.id, doi: normDoi(doi), hasPdf: true, ftState: null };
  for (const alias of doiAliases(doi)) existing.set(alias, rec);
  return {
    action: 'created',
    key: parent.key,
    doi: parent.getField('DOI') || doi,
    title: parent.getField('title') || row.title || '',
  };
}

async function importPhase(rows, existing) {
  console.log(`\n=== import (${rows.length} PDFs, concurrency=${CONCURRENCY}${DRY_RUN ? ', dry-run' : ''}) ===`);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let fail = 0;
  const keys = [];

  await mapPool(rows, CONCURRENCY, async (row, idx) => {
    const label = `[${idx + 1}/${rows.length}] ${row.src} ${row.filename}`;
    try {
      if (!fs.existsSync(row.pdfPath)) throw new Error('PDF missing on disk');
      const r = await importOne(row, existing);
      logJson({ phase: 'import', ...r, file: row.filename, src: row.src });
      if (r.action === 'created' || r.action === 'would-create') created++;
      else if (r.action === 'updated') updated++;
      else skipped++;
      if (r.key) keys.push(r.key);
      console.log(`${r.action.toUpperCase().padEnd(8)} ${label} → ${r.key || '-'}  ${(r.title || '').slice(0, 70)}`);
      return r;
    } catch (err) {
      fail++;
      logJson({ phase: 'import', ok: false, doi: row.doi, file: row.filename, error: err.message });
      console.error(`ERR      ${label}: ${err.message}`);
      return { action: 'error', error: err.message };
    }
  });

  console.log(`import done: created=${created} updated=${updated} skipped=${skipped} fail=${fail}`);
  return { created, updated, skipped, fail, keys };
}

async function listKeysNeedingParse(keys) {
  if (!keys.length) return [];
  const rows = await query(`
    SELECT i.key, ft.state
    FROM items i
    LEFT JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
    WHERE i.key = ANY($1)
  `, [keys]);
  return rows.filter((r) => r.state !== 'done').map((r) => r.key);
}

async function parsePhase(keys) {
  const todo = await listKeysNeedingParse(keys);
  console.log(`\n=== parse MinerU (${todo.length}/${keys.length} need parse) ===`);
  if (DRY_RUN) {
    console.log(`would enqueue ${todo.length} keys`);
    return { queued: todo.length };
  }
  if (!config.mineru.tokens.length) throw new Error('OTERO_MINERU_TOKEN is not set');
  if (todo.length === 0) return { queued: 0 };

  await recoverSubmittingOnStartup();
  const summary = await enqueueBatchParse(todo);
  console.log('enqueue', summary);

  const start = Date.now();
  let last = '';
  while (true) {
    const tick = await pollOnce();
    const states = await query(`
      SELECT COALESCE(ft.state, 'idle') AS state, COUNT(*)::int AS n
      FROM items i
      LEFT JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
      WHERE i.key = ANY($1)
      GROUP BY 1
      ORDER BY 1
    `, [keys]);
    const map = Object.fromEntries(states.map((r) => [r.state, r.n]));
    const inFlight = (map.submitting || 0) + (map.pending || 0) + (map.running || 0) + (map.converting || 0);
    const line = `parse ${((Date.now() - start) / 1000).toFixed(0)}s tick=${JSON.stringify(tick)} states=${JSON.stringify(map)}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (inFlight === 0 && (map.submitting || 0) === 0) break;
    await new Promise((r) => setTimeout(r, Math.max(4000, config.mineru.pollIntervalMs)));
  }

  const failed = await query(`
    SELECT i.key FROM items i
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
    WHERE i.key = ANY($1) AND ft.state = 'failed'
  `, [keys]);
  if (failed.length) {
    console.log(`retrying ${failed.length} failed parse(s)`);
    await retryFailed();
    await new Promise((r) => setTimeout(r, 8000));
    for (let i = 0; i < 40; i++) {
      await pollOnce();
      const still = await query(`
        SELECT COUNT(*)::int AS n FROM items i
        JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
        WHERE i.key = ANY($1) AND ft.state IN ('submitting','pending','running','converting')
      `, [keys]);
      if ((still[0]?.n || 0) === 0) break;
      await new Promise((r) => setTimeout(r, Math.max(4000, config.mineru.pollIntervalMs)));
    }
  }

  const final = await query(`
    SELECT COALESCE(ft.state, 'idle') AS state, COUNT(*)::int AS n
    FROM items i
    LEFT JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
    WHERE i.key = ANY($1)
    GROUP BY 1
  `, [keys]);
  console.log('parse final', Object.fromEntries(final.map((r) => [r.state, r.n])));
  return { queued: summary.queued, states: final };
}

function missingFields(item) {
  const miss = [];
  for (const f of CORE_FIELDS) {
    if (!item.getField(f)) miss.push(f);
  }
  if (!item.creators.length) miss.push('creators');
  return miss;
}

async function validateOne(key) {
  const item = await Item.loadByKey(key);
  if (!item) return { key, error: 'not found' };
  const doi = item.getField('DOI');
  let applied = [];
  let extracted = [];
  if (doi) {
    const recognized = await fetchByDoi(doi);
    if (recognized) {
      const mapped = mapRecognized(recognized);
      applied = await applyMapped(item, mapped, { overwrite: false, forceDoi: doi });
    }
  }
  const after = await Item.loadByKey(key);
  let miss = missingFields(after);
  const needExtract = miss.includes('abstractNote') || miss.includes('creators') || miss.includes('volume');
  if (needExtract && !DRY_RUN) {
    const ft = await query(`
      SELECT ft.state FROM "itemFullText" ft
      JOIN items i ON i."itemID" = ft."itemID"
      WHERE i.key = $1
    `, [key]);
    if (ft[0]?.state === 'done' && config.llm.apiKey) {
      try {
        const result = await extractItem(key);
        const appliedEx = await applyExtraction(key, result, { fieldThreshold: 0.8, overwrite: false });
        extracted = (appliedEx.appliedFields || []).map((f) => f.field);
        if (appliedEx.appliedCreators) extracted.push('creators');
      } catch (err) {
        return { key, doi, applied, extracted, miss, extractError: err.message };
      }
    }
  }
  const final = await Item.loadByKey(key);
  miss = missingFields(final);
  return { key, doi, applied, extracted, miss, title: final.getField('title') || '' };
}

async function collectValidateKeys(importedKeys) {
  const extra = await query(`
    SELECT i.key
    FROM items i
    JOIN "itemData" dj ON dj."itemID" = i."itemID"
    JOIN fields fj ON fj."fieldID" = dj."fieldID" AND fj."fieldName" = 'publicationTitle'
    JOIN "itemDataValues" j ON j."valueID" = dj."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND j.value IN ('Information and Organization', 'Information Systems Journal')
      AND (
        NOT EXISTS (
          SELECT 1 FROM "itemData" d JOIN fields f ON f."fieldID"=d."fieldID" AND f."fieldName"='abstractNote'
          JOIN "itemDataValues" v ON v."valueID"=d."valueID"
          WHERE d."itemID"=i."itemID" AND btrim(v.value) <> ''
        )
        OR NOT EXISTS (SELECT 1 FROM "itemCreators" c WHERE c."itemID"=i."itemID")
        OR EXISTS (
          SELECT 1 FROM "itemData" d JOIN fields f ON f."fieldID"=d."fieldID" AND f."fieldName"='DOI'
          JOIN "itemDataValues" v ON v."valueID"=d."valueID"
          WHERE d."itemID"=i."itemID" AND lower(v.value) LIKE '%/i.infoandorg.%'
        )
      )
  `);
  return [...new Set([...importedKeys, ...extra.map((r) => r.key)])];
}

async function validatePhase(importedKeys) {
  const keys = await collectValidateKeys(importedKeys);
  console.log(`\n=== validate fields (${keys.length} items) ===`);
  let filled = 0;
  let still = 0;
  const remain = [];
  await mapPool(keys, 3, async (key, idx) => {
    try {
      const r = await validateOne(key);
      logJson({ phase: 'validate', ...r });
      if ((r.applied?.length || r.extracted?.length) && !DRY_RUN) filled++;
      if (r.miss?.length) {
        still++;
        remain.push(r);
      }
      if ((idx + 1) % 20 === 0 || idx === keys.length - 1) {
        console.log(`  validate ${idx + 1}/${keys.length} filled=${filled} stillMissing=${still}`);
      }
      return r;
    } catch (err) {
      logJson({ phase: 'validate', key, error: err.message });
      console.error(`validate ERR ${key}: ${err.message}`);
      return { key, error: err.message };
    }
  });
  if (remain.length) {
    console.log(`still missing fields (${remain.length}):`);
    for (const r of remain.slice(0, 30)) {
      console.log(`  ${r.key}  ${(r.miss || []).join(',')}  ${(r.title || '').slice(0, 60)}`);
    }
    if (remain.length > 30) console.log(`  ... ${remain.length - 30} more`);
  }
  return { keys: keys.length, filled, stillMissing: still };
}

async function indexPhase() {
  console.log('\n=== index fulltext ===');
  if (DRY_RUN) return { ok: 0 };
  const res = await backfillFullTextIndex({ concurrency: 4 });
  console.log(`indexed: ok=${res.ok} fail=${res.fail} total=${res.total}`);
  return res;
}

async function keysFromManifest(rows, existing) {
  const keys = [];
  for (const row of rows) {
    const hit = findExisting(existing, row.doi);
    if (hit) keys.push(hit.key);
  }
  return keys;
}

async function main() {
  ensureDataDirs();
  await initDb();
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `\n# run ${new Date().toISOString()} phase=${PHASE} dry=${DRY_RUN}\n`);

  const rows = SOURCES.flatMap((s) => {
    if (!fs.existsSync(path.join(s.dir, 'manifest.tsv'))) {
      console.warn(`skip missing manifest: ${s.dir}`);
      return [];
    }
    return loadManifest(s.dir, s.src);
  });
  const existing = await loadExistingDois();
  console.log(`DB: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Storage: ${config.storage.type}  MinerU: ${config.mineru.tokens.length ? `${config.mineru.tokens.length} token(s)` : 'NO'}  LLM: ${config.llm.apiKey ? 'yes' : 'NO'}`);
  console.log(`Manifest PDFs: ${rows.length}`);

  let importedKeys = [];
  if (PHASE === 'all' || PHASE === 'import') {
    const r = await importPhase(rows, existing);
    importedKeys = r.keys;
  } else {
    importedKeys = await keysFromManifest(rows, existing);
  }

  if (PHASE === 'all' || PHASE === 'parse') {
    await parsePhase(importedKeys);
  }

  if (PHASE === 'all' || PHASE === 'validate') {
    await validatePhase(importedKeys);
    await indexPhase();
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
  try { await closeDb(); } catch { /* ignore */ }
});
