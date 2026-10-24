import { getAddress, isAddress } from 'viem';
import { query, queryOne, execute } from '../db/connection.js';
import { nowUtc } from '../db/connection.js';
import { config } from '../config.js';

export const ACCOUNT_ROLES = ['user', 'admin'];

export function normalizeAddress(address) {
  if (!address || !isAddress(address)) return null;
  return getAddress(address);
}

export function isBootstrapAdmin(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  return config.auth.editorWhitelist.includes(normalized.toLowerCase());
}

export function getBootstrapAddresses() {
  return config.auth.editorWhitelist.map((addr) => normalizeAddress(addr)).filter(Boolean);
}

function rowToAccount(row) {
  if (!row) return null;
  return {
    accountID: row.accountID,
    address: row.address,
    role: row.role,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    canEdit: row.role === 'admin',
    bootstrap: isBootstrapAdmin(row.address),
  };
}

export async function getAccountByAddress(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const row = await queryOne('SELECT * FROM accounts WHERE lower(address) = lower($1)', [
    normalized,
  ]);
  return rowToAccount(row);
}

export async function getAccountById(accountID) {
  if (!accountID) return null;
  const row = await queryOne('SELECT * FROM accounts WHERE "accountID" = $1', [accountID]);
  return rowToAccount(row);
}

export async function countAdmins() {
  const row = await queryOne(`SELECT COUNT(*)::int AS n FROM accounts WHERE role = 'admin'`);
  return row?.n ?? 0;
}

/**
 * Get or create an account. Bootstrap whitelist wallets are always admin
 * and cannot be stored as a lower role.
 */
export async function ensureAccount(address) {
  const normalized = normalizeAddress(address);
  if (!normalized) throw new Error('invalid address');
  const bootstrap = isBootstrapAdmin(normalized);
  const existing = await getAccountByAddress(normalized);
  if (existing) {
    if (bootstrap && existing.role !== 'admin') {
      const updated = await queryOne(
        `UPDATE accounts SET role = 'admin' WHERE "accountID" = $1 RETURNING *`,
        [existing.accountID],
      );
      return rowToAccount(updated);
    }
    return existing;
  }
  const role = bootstrap ? 'admin' : 'user';
  const created = await queryOne(
    `INSERT INTO accounts (address, role, "createdAt")
     VALUES ($1, $2, $3)
     ON CONFLICT (address) DO UPDATE SET address = EXCLUDED.address
     RETURNING *`,
    [normalized, role, nowUtc()],
  );
  return rowToAccount(created);
}

export async function recordLogin(address) {
  const account = await ensureAccount(address);
  const updated = await queryOne(
    `UPDATE accounts SET "lastLoginAt" = $1 WHERE "accountID" = $2 RETURNING *`,
    [nowUtc(), account.accountID],
  );
  return rowToAccount(updated);
}

export async function seedBootstrapAdmins() {
  const addresses = getBootstrapAddresses();
  const seeded = [];
  for (const address of addresses) {
    seeded.push(await ensureAccount(address));
  }
  return seeded;
}

export async function listAccounts({ page = 1, pageSize = 50, q } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
  const offset = (safePage - 1) * safeSize;
  const params = [];
  let where = '';
  if (q && String(q).trim()) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where = `WHERE lower(address) LIKE $${params.length}`;
  }
  const countRow = await queryOne(`SELECT COUNT(*)::int AS n FROM accounts ${where}`, params);
  params.push(safeSize, offset);
  const rows = await query(
    `SELECT * FROM accounts ${where}
     ORDER BY "createdAt" DESC, "accountID" DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    accounts: rows.map(rowToAccount),
    total: countRow?.n ?? 0,
    page: safePage,
    pageSize: safeSize,
  };
}

export async function setAccountRole(address, role) {
  if (!ACCOUNT_ROLES.includes(role)) {
    const err = new Error('invalid role');
    err.status = 400;
    throw err;
  }
  const account = await getAccountByAddress(address);
  if (!account) {
    const err = new Error('account not found');
    err.status = 404;
    throw err;
  }
  if (account.role === role) return account;
  if (isBootstrapAdmin(account.address) && role !== 'admin') {
    const err = new Error('bootstrap admin cannot be demoted');
    err.status = 400;
    throw err;
  }
  if (account.role === 'admin' && role !== 'admin') {
    const admins = await countAdmins();
    if (admins <= 1) {
      const err = new Error('cannot demote the last admin');
      err.status = 400;
      throw err;
    }
  }
  const updated = await queryOne(
    `UPDATE accounts SET role = $1 WHERE "accountID" = $2 RETURNING *`,
    [role, account.accountID],
  );
  return rowToAccount(updated);
}
