import fs from 'node:fs';
import path from 'node:path';

import { config, ensureDataDirs } from './src/config.js';
config.recognizers.timeoutMs = 10000;
config.recognizers.userAgent = 'Otero/0.1 (mailto:otero@example.com)';

import { runMigrations } from './src/db/migrate.js';
import { seed } from './src/db/seed.js';
import { initDb, closeDb } from './src/db/connection.js';
import { importPdf } from './src/services/importService.js';

const PDF_DIR = '/mnt/data_sda1/pdfs';
const CONCURRENCY = 8;
const BATCH_LOG = '/mnt/data_sda1/import_log.csv';

let total = 0,
  ok = 0,
  fail = 0;
const srcCounts = {};
const startTime = Date.now();

function statusLine() {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const src = Object.entries(srcCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  return `  ${total} done (ok:${ok} fail:${fail}) ${elapsed}s ${src}`;
}

async function importOne(filePath) {
  const fileName = path.basename(filePath);
  try {
    const r = await importPdf(filePath, { skipRecognize: false });
    const source = r.recognized?.source || 'unknown';
    const title = r.parent?.getField?.('title') || r.parent?.fields?.title || '';
    return { ok: true, file: fileName, source, title };
  } catch (err) {
    return { ok: false, file: fileName, error: err.message };
  }
}

async function main() {
  ensureDataDirs();
  await initDb();
  await runMigrations();
  await seed();

  const files = fs.readdirSync(PDF_DIR).filter((f) => f.endsWith('.pdf'));
  total = files.length;

  fs.writeFileSync(BATCH_LOG, 'file,status,source,title,error\n');
  console.log(`Importing ${total} PDFs (concurrency=${CONCURRENCY})...\n`);

  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((f) => importOne(path.join(PDF_DIR, f))));

    for (const r of results) {
      if (r.ok) {
        ok++;
        srcCounts[r.source] = (srcCounts[r.source] || 0) + 1;
      } else {
        fail++;
      }
      const line = `"${r.file}","${r.ok ? 'ok' : 'fail'}","${r.source || ''}","${(r.title || '').replace(/"/g, '""')}","${(r.error || '').replace(/"/g, '""')}"\n`;
      fs.appendFileSync(BATCH_LOG, line);
    }

    if (total > 100 && i % (CONCURRENCY * 50) === 0) {
      process.stdout.write('\r' + statusLine());
    } else {
      process.stdout.write('\r' + statusLine());
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n=== Done ===');
  console.log(`  Total: ${total}`);
  console.log(`  OK:    ${ok}`);
  console.log(`  Fail:  ${fail}`);
  console.log(`  Time:  ${elapsed}s  (avg ${(elapsed / Math.max(total, 1)).toFixed(2)}s/file)`);
  console.log(`\nSources:`);
  for (const [src, cnt] of Object.entries(srcCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${cnt}`);
  }
  console.log(`\nLog: ${BATCH_LOG}`);

  await closeDb();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
