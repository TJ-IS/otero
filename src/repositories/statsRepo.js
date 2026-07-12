import { query, queryOne } from '../db/connection.js';
import { fieldIdByName, listJournals } from './itemRepo.js';
import { getFullTextCounts } from './fulltextRepo.js';
import { JOURNAL_WHITELIST, UNFILED } from '../services/journalWhitelist.js';
import { doiCompareKey, getTargetDoiKeys } from '../services/targetDois.js';

const YEAR_RE = /\b(1[5-9]|20)\d{2}\b/;
const MIN_PLAUSIBLE_YEAR = 1990;

function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(YEAR_RE);
  if (!m) return null;
  const year = Number(m[0]);
  const maxPlausible = new Date().getFullYear() + 1;
  if (year < MIN_PLAUSIBLE_YEAR || year > maxPlausible) return null;
  return year;
}

export async function getOverviewStats() {
  const totalItems = (await queryOne(`
    SELECT COUNT(*)::int AS n FROM items WHERE deleted = 0 AND "parentItemID" IS NULL
  `)).n;

  const totalCreators = (await queryOne(`
    SELECT COUNT(DISTINCT ic."creatorID")::int AS n
    FROM "itemCreators" ic
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
  `)).n;

  const doiFieldId = await fieldIdByName('DOI');
  const withDoi = doiFieldId ? (await queryOne(`
    SELECT COUNT(*)::int AS n
    FROM "itemData" d
    JOIN items i ON i."itemID" = d."itemID"
    WHERE d."fieldID" = $1 AND i.deleted = 0 AND i."parentItemID" IS NULL
  `, [doiFieldId])).n : 0;

  const withAttachment = (await queryOne(`
    SELECT COUNT(DISTINCT ia."parentItemID")::int AS n
    FROM "itemAttachments" ia
    JOIN items i ON i."itemID" = ia."parentItemID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
  `)).n;

  return {
    totalItems,
    totalCreators,
    journalCount: JOURNAL_WHITELIST.length,
    withDoi,
    withAttachment,
  };
}

export async function getItemTypeDistribution() {
  return query(`
    SELECT it."typeName" AS "itemType", COUNT(*)::int AS count
    FROM items i
    JOIN "itemTypes" it ON it."itemTypeID" = i."itemTypeID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
    GROUP BY it."typeName"
    ORDER BY count DESC
  `);
}

export async function getPublicationYearHistogram() {
  const dateFieldId = await fieldIdByName('date');
  if (!dateFieldId) return [];

  const rows = await query(`
    SELECT v.value AS date
    FROM "itemData" d
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    JOIN items i ON i."itemID" = d."itemID"
    WHERE d."fieldID" = $1 AND i.deleted = 0 AND i."parentItemID" IS NULL
  `, [dateFieldId]);

  const counts = new Map();
  for (const r of rows) {
    const year = extractYear(r.date);
    if (year == null) continue;
    counts.set(year, (counts.get(year) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, count }));
}

export async function getJournalBreakdown() {
  const journals = await listJournals();
  const jfid = await fieldIdByName('publicationTitle');
  const dateFieldId = await fieldIdByName('date');
  if (!jfid || !dateFieldId) return journals.map(j => ({ ...j, years: [] }));

  const placeholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 3}`).join(',');

  return Promise.all(journals.map(async (j) => {
    let rows;
    if (j.name === UNFILED) {
      rows = await query(`
        SELECT v.value AS date
        FROM "itemData" d
        JOIN "itemDataValues" v ON v."valueID" = d."valueID"
        JOIN items i ON i."itemID" = d."itemID"
        WHERE d."fieldID" = $1 AND i.deleted = 0 AND i."parentItemID" IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM "itemData" d2
            JOIN "itemDataValues" v2 ON v2."valueID" = d2."valueID"
            WHERE d2."itemID" = i."itemID" AND d2."fieldID" = $2 AND v2.value IN (${placeholders})
          )
      `, [dateFieldId, jfid, ...JOURNAL_WHITELIST]);
    } else {
      rows = await query(`
        SELECT v2.value AS date
        FROM "itemData" d1
        JOIN "itemDataValues" v1 ON v1."valueID" = d1."valueID"
        JOIN items i ON i."itemID" = d1."itemID"
        JOIN "itemData" d2 ON d2."itemID" = i."itemID" AND d2."fieldID" = $1
        JOIN "itemDataValues" v2 ON v2."valueID" = d2."valueID"
        WHERE d1."fieldID" = $2 AND v1.value = $3
          AND i.deleted = 0 AND i."parentItemID" IS NULL
      `, [dateFieldId, jfid, j.name]);
    }
    const counts = new Map();
    for (const r of rows) {
      const year = extractYear(r.date);
      if (year == null) continue;
      counts.set(year, (counts.get(year) || 0) + 1);
    }
    const years = [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, count]) => ({ year, count }));
    return { ...j, years };
  }));
}

export async function getFullTextStatusCounts() {
  return getFullTextCounts();
}

export async function getIngestionActivity() {
  // submittedAt/completedAt are TEXT timestamps; truncate to hour via substring.
  const submitted = await query(`
    SELECT substring("submittedAt" from 1 for 13) || ':00' AS hour, COUNT(*)::int AS n
    FROM "itemFullText"
    WHERE "submittedAt" IS NOT NULL AND length("submittedAt") >= 13
    GROUP BY hour
  `);
  const completed = await query(`
    SELECT substring("completedAt" from 1 for 13) || ':00' AS hour, COUNT(*)::int AS n
    FROM "itemFullText"
    WHERE "completedAt" IS NOT NULL AND length("completedAt") >= 13
    GROUP BY hour
  `);

  const byHour = new Map();
  for (const r of submitted) {
    byHour.set(r.hour, { hour: r.hour, submitted: r.n, completed: 0 });
  }
  for (const r of completed) {
    const existing = byHour.get(r.hour);
    if (existing) existing.completed = r.n;
    else byHour.set(r.hour, { hour: r.hour, submitted: 0, completed: r.n });
  }

  return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

/**
 * AIS Basket target list (target_dois.txt) vs DOIs already in the library.
 * All counts are unique normalized DOI keys.
 */
export async function getDoiCoverageStats() {
  const targetKeys = getTargetDoiKeys();
  const doiFieldId = await fieldIdByName('DOI');

  const collectedKeys = new Set();
  if (doiFieldId) {
    const rows = await query(`
      SELECT v.value AS doi
      FROM "itemData" d
      JOIN "itemDataValues" v ON v."valueID" = d."valueID"
      JOIN items i ON i."itemID" = d."itemID"
      WHERE d."fieldID" = $1
        AND i.deleted = 0
        AND i."parentItemID" IS NULL
    `, [doiFieldId]);
    for (const r of rows) {
      const key = doiCompareKey(r.doi);
      if (key) collectedKeys.add(key);
    }
  }

  let intersection = 0;
  for (const key of targetKeys) {
    if (collectedKeys.has(key)) intersection += 1;
  }

  const targetTotal = targetKeys.size;
  const collectedTotal = collectedKeys.size;
  const targetOnly = targetTotal - intersection;
  const collectedOnly = collectedTotal - intersection;
  const coveragePct = targetTotal === 0
    ? 0
    : Math.round((intersection / targetTotal) * 1000) / 10;

  return {
    targetTotal,
    collectedTotal,
    intersection,
    targetOnly,
    collectedOnly,
    coveragePct,
  };
}
