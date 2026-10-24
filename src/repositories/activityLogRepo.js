import { query, queryOne } from '../db/connection.js';
import { nowUtc } from '../db/connection.js';

const QUERY_MAX = 500;
const UA_MAX = 400;
const PATH_MAX = 500;

export function redactQuery(raw) {
  if (!raw) return '';
  const params = new URLSearchParams(String(raw).replace(/^\?/, ''));
  if (params.has('sig')) params.set('sig', '[redacted]');
  if (params.has('signature')) params.set('signature', '[redacted]');
  if (params.has('token')) params.set('token', '[redacted]');
  const text = params.toString();
  return text.length > QUERY_MAX ? `${text.slice(0, QUERY_MAX)}…` : text;
}

export async function insertActivityLog({
  accountID = null,
  address = null,
  ip = null,
  userAgent = null,
  method = null,
  path = null,
  query: queryString = null,
  statusCode = null,
  durationMs = null,
  action,
  meta = null,
} = {}) {
  if (!action) return null;
  const row = await queryOne(
    `INSERT INTO "activityLogs" (
       "createdAt", "accountID", address, ip, "userAgent",
       method, path, query, "statusCode", "durationMs", action, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING "logID"`,
    [
      nowUtc(),
      accountID || null,
      address || null,
      ip ? String(ip).slice(0, 128) : null,
      userAgent ? String(userAgent).slice(0, UA_MAX) : null,
      method || null,
      path ? String(path).slice(0, PATH_MAX) : null,
      redactQuery(queryString),
      statusCode,
      durationMs,
      String(action).slice(0, 80),
      meta && typeof meta === 'object' ? meta : null,
    ],
  );
  return row;
}

export async function listActivityLogs({
  page = 1,
  pageSize = 50,
  address,
  action,
  path,
  from,
  to,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 50));
  const offset = (safePage - 1) * safeSize;
  const where = [];
  const params = [];
  if (address) {
    params.push(`%${String(address).toLowerCase()}%`);
    where.push(`lower(COALESCE(address, '')) LIKE $${params.length}`);
  }
  if (action) {
    params.push(String(action));
    where.push(`action = $${params.length}`);
  }
  if (path) {
    params.push(`%${String(path)}%`);
    where.push(`path LIKE $${params.length}`);
  }
  if (from) {
    params.push(String(from));
    where.push(`"createdAt" >= $${params.length}`);
  }
  if (to) {
    params.push(String(to));
    where.push(`"createdAt" <= $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRow = await queryOne(
    `SELECT COUNT(*)::int AS n FROM "activityLogs" ${clause}`,
    params,
  );
  params.push(safeSize, offset);
  const rows = await query(
    `SELECT * FROM "activityLogs" ${clause}
     ORDER BY "createdAt" DESC, "logID" DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    logs: rows,
    total: countRow?.n ?? 0,
    page: safePage,
    pageSize: safeSize,
  };
}

/** Fire-and-forget insert; never throws to callers. */
export function recordActivity(entry) {
  return insertActivityLog(entry).catch((err) => {
    console.warn('[activity]', err.message);
  });
}
