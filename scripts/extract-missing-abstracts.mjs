#!/usr/bin/env node
/**
 * Fill empty abstractNote for Basket journal items that already have MinerU text.
 */
import { initDb, closeDb, query } from '../src/db/connection.js';
import { extractItem, applyExtraction } from '../src/services/extractService.js';
import { JOURNAL_WHITELIST } from '../src/services/journalWhitelist.js';

const CONCURRENCY = Math.max(1, Number(process.argv[2]) || 3);

await initDb();
const rows = await query(`
  SELECT i.key
  FROM items i
  JOIN "itemData" dj ON dj."itemID" = i."itemID"
  JOIN fields fj ON fj."fieldID" = dj."fieldID" AND fj."fieldName" = 'publicationTitle'
  JOIN "itemDataValues" j ON j."valueID" = dj."valueID"
  JOIN "itemFullText" ft ON ft."itemID" = i."itemID" AND ft.state = 'done'
  WHERE i.deleted = 0 AND i."parentItemID" IS NULL
    AND j.value = ANY($1)
    AND NOT EXISTS (
      SELECT 1 FROM "itemData" d
      JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" = 'abstractNote'
      JOIN "itemDataValues" v ON v."valueID" = d."valueID"
      WHERE d."itemID" = i."itemID" AND btrim(v.value) <> ''
    )
  ORDER BY i."itemID"
`, [JOURNAL_WHITELIST]);
console.log(`extract abstracts for ${rows.length} items (concurrency=${CONCURRENCY})`);
let next = 0;
let ok = 0;
let skip = 0;
let fail = 0;
const start = Date.now();

async function worker() {
  while (true) {
    const i = next++;
    if (i >= rows.length) return;
    const { key } = rows[i];
    try {
      const result = await extractItem(key);
      const applied = await applyExtraction(key, result, { fieldThreshold: 0.8, overwrite: false });
      const fields = (applied.appliedFields || []).map((f) => f.field);
      if (fields.includes('abstractNote')) ok++;
      else skip++;
    } catch (err) {
      fail++;
      console.error(`ERR ${key}: ${err.message}`);
    }
    const done = ok + skip + fail;
    if (done % 10 === 0 || done === rows.length) {
      const sec = ((Date.now() - start) / 1000).toFixed(0);
      console.log(`  ${done}/${rows.length} abs=${ok} skip=${skip} fail=${fail} ${sec}s`);
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length || 1) }, () => worker()));
console.log(`extract done ok=${ok} skip=${skip} fail=${fail}`);
await closeDb();
