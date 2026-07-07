import { Command } from 'commander';
import { runMigrations } from '../db/migrate.js';
import { seed } from '../db/seed.js';
import { importPdf } from '../services/importService.js';
import { Items } from '../models/Item.js';
import { Collections } from '../models/Collection.js';
import { closeDb } from '../db/connection.js';
import { startServer } from '../api/server.js';

const program = new Command();

program
  .name('otero')
  .description('Otero literature management CLI')
  .version('0.1.0');

program
  .command('migrate')
  .description('Apply SQLite schema migrations')
  .action(() => {
    const res = runMigrations();
    console.log(`Migration OK: schema v${res.applied} (previous v${res.previous})`);
  });

program
  .command('seed')
  .description('Seed schema definitions (itemTypes / fields / creatorTypes)')
  .action(() => {
    runMigrations();
    const res = seed();
    console.log(`Seed OK: ${res.itemTypes} itemTypes, ${res.fields} fields, ${res.creatorTypes} creatorTypes`);
  });

program
  .command('import')
  .description('Import one or more PDF files into the library')
  .argument('<paths...>', 'PDF file paths')
  .option('--no-recognize', 'Skip metadata recognition; only store as attachment')
  .action(async (paths, opts) => {
    runMigrations();
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
    closeDb();
    if (fail > 0) process.exitCode = 1;
  });

program
  .command('list')
  .description('List items in the library')
  .option('--type <type>', 'filter by item type (e.g. journalArticle)')
  .option('--collection <key>', 'filter by collection key')
  .option('--include-deleted', 'include soft-deleted items')
  .action((opts) => {
    runMigrations();
    const items = Items.list({
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
    closeDb();
  });

program
  .command('collections')
  .description('List collections')
  .action(() => {
    runMigrations();
    for (const c of Collections.list()) {
      console.log(`${c.key}\t${c.name}`);
    }
    closeDb();
  });

program
  .command('serve')
  .description('Start the REST API server')
  .option('-p, --port <port>', 'port number', '3000')
  .option('-H, --host <host>', 'host', '127.0.0.1')
  .action(async (opts) => {
    runMigrations();
    await startServer({ port: Number(opts.port), host: opts.host });
    // Server keeps process alive; do not closeDb.
  });

// Default: print help.
program.parseAsync(process.argv).catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => {
  // closeDb() is called explicitly by short-lived commands above. The serve
  // command keeps the DB open. Long-running servers shouldn't close.
});
