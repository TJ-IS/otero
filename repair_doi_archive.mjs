#!/usr/bin/env node
/**
 * Fast regex-only DOI repair + re-archive pass for "待归档" items (and any items
 * sharing the known truncated DOI "10.25300/MISQ/202").
 *
 * For each target item with a finished MinerU parse, read the content_list.json
 * header/footer blocks, extract the DOI via regex (deterministic, reliable), and:
 *   - overwrite the DOI when it is missing or differs from the regex DOI (this
 *     fixes the ~200 items that share the truncated "10.25300/MISQ/202" value);
 *   - match the header/footer text against the AIS Basket journal whitelist and,
 *     when a canonical journal is found AND a DOI is now present, set
 *     publicationTitle so the item leaves "待归档" and is filed under the journal.
 *
 * No LLM calls — runs in seconds. Use the full `extract_all.mjs` LLM pass
 * afterwards to fill title / authors / abstract for items still missing them.
 *
 * Usage:
 *   node repair_doi_archive.mjs               # dry-run, report only
 *   node repair_doi_archive.mjs --apply       # write changes to the database
 *   node repair_doi_archive.mjs --apply --log=repair_log.csv
 */
import fs from 'node:fs';
import { config, ensureDataDirs } from './src/config.js';
import { runMigrations } from './src/db/migrate.js';
import { seed } from './src/db/seed.js';
import { closeDb, getDb } from './src/db/connection.js';
import { Item } from './src/models/Item.js';
import { JOURNAL_WHITELIST } from './src/services/journalWhitelist.js';
import { readHeaderFooterMetadata, normalizeJournalName } from './src/services/extractService.js';

const args = parseArgs(process.argv.slice(2));
const APPLY = Boolean(args.apply);
const LOG_PATH = args.log ?? './repair_log.csv';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([a-zA-Z-]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] ?? true;
  }
  return out;
}

// Normalization shared with normalizeJournalName: lowercase, drop "The" prefix,
// turn "&" into "and", collapse whitespace.
function norm(s) {
  return (s || '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
}

// Whitelist journals pre-normalized, longest first so more specific names win
// on substring matching (e.g. "Information Systems Research" before "Information
// Systems Journal" — both distinct, but ordering by length avoids partial ties).
const JOURNAL_PATTERNS = JOURNAL_WHITELIST
  .map(canonical => ({ canonical, norm: norm(canonical) }))
  .sort((a, b) => b.norm.length - a.norm.length);

/**
 * Find the canonical AIS Basket journal whose name appears in the header/footer
 * text. Matching is tolerant of "The" prefix, "&" vs "and", and case. Returns
 * the canonical name or null.
 */
function matchJournal(headerFooterText) {
  if (!headerFooterText) return null;
  const hay = norm(headerFooterText);
  for (const j of JOURNAL_PATTERNS) {
    // Word-boundary-ish check: the normalized journal name must appear as a
    // substring. Whitelist names are distinctive enough that this is safe.
    if (hay.includes(j.norm)) return j.canonical;
  }
  return null;
}

function listTargets() {
  const db = getDb();
  const placeholders = JOURNAL_WHITELIST.map(() => '?').join(',');
  // Targets: 待归档 (publicationTitle missing or not in whitelist) with fulltext
  // done, OR any top-level non-deleted item whose DOI is the known truncated
  // garbage value (so we also fix the 1 item already in the MISQ bucket).
  return db.prepare(`
    SELECT i.itemID, i.key,
      (SELECT dv.value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID AND f.fieldName='DOI'
        JOIN itemDataValues dv ON dv.valueID=d.valueID WHERE d.itemID=i.itemID) AS doi,
      (SELECT dv.value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID AND f.fieldName='publicationTitle'
        JOIN itemDataValues dv ON dv.valueID=d.valueID WHERE d.itemID=i.itemID) AS pubtitle,
      (SELECT dv.value FROM itemData d JOIN fields f ON f.fieldID=d.fieldID AND f.fieldName='title'
        JOIN itemDataValues dv ON dv.valueID=d.valueID WHERE d.itemID=i.itemID) AS title
    FROM items i
    JOIN itemFullText ft ON ft.itemID=i.itemID AND ft.state='done'
    WHERE i.deleted=0 AND i.parentItemID IS NULL
      AND (
        NOT EXISTS (
          SELECT 1 FROM itemData dp JOIN fields fp ON fp.fieldID=dp.fieldID AND fp.fieldName='publicationTitle'
          JOIN itemDataValues jv ON jv.valueID=dp.valueID
          WHERE dp.itemID=i.itemID AND jv.value IN (${placeholders})
        )
        OR EXISTS (
          SELECT 1 FROM itemData dd JOIN fields fd ON fd.fieldID=dd.fieldID AND fd.fieldName='DOI'
          JOIN itemDataValues dv ON dv.valueID=dd.valueID
          WHERE dd.itemID=i.itemID AND dv.value='10.25300/MISQ/202'
        )
      )
    ORDER BY i.itemID
  `).all(...JOURNAL_WHITELIST);
}

function csvCell(s) {
  const v = String(s ?? '');
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function csvRow(cells) { return cells.map(csvCell).join(',') + '\n'; }

const CSV_HEADER = ['key', 'itemID', 'title', 'oldDOI', 'newDOI', 'doiChanged', 'oldPubTitle', 'newPubTitle', 'pubChanged', 'archived', 'action'];

// ---- main -------------------------------------------------------------------
ensureDataDirs();
runMigrations();
seed();

const targets = listTargets();
console.log(`目标条目：${targets.length} 条（待归档+已解析 或 共享截断 DOI）`);
console.log(`模式：${APPLY ? '写入数据库' : 'dry-run（仅报告，加 --apply 写入）'}`);
console.log(`日志：${LOG_PATH}\n`);

const logLines = [csvRow(CSV_HEADER)];
let doiFixed = 0, doiFilled = 0, archived = 0, noFooterDoi = 0, noJournal = 0;
const start = Date.now();

for (const t of targets) {
  const { headerFooterText, doi: regexDoi } = await readHeaderFooterMetadata(t.key);
  const oldDoi = (t.doi || '').trim();
  const oldPub = (t.pubtitle || '').trim();

  let newDoi = oldDoi;
  let doiChanged = false;
  let doiAction = '';
  if (regexDoi && regexDoi !== oldDoi) {
    newDoi = regexDoi;
    doiChanged = true;
    doiAction = oldDoi ? 'fix' : 'fill';
  }

  // Only attempt to archive when we have a DOI (after the fix). Without a DOI
  // the AIS Basket rule keeps the item in 待归档 anyway.
  const effectiveDoi = newDoi;
  let newPub = oldPub;
  let pubChanged = false;
  let archivedNow = false;
  if (effectiveDoi) {
    const canonical = matchJournal(headerFooterText);
    if (canonical && canonical !== oldPub) {
      newPub = canonical;
      pubChanged = true;
      // archived only if it was 待归档 (oldPub empty/not whitelist) and now whitelist
      if (!JOURNAL_WHITELIST.includes(oldPub)) archivedNow = true;
    }
  }

  if (!regexDoi) noFooterDoi++;
  if (regexDoi && effectiveDoi && !matchJournal(headerFooterText)) noJournal++;

  if (doiAction === 'fix') doiFixed++;
  else if (doiAction === 'fill') doiFilled++;
  if (archivedNow) archived++;

  if (APPLY) {
    if (doiChanged || pubChanged) {
      const item = Item.loadByKey(t.key);
      if (item) {
        if (doiChanged) item.setField('DOI', newDoi);
        if (pubChanged) item.setField('publicationTitle', newPub);
        item.save();
      }
    }
  }

  const action = archivedNow ? 'archived' : (doiChanged ? doiAction : (regexDoi ? 'no-change' : 'no-footer-doi'));
  logLines.push(csvRow([t.key, t.itemID, t.title, oldDoi, newDoi, doiChanged ? 'yes' : 'no', oldPub, newPub, pubChanged ? 'yes' : 'no', archivedNow ? 'yes' : 'no', action]));

  if ((targets.indexOf(t) + 1) % 100 === 0 || targets.indexOf(t) === targets.length - 1) {
    const done = targets.indexOf(t) + 1;
    process.stdout.write(`\r  ${done}/${targets.length} 处理完成`);
  }
}

fs.writeFileSync(LOG_PATH, logLines.join(''));
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n\n=== 完成 (${elapsed}s) ===`);
console.log(`  总计:           ${targets.length}`);
console.log(`  DOI 修复(截断): ${doiFixed}`);
console.log(`  DOI 补填(缺失): ${doiFilled}`);
console.log(`  归档(移入期刊): ${archived}`);
console.log(`  无页脚 DOI:     ${noFooterDoi}`);
console.log(`  有DOI但无期刊名: ${noJournal}`);
console.log(`  日志: ${LOG_PATH}`);
if (!APPLY) console.log('\n这是 dry-run。确认无误后运行: node repair_doi_archive.mjs --apply');

closeDb();
