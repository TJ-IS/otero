import { Command } from 'commander';
import { initDb, closeDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { importPdf } from '../services/importService.js';
import { Items } from '../models/Item.js';
import { Collections } from '../models/Collection.js';
import { startServer } from '../api/server.js';
import { parseItem, pollOnce, getFullText, listAll } from '../services/fulltextService.js';

const program = new Command();

program
  .name('otero')
  .description('Otero literature management CLI')
  .version('0.1.0');

program
  .command('migrate')
  .description('Apply PostgreSQL schema migrations')
  .action(async () => {
    await initDb();
    const res = await runMigrations();
    console.log(`Migration OK: schema v${res.applied} (previous v${res.previous})`);
    await closeDb();
  });

program
  .command('seed')
  .description('Seed schema definitions (itemTypes / fields / creatorTypes)')
  .action(async () => {
    await initDb();
    await runMigrations();
    const res = await seed();
    console.log(`Seed OK: ${res.itemTypes} itemTypes, ${res.fields} fields, ${res.creatorTypes} creatorTypes`);
    await closeDb();
  });

program
  .command('import')
  .description('Import one or more PDF files into the library')
  .argument('<paths...>', 'PDF file paths')
  .option('--no-recognize', 'Skip metadata recognition; only store as attachment')
  .action(async (paths, opts) => {
    await initDb();
    await runMigrations();
    let ok = 0, fail = 0;
    for (const p of paths) {
      try {
        const r = await importPdf(p, { skipRecognize: !opts.recognize });
        const parentKey = r.parent?.key ?? '(no parent)';
        const title = r.parent?.getField('title') ?? r.attachment.key;
        console.log(`[OK]   ${p}\n        parent=${parentKey} attachment=${r.attachment.key}\n        title="${title}"`);
        ok++;
      } catch (err) {
        console.error(`[FAIL] ${p}\n        ${err.message}`);
        fail++;
      }
    }
    console.log(`\nDone: ${ok} ok, ${fail} failed.`);
    await closeDb();
    if (fail > 0) process.exitCode = 1;
  });

program
  .command('list')
  .description('List items in the library')
  .option('--type <type>', 'filter by item type (e.g. journalArticle)')
  .option('--collection <key>', 'filter by collection key')
  .option('--include-deleted', 'include soft-deleted items')
  .action(async (opts) => {
    await initDb();
    await runMigrations();
    const items = await Items.listAll({
      type: opts.type,
      collection: opts.collection,
      includeDeleted: opts.includeDeleted,
      topLevelOnly: true,
    });
    if (items.length === 0) {
      console.log('(no items)');
    } else {
      for (const it of items) {
        const title = it.getField('title') ?? '(untitled)';
        const creators = it.creators.map(c => c.lastName || c.firstName || c.name).join(', ');
        console.log(`${it.key}\t${it.itemType}\t${title}\t${creators}`);
      }
    }
    console.log(`\nTotal: ${items.length}`);
    await closeDb();
  });

program
  .command('collections')
  .description('List collections')
  .action(async () => {
    await initDb();
    await runMigrations();
    for (const c of await Collections.list()) {
      console.log(`${c.key}\t${c.name}`);
    }
    await closeDb();
  });

program
  .command('serve')
  .description('Start the REST API server')
  .option('-p, --port <port>', 'port number', '3000')
  .option('-H, --host <host>', 'host', '127.0.0.1')
  .action(async (opts) => {
    await initDb();
    await runMigrations();
    await seed();
    await startServer({ port: Number(opts.port), host: opts.host });
    // Server keeps process alive; do not closeDb.
  });

program
  .command('parse')
  .description('Parse an item\'s PDF to Markdown full text via MinerU')
  .argument('<key>', 'item key')
  .option('--force', 're-parse even if already done')
  .option('--wait', 'block until the task completes (polls locally)')
  .action(async (key, opts) => {
    await initDb();
    await runMigrations();
    try {
      const r = await parseItem(key, { force: !!opts.force });
      console.log(`Submitted: state=${r.state} batchId=${r.mineruBatchId || '-'}`);
      if (opts.wait) {
        console.log('Polling until done...');
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await new Promise(r => setTimeout(r, 3000));
          await pollOnce();
          const cur = await getFullText(key);
          process.stdout.write(`\rstate=${cur.state}` +
            (cur.totalPages ? ` ${cur.extractedPages ?? 0}/${cur.totalPages}` : '') +
            '    ');
          if (cur.state === 'done' || cur.state === 'failed') {
            console.log('');
            if (cur.state === 'failed') console.error(`Failed: ${cur.errMsg}`);
            break;
          }
        }
      }
    } catch (err) {
      console.error(`[FAIL] ${err.message}`);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  });

program
  .command('parse-all')
  .description('Submit MinerU full-text parsing for all (top-level) items')
  .option('--type <type>', 'filter by item type')
  .option('--force', 're-parse even if already done')
  .action(async (opts) => {
    await initDb();
    await runMigrations();
    const items = await Items.listAll({ type: opts.type, topLevelOnly: true });
    let ok = 0, fail = 0;
    for (const it of items) {
      try {
        await parseItem(it.key, { force: !!opts.force });
        console.log(`[OK]   ${it.key}  ${it.getField('title') ?? ''}`);
        ok++;
      } catch (err) {
        console.error(`[FAIL] ${it.key}  ${err.message}`);
        fail++;
      }
    }
    console.log(`\nSubmitted: ${ok} ok, ${fail} failed. ` +
      `Pending tasks will be advanced by the running server's worker.` +
      (!ok ? '' : ` Run \`otero serve\` or use --wait on \`otero parse\` to advance them.`));
    await closeDb();
  });

program
  .command('parse-status')
  .description('Show MinerU full-text parsing queue status')
  .action(async () => {
    await initDb();
    await runMigrations();
    const all = await listAll();
    if (all.length === 0) {
      console.log('(no full-text rows)');
    } else {
      for (const r of all) {
        console.log(`${r.itemKey}\t${r.state}\t${r.modelVersion || '-'}\t${r.errMsg || ''}`);
      }
    }
    console.log(`\nTotal: ${all.length}`);
    await closeDb();
  });

program
  .command('index-fulltext')
  .description('Build Postgres FTS index from MinerU markdown (additive; never deletes data)')
  .option('--force', 're-index even if tsv already present')
  .option('--limit <n>', 'max rows to process', (v) => parseInt(v, 10))
  .option('--concurrency <n>', 'parallel workers', (v) => parseInt(v, 10), 4)
  .action(async (opts) => {
    const { backfillFullTextIndex, countUnindexedFullText } = await import(
      '../services/fulltextIndexService.js'
    );
    await initDb();
    await runMigrations();
    const pending = await countUnindexedFullText();
    console.log(`Unindexed done rows: ${pending}` + (opts.force ? ' (force re-index all done)' : ''));
    let lastLog = 0;
    const res = await backfillFullTextIndex({
      force: !!opts.force,
      limit: opts.limit || 0,
      concurrency: opts.concurrency || 4,
      onProgress: ({ done, total, itemKey, ok, reason }) => {
        if (done - lastLog >= 25 || done === total) {
          lastLog = done;
          process.stdout.write(`[${done}/${total}] ${itemKey} ${ok ? 'ok' : reason || 'fail'}\n`);
        }
      },
    });
    console.log(`\nIndexed: ${res.ok} ok, ${res.fail} failed, ${res.total} considered.`);
    await closeDb();
    if (res.fail > 0) process.exitCode = 1;
  });

program
  .command('repair-metadata')
  .description('Repair confirmed Basket metadata errors (default: dry-run)')
  .option('--apply', 'write changes to the database')
  .option('--dry-run', 'report changes without writing (default)')
  .option('--phase <n>', '1|2|3|4|all', 'all')
  .option('--keys <keys>', 'comma-separated item keys to limit the run')
  .option('--log <path>', 'JSONL log path')
  .action(async (opts) => {
    const { repairMetadata } = await import('../services/metadataRepairService.js');
    await initDb();
    await runMigrations();
    try {
      const apply = !!opts.apply && !opts.dryRun;
      const keys = opts.keys ? String(opts.keys).split(',').map((k) => k.trim()).filter(Boolean) : null;
      const res = await repairMetadata({
        apply,
        phase: opts.phase,
        logPath: opts.log || null,
        keys,
      });
      console.log(`\n${apply ? 'Applied' : 'Dry-run'}: ${res.summary.total} rows, `
        + `${res.summary.applied} changed, ${res.summary.skipped} skipped, ${res.summary.errors} errors`);
      console.log(`Log: ${res.logPath}`);
      if (res.summary.errors > 0) process.exitCode = 1;
    } catch (err) {
      console.error(`[FAIL] ${err.message}`);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  });

program
  .command('extract-abstracts')
  .description('Fill empty/placeholder abstracts from MinerU text (default: dry-run, no LLM)')
  .option('--apply', 'write extracted abstracts to the database')
  .option('--dry-run', 'report extractions without writing (default)')
  .option('--limit <n>', 'max items to scan', (v) => Number(v))
  .option('--keys <keys>', 'comma-separated item keys to limit the run')
  .option('--log <path>', 'JSONL log path')
  .action(async (opts) => {
    const { extractAbstracts } = await import('../services/abstractExtractService.js');
    await initDb();
    await runMigrations();
    try {
      const apply = !!opts.apply && !opts.dryRun;
      const keys = opts.keys ? String(opts.keys).split(',').map((k) => k.trim()).filter(Boolean) : null;
      const res = await extractAbstracts({
        apply,
        logPath: opts.log || null,
        limit: opts.limit || null,
        keys,
      });
      console.log(`\n${apply ? 'Applied' : 'Dry-run'}: scanned ${res.summary.scanned}, `
        + `${res.summary.hit} extracted, ${res.summary.skipped} skipped`);
      for (const j of res.summary.byJournal) {
        if (!j.candidates) continue;
        console.log(`  ${j.journal}: ${j.hit}/${j.candidates} (${j.rate}%)`);
      }
      console.log(`Log: ${res.logPath}`);
    } catch (err) {
      console.error(`[FAIL] ${err.message}`);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  });

// Default: print help.
program.parseAsync(process.argv).catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  // closeDb() is called explicitly by short-lived commands above. The serve
  // command keeps the DB open. Long-running servers shouldn't close.
});
