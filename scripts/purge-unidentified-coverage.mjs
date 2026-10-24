#!/usr/bin/env node
/**
 * Soft-delete library items in the coverage "未识别" bucket and drop those
 * target DOIs from target_dois.txt so the dashboard row disappears.
 *
 *   node scripts/purge-unidentified-coverage.mjs
 *   node scripts/purge-unidentified-coverage.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, closeDb, query } from '../src/db/connection.js';
import { Item } from '../src/models/Item.js';
import { classifyJournal, UNFILED } from '../src/services/journalWhitelist.js';
import { doiCompareKey, getTargetDoiKeys } from '../src/services/targetDois.js';
import { basketJournalOrder, inferJournalFromDoi } from '../src/services/targetDoiMeta.js';
import { normalizeJournalName } from '../src/services/extractService.js';

const ROOT = path.join(dirnameFromMeta(import.meta.url), '..');
const TARGET_PATH = path.join(ROOT, 'target_dois.txt');
const APPLY = process.argv.includes('--apply');

function dirnameFromMeta(metaUrl) {
  return path.dirname(fileURLToPath(metaUrl));
}

function attributeJournal(libJournal, doiKey) {
  const order = new Set(basketJournalOrder());
  let journal = libJournal && libJournal !== UNFILED ? libJournal : inferJournalFromDoi(doiKey);
  if (journal && !order.has(journal)) journal = inferJournalFromDoi(doiKey);
  return journal && order.has(journal) ? journal : null;
}

async function loadLibraryByDoi() {
  const rows = await query(`
    SELECT i.key, i."itemID",
      lower(v_doi.value) AS doi_raw,
      v_pub.value AS "publicationTitle",
      v_title.value AS title
    FROM items i
    JOIN "itemData" d_doi ON d_doi."itemID" = i."itemID"
    JOIN fields f_doi ON f_doi."fieldID" = d_doi."fieldID" AND f_doi."fieldName" = 'DOI'
    JOIN "itemDataValues" v_doi ON v_doi."valueID" = d_doi."valueID"
    LEFT JOIN "itemData" d_pub ON d_pub."itemID" = i."itemID"
      AND d_pub."fieldID" = (SELECT "fieldID" FROM fields WHERE "fieldName" = 'publicationTitle')
    LEFT JOIN "itemDataValues" v_pub ON v_pub."valueID" = d_pub."valueID"
    LEFT JOIN "itemData" d_title ON d_title."itemID" = i."itemID"
      AND d_title."fieldID" = (SELECT "fieldID" FROM fields WHERE "fieldName" = 'title')
    LEFT JOIN "itemDataValues" v_title ON v_title."valueID" = d_title."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
  `);
  const map = new Map();
  for (const r of rows) {
    const key = doiCompareKey(r.doi_raw);
    if (!key || map.has(key)) continue;
    map.set(key, {
      itemKey: r.key,
      itemID: r.itemID,
      doi: key,
      publicationTitle: r.publicationTitle || '',
      title: r.title || '',
      classified: classifyJournal(r.publicationTitle),
    });
  }
  return map;
}

function collectUnidentified(targetKeys, library) {
  const collected = [];
  const missing = [];
  for (const doi of targetKeys) {
    const lib = library.get(doi);
    const journal = attributeJournal(lib?.classified, doi);
    if (journal) continue;
    if (lib) collected.push(lib);
    else missing.push(doi);
  }
  collected.sort((a, b) => a.doi.localeCompare(b.doi));
  missing.sort();
  return { collected, missing };
}

function printReport({ collected, missing }) {
  console.log(
    `unidentified collected=${collected.length} missing=${missing.length} drop=${collected.length + missing.length}`,
  );
  console.log('\n=== collected (soft-delete) ===');
  for (const row of collected) {
    const recoverable = normalizeJournalName(row.publicationTitle);
    const flag = recoverable ? ` RECOVERABLE→${recoverable}` : '';
    console.log(
      `${row.itemKey}\t${row.doi}\t${row.classified}\t${(row.publicationTitle || '(no journal)').slice(0, 80)}${flag}`,
    );
    console.log(`  ${(row.title || '(no title)').slice(0, 100)}`);
  }
  console.log('\n=== missing (drop from target list only) ===');
  for (const doi of missing) console.log(doi);
}

function rewriteTargetList(dropKeys) {
  const drop = new Set(dropKeys);
  const text = fs.readFileSync(TARGET_PATH, 'utf8');
  const endsWithNl = text.endsWith('\n');
  const lines = text.split(/\r?\n/);
  const kept = [];
  let removed = 0;
  for (const line of lines) {
    const key = doiCompareKey(line);
    if (key && drop.has(key)) {
      removed += 1;
      continue;
    }
    kept.push(line);
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  fs.writeFileSync(TARGET_PATH, `${kept.join('\n')}${endsWithNl || kept.length ? '\n' : ''}`);
  return { removed, remaining: kept.filter((l) => doiCompareKey(l)).length };
}

await initDb();
try {
  const targetKeys = getTargetDoiKeys();
  const library = await loadLibraryByDoi();
  const groups = collectUnidentified(targetKeys, library);
  printReport(groups);

  const recoverable = groups.collected.filter((r) => normalizeJournalName(r.publicationTitle));
  if (recoverable.length) {
    console.error(
      `\nABORT: ${recoverable.length} collected item(s) have a normalizable Basket journal name. Fix metadata instead of deleting.`,
    );
    process.exitCode = 1;
  } else if (!APPLY) {
    console.log(
      '\ndry-run only. Re-run with --apply to soft-delete collected items and rewrite target_dois.txt.',
    );
  } else {
    console.log('\n=== apply ===');
    for (const row of groups.collected) {
      const item = await Item.loadByKey(row.itemKey);
      if (!item) {
        console.error(`skip missing key ${row.itemKey}`);
        continue;
      }
      await item.delete(false);
      console.log(`deleted ${row.itemKey}`);
    }
    const dropKeys = [...groups.collected.map((r) => r.doi), ...groups.missing];
    const rewritten = rewriteTargetList(dropKeys);
    console.log(`target_dois.txt removed=${rewritten.removed} remaining=${rewritten.remaining}`);
  }
} finally {
  await closeDb();
}
