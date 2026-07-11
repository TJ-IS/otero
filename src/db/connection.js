import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool = null;

/** UTC timestamp string matching historical SQLite datetime('now') format. */
export function nowUtc() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Create the shared pg Pool. Must be awaited once at process startup
 * before any query helpers are used.
 */
export async function initDb() {
  if (pool) return pool;
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL is required (PostgreSQL connection string)');
  }
  pool = new Pool({ connectionString: config.databaseUrl });
  // Fail fast if the server is unreachable.
  const client = await pool.connect();
  client.release();
  return pool;
}

/** Return the shared Pool (throws if initDb has not been called). */
export function getPool() {
  if (!pool) throw new Error('Database not initialized; call await initDb() first');
  return pool;
}

/** For tests: inject a custom Pool (or null to clear). */
export function setPool(instance) {
  pool = instance;
}

/** Close the shared pool if open. */
export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run a query and return all rows.
 * @param {string} sql
 * @param {any[]} [params]
 * @param {import('pg').PoolClient} [client] optional transaction client
 */
export async function query(sql, params = [], client = null) {
  const runner = client || getPool();
  const res = await runner.query(sql, params);
  return res.rows;
}

/** Run a query and return the first row or null. */
export async function queryOne(sql, params = [], client = null) {
  const rows = await query(sql, params, client);
  return rows[0] ?? null;
}

/**
 * Run a statement; returns { rowCount, rows }.
 * Use RETURNING to get inserted/updated rows.
 */
export async function execute(sql, params = [], client = null) {
  const runner = client || getPool();
  const res = await runner.query(sql, params);
  return { rowCount: res.rowCount ?? 0, rows: res.rows };
}

/**
 * Run fn(client) inside a transaction. Commits on success, rolls back on throw.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

/** @deprecated Use withTransaction. Kept as alias during migration. */
export const tx = withTransaction;
