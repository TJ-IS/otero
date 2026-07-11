#!/usr/bin/env node
/**
 * Batch bibliographic metadata extraction for "待归档" items that already have
 * a finished MinerU full-text parse.
 *
 * Reads each item's full.md, asks the configured LLM (DeepSeek) to extract
 * title / authors / DOI / journal / year / volume / issue / pages / abstract,
 * and auto-applies fields whose confidence meets the threshold. Low-confidence
 * fields and any errors are recorded in a CSV audit log for manual review.
 *
 * Usage:
 *   node extract_all.mjs                       # full run, threshold 0.8
 *   node extract_all.mjs --limit=5 --dry-run   # preview 5 items, no DB writes
 *   node extract_all.mjs --threshold=0.9 --type-threshold=0.95
 *   node extract_all.mjs --overwrite           # also fill fields that already have values
 *
 * Flags:
 *   --limit=N          process at most N items (0 = all, default 0)
 *   --threshold=F      field/creator confidence threshold (default 0.8)
 *   --type-threshold=F itemType confidence threshold (default 0.9)
 *   --dry-run          extract only, do not write to the database
 *   --overwrite        also overwrite fields/creators that already have values
 *   --concurrency=N    parallel LLM calls (default 4)
 *   --log=PATH         CSV log path (default ./extract_log.csv)
 */

import fs from 'node:fs';
import { config, ensureDataDirs } from './src/config.js';
import { runMigrations } from './src/db/migrate.js';
import { seed } from './src/db/seed.js';
import { initDb, closeDb } from './src/db/connection.js';
import { listUnfiledWithFulltextDone } from './src/repositories/itemRepo.js';
import { extractItem, applyExtraction } from './src/services/extractService.js';

// ---- CLI args ---------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));
const LIMIT = Math.max(0, Number(args.limit ?? 0));
const THRESHOLD = clamp01(Number(args.threshold ?? 0.8));
const TYPE_THRESHOLD = clamp01(Number(args['type-threshold'] ?? 0.9));
const DRY_RUN = Boolean(args['dry-run']);
const OVERWRITE = Boolean(args.overwrite);
const CONCURRENCY = Math.max(1, Math.min(8, Number(args.concurrency ?? 4)));
const LOG_PATH = args.log ?? './extract_log.csv';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}
function clamp01(n) { if (Number.isNaN(n)) return 0; return Math.max(0, Math.min(1, n)); }

// ---- CSV helper -------------------------------------------------------------
function csvCell(s) {
  const v = String(s ?? '');
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function csvRow(cells) { return cells.map(csvCell).join(',') + '\n'; }

const CSV_HEADER = [
  'key', 'currentTitle', 'extractedTitle', 'extractedJournal', 'suggestedType',
  'typeConfidence', 'overallConfidence', 'typeChanged',
  'appliedFields', 'skippedFields', 'appliedCreators', 'error',
];

// ---- main -------------------------------------------------------------------
let processed = 0, okCount = 0, skipCount = 0, failCount = 0;
const startTime = Date.now();

function progressLine(total) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  return `\r  ${processed}/${total} done (ok:${okCount} skip:${skipCount} fail:${failCount}) ${elapsed}s`;
}

async function processOne({ key, title }, total) {
  let extractedTitle = '', extractedJournal = '', suggestedType = '';
  let typeConf = '', overallConf = '', typeChanged = '';
  let appliedFields = [], skippedFields = [], appliedCreators = false;
  let error = '';

  try {
    const result = await extractItem(key);
    suggestedType = result.suggestedItemType;
    typeConf = result.itemTypeConfidence?.toFixed(2) ?? '';
    overallConf = result.overallConfidence?.toFixed(2) ?? '';
    extractedTitle = result.fields.find(f => f.field === 'title')?.value || '';
    extractedJournal = result.fields.find(f => f.field === 'publicationTitle')?.value || '';

    if (!DRY_RUN) {
      const apply = await applyExtraction(key, result, {
        fieldThreshold: THRESHOLD,
        creatorThreshold: THRESHOLD,
        typeThreshold: TYPE_THRESHOLD,
        overwrite: OVERWRITE,
      });
      typeChanged = apply.typeChanged ? 'yes' : 'no';
      appliedFields = apply.appliedFields.map(f => f.field);
      skippedFields = apply.skippedFields.map(f => `${f.field}(${(f.confidence||0).toFixed(2)})`);
      appliedCreators = apply.appliedCreators;
      okCount++;
    } else {
      typeChanged = 'dry-run';
      appliedFields = result.fields
        .filter(f => f.confidence >= THRESHOLD && f.value)
        .map(f => f.field);
      skippedFields = result.fields
        .filter(f => f.confidence < THRESHOLD || !f.value)
        .map(f => `${f.field}(${(f.confidence||0).toFixed(2)})`);
      okCount++;
    }
  } catch (err) {
    error = err.message;
    failCount++;
  } finally {
    processed++;
  }

  const line = csvRow([
    key, title || '', extractedTitle, extractedJournal, suggestedType,
    typeConf, overallConf, typeChanged,
    appliedFields.join(' '), skippedFields.join(' '), appliedCreators ? 'yes' : 'no',
    error,
  ]);
  fs.appendFileSync(LOG_PATH, line);
  process.stdout.write(progressLine(total));
}

async function main() {
  ensureDataDirs();
  await initDb();
  await runMigrations();
  await seed();

  if (!config.llm.apiKey) {
    console.error('未配置 OPENAI_API_KEY，无法调用 LLM。请在 .env 中设置。');
    process.exitCode = 1;
    return;
  }

  // Collect the full target set (paginated query, drained into one array).
  const all = [];
  let page = 1;
  while (true) {
    const { items, total } = await listUnfiledWithFulltextDone({ page, pageSize: 200 });
    all.push(...items);
    if (all.length >= total || items.length === 0) break;
    page++;
  }

  const targets = LIMIT > 0 ? all.slice(0, LIMIT) : all;
  console.log(`待归档 + 全文已解析条目：${all.length} 条`);
  console.log(`本次处理：${targets.length} 条 (concurrency=${CONCURRENCY}, threshold=${THRESHOLD}, typeThreshold=${TYPE_THRESHOLD}, dryRun=${DRY_RUN}, overwrite=${OVERWRITE})`);
  console.log(`CSV 日志：${LOG_PATH}\n`);

  fs.writeFileSync(LOG_PATH, csvRow(CSV_HEADER));

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(t => processOne(t, targets.length)));
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n=== Done ===');
  console.log(`  Total:     ${processed}`);
  console.log(`  OK:        ${okCount}`);
  console.log(`  Skipped:   ${skipCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`  Time:      ${elapsed}s  (avg ${(processed ? elapsed / processed : 0).toFixed(2)}s/item)`);
  console.log(`  Log:       ${LOG_PATH}`);

  await closeDb();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
  try { await closeDb(); } catch { /* ignore */ }
});
