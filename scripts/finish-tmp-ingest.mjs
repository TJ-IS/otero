#!/usr/bin/env node
/**
 * Wait until tmp-manifest items leave the MinerU queue, retry leftovers,
 * then build the FTS index.
 */
import fs from 'node:fs';
import { initDb, closeDb, query } from '../src/db/connection.js';
import { enqueueBatchParse } from '../src/services/fulltextService.js';
import { backfillFullTextIndex } from '../src/services/fulltextIndexService.js';

function load(p) {
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split('\t')[0].toLowerCase());
}

const dois = [
  ...load('./tmp/infoandorg/manifest.tsv'),
  ...load('./tmp/isj/manifest.tsv'),
];

async function states() {
  return query(`
    SELECT COALESCE(ft.state,'idle') AS state, COUNT(*)::int AS n
    FROM items i
    JOIN "itemData" d ON d."itemID"=i."itemID"
    JOIN fields f ON f."fieldID"=d."fieldID" AND f."fieldName"='DOI'
    JOIN "itemDataValues" v ON v."valueID"=d."valueID"
    LEFT JOIN "itemFullText" ft ON ft."itemID"=i."itemID"
    WHERE i.deleted=0 AND i."parentItemID" IS NULL AND lower(v.value)=ANY($1)
    GROUP BY 1 ORDER BY 1
  `, [dois]);
}

function inFlight(rows) {
  const map = Object.fromEntries(rows.map((r) => [r.state, r.n]));
  return (map.submitting || 0) + (map.pending || 0) + (map.running || 0) + (map.converting || 0);
}

async function keysIn(state) {
  const rows = await query(`
    SELECT i.key
    FROM items i
    JOIN "itemData" d ON d."itemID"=i."itemID"
    JOIN fields f ON f."fieldID"=d."fieldID" AND f."fieldName"='DOI'
    JOIN "itemDataValues" v ON v."valueID"=d."valueID"
    JOIN "itemFullText" ft ON ft."itemID"=i."itemID"
    WHERE i.deleted=0 AND i."parentItemID" IS NULL
      AND lower(v.value)=ANY($1) AND ft.state=$2
  `, [dois, state]);
  return rows.map((r) => r.key);
}

await initDb();
const start = Date.now();
let last = '';
while (true) {
  const rows = await states();
  const line = `${((Date.now() - start) / 1000).toFixed(0)}s ${JSON.stringify(Object.fromEntries(rows.map((r) => [r.state, r.n])))}`;
  if (line !== last) {
    console.log(line);
    last = line;
  }
  if (inFlight(rows) === 0) break;
  // Let the API worker poll; a second poller was marking fresh -60012 as failed.
  await new Promise((r) => setTimeout(r, 15000));
}

const failed = await keysIn('failed');
if (failed.length) {
  console.log(`retry ${failed.length} failed`);
  console.log(await enqueueBatchParse(failed));
  for (let i = 0; i < 80; i++) {
    const rows = await states();
    console.log(`retry-wait ${i} ${JSON.stringify(Object.fromEntries(rows.map((r) => [r.state, r.n])))}`);
    if (inFlight(rows) === 0) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
}

const index = await backfillFullTextIndex({ concurrency: 4 });
console.log('index', index);
console.log('final', Object.fromEntries((await states()).map((r) => [r.state, r.n])));
await closeDb();
