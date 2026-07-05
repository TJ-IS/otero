import { runMigrations } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startServer } from './api/server.js';
import { config } from './config.js';

// Top-level entry. Dispatches based on argv.
//   node src/index.js             -> default: serve
//   node src/index.js --serve     -> serve
//   (CLI subcommands handled by src/cli/index.js)
const args = process.argv.slice(2);

async function main() {
  runMigrations();
  seed();
  if (args.includes('--migrate-only')) {
    return;
  }
  await startServer({ port: config.api.port, host: config.api.host });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
