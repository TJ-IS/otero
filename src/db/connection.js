import Database from 'better-sqlite3';
import { config } from '../config.js';

let dbInstance = null;

/**
 * Returns the shared better-sqlite3 instance, opening the DB on first call.
 * Caller is responsible for invoking runMigrations() once at startup.
 */
export function getDb() {
  if (dbInstance) return dbInstance;
  dbInstance = new Database(config.dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  dbInstance.pragma('busy_timeout = 5000');
  return dbInstance;
}

/** For tests: inject an in-memory or custom db instance. */
export function setDb(instance) {
  dbInstance = instance;
}

/** Close the shared DB connection if open. */
export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** Run an arbitrary function inside a transaction. */
export function tx(fn) {
  const db = getDb();
  return db.transaction(fn)();
}
