import test from 'node:test';
import assert from 'node:assert/strict';

import { databaseConnectionOptions, initializeClient } from '../src/db/connection.js';

test('new database clients explicitly select the public schema', async () => {
  const queries = [];
  const client = { query: async (sql) => queries.push(sql) };

  await initializeClient(client);

  assert.deepEqual(queries, ['SET search_path TO public']);
});

test('sslmode=require keeps the current verify-full behavior explicitly', () => {
  const options = databaseConnectionOptions(
    'postgresql://user:pass@db.example/app?sslmode=require&channel_binding=require'
  );
  const url = new URL(options.connectionString);

  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('channel_binding'), 'require');
});

test('libpq compatibility mode is left unchanged', () => {
  const options = databaseConnectionOptions(
    'postgresql://user:pass@db.example/app?uselibpqcompat=true&sslmode=require'
  );
  const url = new URL(options.connectionString);

  assert.equal(url.searchParams.get('sslmode'), 'require');
});
