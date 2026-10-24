import { initDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startServer } from './api/server.js';
import { config } from './config.js';

// Safety net: without these, an unhandled rejection or uncaught exception
// crashes the whole process (Node's default). Route handlers should always
// funnel errors through asyncHandler -> next(error), but this catches
// anything that slips through (e.g. a bug in a background task) and logs
// it instead of taking the server down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Top-level entry. Dispatches based on argv.
//   node src/index.js             -> default: serve
//   node src/index.js --serve     -> serve
//   (CLI subcommands handled by src/cli/index.js)
const args = process.argv.slice(2);

async function main() {
  await initDb();
  await runMigrations();
  await seed();
  if (args.includes('--migrate-only')) {
    return;
  }
  await startServer({ port: config.api.port, host: config.api.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
