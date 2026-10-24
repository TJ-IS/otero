#!/usr/bin/env node
/**
 * Ingest tmp/manifest.tsv PDFs: create or attach, Crossref-fill bibliographic
 * fields, MinerU-parse, then extract remaining empty fields.
 *
 *   node scripts/ingest-tmp-pdfs.mjs
 *   node scripts/ingest-tmp-pdfs.mjs --phase=import
 *   node scripts/ingest-tmp-pdfs.mjs --phase=enqueue
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
import { JOURNAL_WHITELIST } from '../src/services/journalWhitelist.js';
import { importPdf } from '../src/services/importService.js';
import {
  enqueueBatchParse,
  pollOnce,
  recoverSubmittingOnStartup,
  retryFailed,
  waitForSubmitQueue,
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
const SOURCES = [{ src: 'batch', dir: path.join(ROOT, 'tmp') }];
const JOURNAL_CODE_NAME = {
  IO: 'Information and Organization',
  'I&O': 'Information and Organization',
  ISJ: 'Information Systems Journal',
  JMIS: 'Journal of Management Information Systems',
  JIT: 'Journal of Information Technology',
  DSS: 'Decision Support Systems',
  EJIS: 'European Journal of Information Systems',
  JAIS: 'Journal of the Association for Information Systems',
};
const LOG_PATH = path.join(config.dataDir, 'ingest-tmp-log.jsonl');
const CORE_FIELDS = [
  'title',
  'DOI',
  'publicationTitle',
  'date',
  'abstractNote',
  'volume',
  'issue',
  'pages',
];

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseArg = args.find((a) => a.startsWith('--phase='));
const PHASE = phaseArg ? phaseArg.slice('--phase='.length) : 'all';
const concurrencyIdx = args.indexOf('--concurrency');
const CONCURRENCY = concurrencyIdx >= 0 ? Math.max(1, Number(args[concurrencyIdx + 1]) || 1) : 2;

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

function stemName(filename) {
  return String(filename || '').replace(/\.pdf$/i, '');
}

function titleFromFilename(filename) {
  const stem = stemName(filename);
  const parts = stem.split('_').filter(Boolean);
  const skip = new Set(['jais', 'jit', 'isj', 'dss', 'ejis', 'jmis', 'io']);
  const words = [];
  for (const part of parts) {
    if (/^\d{4}$/.test(part)) continue;
    if (/^\d/.test(part) && part.includes('.')) continue;
    if (/^10[.-]/.test(part)) continue;
    if (skip.has(part.toLowerCase())) continue;
    if (/jais-\d+/i.test(part)) continue;
    words.push(part.replace(/-/g, ' '));
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/** Infer one or more CrossRef DOI candidates from the batch filename. */
function doiFromFilename(journal, filename) {
  const fn = stemName(filename);
  const code = String(journal || '').toUpperCase();
  const out = [];
  const add = (doi) => {
    const n = normalizeDoi(doi);
    if (n) out.push(n);
  };

  const jaisFull = fn.match(/10\.17705[_/]1jais[._](\d+)/i);
  if (jaisFull) add(`10.17705/1jais.${jaisFull[1]}`);
  const jaisDash = fn.match(/10-17[70]05-1jais-(\d+)/i);
  if (jaisDash) add(`10.17705/1jais.${jaisDash[1]}`);
  const jaisShort = fn.match(/(?:^|_)jais-(\d{5})(?:_|$)/i);
  if (jaisShort) add(`10.17705/1jais.${jaisShort[1]}`);

  if (/^10\.\d{4,}_/.test(fn) || fn.startsWith('10.')) {
    add(fn.replace(/_/g, '/'));
  }

  const io = fn.match(/^\d{4}_infoandorg\.([^_]+)/i);
  if (io) add(`10.1016/j.infoandorg.${io[1]}`);

  const isjNew = fn.match(/^\d{4}_isj\.(\d+)/i);
  if (isjNew) add(`10.1111/isj.${isjNew[1]}`);
  const isjWiley = fn.match(/^\d{4}_(j\.1365-2575\.[^_]+)/i);
  if (isjWiley) add(`10.1111/${isjWiley[1]}`);
  const isj1046 = fn.match(/^\d{4}_(1365-2575\.[^_]+)/i);
  if (isj1046) add(`10.1046/j.${isj1046[1]}`);

  const dssArt = fn.match(/^(\d{4})_dss\.(\d{6})(?:_|$)/i);
  if (dssArt) {
    add(`10.1016/j.dss.${dssArt[1]}.${dssArt[2]}`);
    const prevYear = String(Number(dssArt[1]) - 1);
    if (/^\d{4}$/.test(prevYear)) add(`10.1016/j.dss.${prevYear}.${dssArt[2]}`);
    add(`10.1016/j.dss.${dssArt[2]}`);
  }
  const dssYm = fn.match(/^(\d{4})_dss\.(\d{2})\.(\d{3})(?:_|$)/i);
  if (dssYm) {
    add(`10.1016/j.dss.${dssYm[1]}.${dssYm[2]}.${dssYm[3]}`);
    const prevYear = String(Number(dssYm[1]) - 1);
    if (/^\d{4}$/.test(prevYear)) add(`10.1016/j.dss.${prevYear}.${dssYm[2]}.${dssYm[3]}`);
  }
  const dssIssn = fn.match(/dss\.0167-9236\.(\d{2})\.(\d+)-(\d+)/i);
  if (dssIssn) add(`10.1016/0167-9236(${dssIssn[1]})${dssIssn[2]}-${dssIssn[3]}`);

  const jmisTf = fn.match(/^\d{4}_07421222\.(\d{4})\.(\d+)/);
  if (jmisTf) add(`10.1080/07421222.${jmisTf[1]}.${jmisTf[2]}`);
  const jmisOld = fn.match(/mis0742-1222(\d+)/i);
  if (jmisOld) {
    let rest = jmisOld[1];
    if (rest.length === 5) rest = `${rest.slice(0, 2)}0${rest.slice(2)}`;
    add(`10.2753/MIS0742-1222${rest}`);
  }

  const jit = fn.match(/^(02683962\d+)(?:_jit)?$/i);
  if (jit) add(`10.1177/${jit[1]}`);

  if (fn.includes('palgrave.ejis')) add(fn.replace(/_/g, '/'));

  if (code === 'JAIS' && !out.length) {
    const n = fn.match(/(\d{5})/);
    if (n && n[1].startsWith('00')) add(`10.17705/1jais.${n[1]}`);
  }

  return [...new Set(out)];
}

function loadLegacyDoiMap() {
  const map = new Map();
  for (const rel of ['tmp/infoandorg/manifest.tsv', 'tmp/isj/manifest.tsv']) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    const header = lines[0].split('\t');
    const di = header.indexOf('doi');
    const fi = header.indexOf('filename');
    if (di < 0 || fi < 0) continue;
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      const doi = normalizeDoi(cols[di]);
      if (cols[fi] && doi) map.set(cols[fi], doi);
    }
  }
  return map;
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
  const candidates = [path.join(dir, 'manifest.tsv'), path.join(dir, 'archives', 'manifest.tsv')];
  const p = candidates.find((f) => fs.existsSync(f));
  if (!p) throw new Error(`manifest.tsv not found under ${dir}`);
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split('\t');
  const legacy = loadLegacyDoiMap();
  const pdfDir = fs.existsSync(path.join(dir, 'pdfs'))
    ? path.join(dir, 'pdfs')
    : path.join(dir, 'pdfs');
  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split('\t');
      const row = { src, dir };
      header.forEach((h, i) => {
        row[h] = cols[i];
      });
      const journal = row.journal || src;
      row.src = journal;
      row.journalName =
        JOURNAL_CODE_NAME[String(journal).toUpperCase()] || JOURNAL_CODE_NAME[journal] || '';
      const inferred = doiFromFilename(journal, row.filename);
      const listed = normalizeDoi(row.doi);
      const shortDss = listed && /^10\.1016\/j\.dss\.\d{6}$/i.test(listed);
      const yearDss = inferred.find((d) => /^10\.1016\/j\.dss\.\d{4}\.\d{6}$/i.test(d));
      row.doi =
        (shortDss && yearDss ? yearDss : listed) || legacy.get(row.filename) || inferred[0] || '';
      row.doiCandidates = [
        ...new Set([row.doi, listed, legacy.get(row.filename), ...inferred].filter(Boolean)),
      ];
      row.title = row.title || titleFromFilename(row.filename);
      row.pdfPath = path.join(pdfDir, row.filename);
      return row;
    })
    .filter((r) => r.filename);
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
    fields.publicationTitle =
      normalizeJournalName(fields.publicationTitle) || cleanText(fields.publicationTitle);
  }
  if (forceDoi) fields.DOI = forceDoi;

  if (mapped.itemType && mapped.itemType !== item.itemType) {
    try {
      await item.setItemType(mapped.itemType);
    } catch {
      /* keep */
    }
  }

  const applied = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value == null || value === '') continue;
    const cur = item.getField(name);
    const dirty = typeof cur === 'string' && /<[^>]+>/.test(cur);
    const should =
      overwrite || !cur || dirty || (name === 'DOI' && normDoi(cur) !== normDoi(value));
    if (!should) continue;
    try {
      item.setField(name, value);
      applied.push(name);
    } catch {
      /* skip unknown */
    }
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
  await execute('UPDATE "itemAttachments" SET "parentItemID"=$1 WHERE "itemID"=$2', [
    parent.id,
    attachment.id,
  ]);
  return attachment;
}

async function fetchByQuery(q) {
  if (!q) return null;
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=5`;
  const res = await fetch(url, {
    headers: { 'User-Agent': config.recognizers.userAgent },
    signal: AbortSignal.timeout(config.recognizers.timeoutMs),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const items = json?.message?.items || [];
  for (const msg of items) {
    const pub = msg['container-title']?.[0] || '';
    if (normalizeJournalName(pub)) return { source: 'crossref', raw: msg };
  }
  return items[0] ? { source: 'crossref', raw: items[0] } : null;
}

function applyJournalHint(mapped, journalName) {
  if (!journalName) return mapped;
  const cur = mapped.fields.publicationTitle;
  const canon = normalizeJournalName(cur) || journalName;
  mapped.fields.publicationTitle = canon;
  return mapped;
}

async function createFromMapped(mapped, filePath, { forceDoi, journalName } = {}) {
  applyJournalHint(mapped, journalName);
  mapped.fields.DOI = forceDoi || mapped.fields.DOI;
  if (mapped.fields.title) mapped.fields.title = cleanText(mapped.fields.title);
  if (mapped.fields.abstractNote)
    mapped.fields.abstractNote = cleanText(mapped.fields.abstractNote);
  if (mapped.fields.publicationTitle) {
    mapped.fields.publicationTitle =
      normalizeJournalName(mapped.fields.publicationTitle) ||
      cleanText(mapped.fields.publicationTitle);
  }

  const parent = new Item();
  await parent.setItemType(mapped.itemType || 'journalArticle');
  for (const [name, value] of Object.entries(mapped.fields)) {
    if (value == null || value === '') continue;
    try {
      parent.setField(name, value);
    } catch {
      /* skip */
    }
  }
  for (const c of mapped.creators || []) parent.addCreator(c);
  await parent.save();
  await attachPdf(parent, filePath);
  return { parent, mapped };
}

async function createFromPdfFallback(row) {
  const result = await importPdf(row.pdfPath);
  const parent = result.parent;
  if (!parent) throw new Error(`PDF recognize produced no parent: ${row.filename}`);
  const hinted = row.journalName;
  if (hinted && !normalizeJournalName(parent.getField('publicationTitle'))) {
    parent.setField('publicationTitle', hinted);
  }
  if (row.doi && !parent.getField('DOI')) parent.setField('DOI', row.doi);
  await parent.save();
  return { parent };
}

async function importOne(row, existing) {
  const candidates = (row.doiCandidates?.length ? row.doiCandidates : [row.doi]).filter(Boolean);
  let hit = null;
  let doi = row.doi || '';
  for (const cand of candidates.length ? candidates : ['']) {
    const found = cand ? findExisting(existing, cand) : null;
    if (found) {
      hit = found;
      doi = cand;
      break;
    }
  }
  async function reuseExisting(found, resolvedDoi) {
    const item = await Item.loadByKey(found.key);
    if (!item) throw new Error(`stale key ${found.key}`);
    const dbDoi = item.getField('DOI') || '';
    const nextDoi = resolvedDoi || doi;
    const doiFixed = nextDoi && normDoi(dbDoi) !== normDoi(nextDoi);
    if (doiFixed && !DRY_RUN) {
      item.setField('DOI', nextDoi);
      await item.save();
    }
    if (row.journalName && !normalizeJournalName(item.getField('publicationTitle')) && !DRY_RUN) {
      item.setField('publicationTitle', row.journalName);
      await item.save();
    }
    let attached = false;
    if (!found.hasPdf) {
      if (!DRY_RUN) await attachPdf(item, row.pdfPath);
      found.hasPdf = true;
      attached = true;
    }
    for (const alias of doiAliases(nextDoi || item.getField('DOI'))) {
      existing.set(alias, { ...found, key: item.key });
    }
    return {
      action: attached || doiFixed ? 'updated' : 'exists',
      key: item.key,
      doi: item.getField('DOI') || nextDoi,
      title: item.getField('title') || row.title || '',
    };
  }

  if (hit) return reuseExisting(hit, doi);

  if (DRY_RUN) {
    return { action: 'would-create', key: null, doi, title: row.title || '' };
  }

  let parent = null;
  let lastErr = null;
  for (const cand of candidates) {
    try {
      const recognized = await fetchByDoi(cand);
      if (!recognized) throw new Error(`CrossRef miss: ${cand}`);
      const mapped = mapRecognized(recognized);
      const resolved = mapped.fields.DOI || cand;
      const exist = findExisting(existing, resolved);
      if (exist) return reuseExisting(exist, resolved);
      ({ parent } = await createFromMapped(mapped, row.pdfPath, {
        forceDoi: resolved,
        journalName: row.journalName,
      }));
      doi = resolved;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!parent && row.title) {
    const recognized = await fetchByQuery(`${row.title} ${row.journalName || ''}`.trim());
    if (recognized) {
      const mapped = mapRecognized(recognized);
      const resolved = mapped.fields.DOI || doi;
      const exist = resolved ? findExisting(existing, resolved) : null;
      if (exist) return reuseExisting(exist, resolved);
      ({ parent } = await createFromMapped(mapped, row.pdfPath, {
        forceDoi: resolved,
        journalName: row.journalName,
      }));
      doi = parent.getField('DOI') || doi;
    }
  }
  if (!parent) {
    try {
      ({ parent } = await createFromPdfFallback(row));
      doi = parent.getField('DOI') || doi;
    } catch (err) {
      throw lastErr || err;
    }
  }

  const rec = {
    key: parent.key,
    itemID: parent.id,
    doi: normDoi(doi),
    hasPdf: true,
    ftState: null,
  };
  for (const alias of doiAliases(doi || parent.getField('DOI'))) existing.set(alias, rec);
  return {
    action: 'created',
    key: parent.key,
    doi: parent.getField('DOI') || doi,
    title: parent.getField('title') || row.title || '',
  };
}

async function importPhase(rows, existing) {
  console.log(
    `\n=== import (${rows.length} PDFs, concurrency=${CONCURRENCY}${DRY_RUN ? ', dry-run' : ''}) ===`,
  );
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
      console.log(
        `${r.action.toUpperCase().padEnd(8)} ${label} → ${r.key || '-'}  ${(r.title || '').slice(0, 70)}`,
      );
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
  const rows = await query(
    `
    SELECT i.key, ft.state
    FROM items i
    LEFT JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
    WHERE i.key = ANY($1)
  `,
    [keys],
  );
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
    const states = await query(
      `
      SELECT COALESCE(ft.state, 'idle') AS state, COUNT(*)::int AS n
      FROM items i
      LEFT JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
      WHERE i.key = ANY($1)
      GROUP BY 1
      ORDER BY 1
    `,
      [keys],
    );
    const map = Object.fromEntries(states.map((r) => [r.state, r.n]));
    const inFlight =
      (map.submitting || 0) + (map.pending || 0) + (map.running || 0) + (map.converting || 0);
    const line = `parse ${((Date.now() - start) / 1000).toFixed(0)}s tick=${JSON.stringify(tick)} states=${JSON.stringify(map)}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
    if (inFlight === 0 && (map.submitting || 0) === 0) break;
    await new Promise((r) => setTimeout(r, Math.max(4000, config.mineru.pollIntervalMs)));
  }

  const failed = await query(
    `
    SELECT i.key FROM items i
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
    WHERE i.key = ANY($1) AND ft.state = 'failed'
  `,
    [keys],
  );
  if (failed.length) {
    console.log(`retrying ${failed.length} failed parse(s)`);
    await retryFailed();
    await new Promise((r) => setTimeout(r, 8000));
    for (let i = 0; i < 40; i++) {
      await pollOnce();
      const still = await query(
        `
        SELECT COUNT(*)::int AS n FROM items i
        JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
        WHERE i.key = ANY($1) AND ft.state IN ('submitting','pending','running','converting')
      `,
        [keys],
      );
      if ((still[0]?.n || 0) === 0) break;
      await new Promise((r) => setTimeout(r, Math.max(4000, config.mineru.pollIntervalMs)));
    }
  }

  const final = await query(
    `
    SELECT COALESCE(ft.state, 'idle') AS state, COUNT(*)::int AS n
    FROM items i
    LEFT JOIN "itemFullText" ft ON ft."itemID" = i."itemID"
    WHERE i.key = ANY($1)
    GROUP BY 1
  `,
    [keys],
  );
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
  if (!missingFields(item).length) {
    return { key, doi, applied, extracted, miss: [], title: item.getField('title') || '' };
  }
  if (doi) {
    const recognized = await fetchByDoi(doi);
    if (recognized) {
      const mapped = mapRecognized(recognized);
      applied = await applyMapped(item, mapped, { overwrite: false, forceDoi: doi });
    }
  }
  const after = await Item.loadByKey(key);
  let miss = missingFields(after);
  const needExtract =
    miss.includes('abstractNote') || miss.includes('creators') || miss.includes('volume');
  if (needExtract && !DRY_RUN) {
    const ft = await query(
      `
      SELECT ft.state FROM "itemFullText" ft
      JOIN items i ON i."itemID" = ft."itemID"
      WHERE i.key = $1
    `,
      [key],
    );
    if (ft[0]?.state === 'done' && config.llm.apiKey) {
      try {
        const result = await extractItem(key);
        const appliedEx = await applyExtraction(key, result, {
          fieldThreshold: 0.8,
          overwrite: false,
        });
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
  const batchJournals = [...new Set(Object.values(JOURNAL_CODE_NAME))];
  const extra = importedKeys.length
    ? []
    : await query(
        `
    SELECT i.key
    FROM items i
    JOIN "itemData" dj ON dj."itemID" = i."itemID"
    JOIN fields fj ON fj."fieldID" = dj."fieldID" AND fj."fieldName" = 'publicationTitle'
    JOIN "itemDataValues" j ON j."valueID" = dj."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND j.value = ANY($1)
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
  `,
        [batchJournals],
      );
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
    const cands = row.doiCandidates?.length ? row.doiCandidates : [row.doi];
    let hit = null;
    for (const cand of cands) {
      hit = findExisting(existing, cand);
      if (hit) break;
    }
    if (hit) keys.push(hit.key);
  }
  return [...new Set(keys)];
}

async function main() {
  ensureDataDirs();
  await initDb();
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(
    LOG_PATH,
    `\n# run ${new Date().toISOString()} phase=${PHASE} dry=${DRY_RUN}\n`,
  );

  const rows = SOURCES.flatMap((s) => {
    const hasManifest =
      fs.existsSync(path.join(s.dir, 'manifest.tsv')) ||
      fs.existsSync(path.join(s.dir, 'archives', 'manifest.tsv'));
    if (!hasManifest) {
      console.warn(`skip missing manifest: ${s.dir}`);
      return [];
    }
    return loadManifest(s.dir, s.src);
  });
  const workManifest = path.join(ROOT, 'tmp', 'manifest.tsv');
  fs.mkdirSync(path.dirname(workManifest), { recursive: true });
  const workHeader = ['doi', 'journal', 'filename', 'title'];
  fs.writeFileSync(
    workManifest,
    `${workHeader.join('\t')}\n${rows.map((r) => [r.doi || '', r.src || '', r.filename || '', r.title || ''].join('\t')).join('\n')}\n`,
  );
  const missingDoi = rows.filter((r) => !r.doi);
  console.log(
    `Work manifest: ${workManifest} (${rows.length} rows, ${missingDoi.length} without inferred DOI)`,
  );
  const existing = await loadExistingDois();
  console.log(`DB: ${config.databaseUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(
    `Storage: ${config.storage.type}  MinerU: ${config.mineru.tokens.length ? `${config.mineru.tokens.length} token(s)` : 'NO'}  LLM: ${config.llm.apiKey ? 'yes' : 'NO'}`,
  );
  console.log(`Manifest PDFs: ${rows.length}`);

  let importedKeys = [];
  if (PHASE === 'all' || PHASE === 'import') {
    const r = await importPhase(rows, existing);
    importedKeys = r.keys;
  } else {
    importedKeys = await keysFromManifest(rows, existing);
  }

  if (PHASE === 'enqueue') {
    const todo = await listKeysNeedingParse(importedKeys);
    console.log(`\n=== enqueue MinerU (${todo.length}/${importedKeys.length}) ===`);
    if (DRY_RUN) {
      console.log(`would enqueue ${todo.length} keys`);
    } else if (!todo.length) {
      console.log('nothing to enqueue');
    } else {
      if (!config.mineru.tokens.length) throw new Error('OTERO_MINERU_TOKEN is not set');
      await recoverSubmittingOnStartup();
      console.log('enqueue', await enqueueBatchParse(todo));
      await waitForSubmitQueue();
      console.log('submit queue drained');
    }
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
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
});
