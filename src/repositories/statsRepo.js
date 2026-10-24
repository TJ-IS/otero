import { query, queryOne } from '../db/connection.js';
import { appendDoiRequiredForArticles, fieldIdByName, listJournals } from './itemRepo.js';
import { getFullTextCounts } from './fulltextRepo.js';
import { JOURNAL_WHITELIST, UNFILED, classifyJournal } from '../services/journalWhitelist.js';
import { doiCompareKey, getTargetDoiKeys } from '../services/targetDois.js';
import {
  basketJournalOrder,
  inferJournalFromDoi,
  inferYearFromDoi,
} from '../services/targetDoiMeta.js';

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

function emptyOverview() {
  return {
    totalItems: 0,
    totalCreators: 0,
    journalCount: JOURNAL_WHITELIST.length,
    withDoi: 0,
    withAttachment: 0,
  };
}

async function basketScope(itemAlias = 'i') {
  const jfid = await fieldIdByName('publicationTitle');
  if (!jfid) return null;
  const placeholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 2}`).join(',');
  const where = [
    `EXISTS (
      SELECT 1 FROM "itemData" scope_d
      JOIN "itemDataValues" scope_v ON scope_v."valueID" = scope_d."valueID"
      WHERE scope_d."itemID" = ${itemAlias}."itemID"
        AND scope_d."fieldID" = $1
        AND scope_v.value IN (${placeholders})
    )`,
  ];
  const params = [jfid, ...JOURNAL_WHITELIST];
  await appendDoiRequiredForArticles(where, params, params.length + 1, itemAlias);
  return {
    sql: where.join(' AND '),
    params,
  };
}

export async function getOverviewStats({ basketOnly = false } = {}) {
  // Return all overview counters in one database round trip. This matters for
  // hosted PostgreSQL where four serial COUNT queries are dominated by latency.
  let extra = 'TRUE';
  let params = [];
  if (basketOnly) {
    const scope = await basketScope('i');
    if (!scope) return emptyOverview();
    extra = scope.sql;
    params = scope.params;
  }

  const row = await queryOne(
    `
    SELECT
      (SELECT COUNT(*)::int
       FROM items i
       WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${extra}) AS "totalItems",
      (SELECT COUNT(DISTINCT ic."creatorID")::int
       FROM "itemCreators" ic
       JOIN items i ON i."itemID" = ic."itemID"
       WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${extra}) AS "totalCreators",
      (SELECT COUNT(*)::int
       FROM "itemData" d
       JOIN fields f ON f."fieldID" = d."fieldID" AND f."fieldName" = 'DOI'
       JOIN items i ON i."itemID" = d."itemID"
       WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${extra}) AS "withDoi",
      (SELECT COUNT(DISTINCT ia."parentItemID")::int
       FROM "itemAttachments" ia
       JOIN items i ON i."itemID" = ia."parentItemID"
       WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${extra}) AS "withAttachment"
  `,
    params,
  );

  return {
    totalItems: row?.totalItems ?? 0,
    totalCreators: row?.totalCreators ?? 0,
    journalCount: JOURNAL_WHITELIST.length,
    withDoi: row?.withDoi ?? 0,
    withAttachment: row?.withAttachment ?? 0,
  };
}

export async function getItemTypeDistribution({ basketOnly = false } = {}) {
  let extra = 'TRUE';
  let params = [];
  if (basketOnly) {
    const scope = await basketScope('i');
    if (!scope) return [];
    extra = scope.sql;
    params = scope.params;
  }
  return query(
    `
    SELECT it."typeName" AS "itemType", COUNT(*)::int AS count
    FROM items i
    JOIN "itemTypes" it ON it."itemTypeID" = i."itemTypeID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL AND ${extra}
    GROUP BY it."typeName"
    ORDER BY count DESC
  `,
    params,
  );
}

export async function getPublicationYearHistogram({ basketOnly = false } = {}) {
  const dateFieldId = await fieldIdByName('date');
  if (!dateFieldId) return [];

  let extra = 'TRUE';
  const params = [dateFieldId];
  if (basketOnly) {
    const jfid = await fieldIdByName('publicationTitle');
    if (!jfid) return [];
    const placeholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 3}`).join(',');
    extra = `EXISTS (
      SELECT 1 FROM "itemData" scope_d
      JOIN "itemDataValues" scope_v ON scope_v."valueID" = scope_d."valueID"
      WHERE scope_d."itemID" = i."itemID"
        AND scope_d."fieldID" = $2
        AND scope_v.value IN (${placeholders})
    )`;
    params.push(jfid, ...JOURNAL_WHITELIST);
    const doiWhere = [];
    await appendDoiRequiredForArticles(doiWhere, params, params.length + 1);
    if (doiWhere.length) extra = `${extra} AND ${doiWhere[0]}`;
  }

  const rows = await query(
    `
    SELECT v.value AS date
    FROM "itemData" d
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    JOIN items i ON i."itemID" = d."itemID"
    WHERE d."fieldID" = $1 AND i.deleted = 0 AND i."parentItemID" IS NULL AND ${extra}
  `,
    params,
  );

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
  if (!jfid || !dateFieldId) return journals.map((j) => ({ ...j, years: [] }));

  const placeholders = JOURNAL_WHITELIST.map((_, i) => `$${i + 3}`).join(',');

  return Promise.all(
    journals.map(async (j) => {
      let rows;
      if (j.name === UNFILED) {
        rows = await query(
          `
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
      `,
          [dateFieldId, jfid, ...JOURNAL_WHITELIST],
        );
      } else {
        rows = await query(
          `
        SELECT v2.value AS date
        FROM "itemData" d1
        JOIN "itemDataValues" v1 ON v1."valueID" = d1."valueID"
        JOIN items i ON i."itemID" = d1."itemID"
        JOIN "itemData" d2 ON d2."itemID" = i."itemID" AND d2."fieldID" = $1
        JOIN "itemDataValues" v2 ON v2."valueID" = d2."valueID"
        WHERE d1."fieldID" = $2 AND v1.value = $3
          AND i.deleted = 0 AND i."parentItemID" IS NULL
      `,
          [dateFieldId, jfid, j.name],
        );
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
    }),
  );
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

/** Unique normalized DOI keys present in the library (non-deleted top-level items). */
async function getCollectedDoiKeys() {
  const doiFieldId = await fieldIdByName('DOI');
  const collectedKeys = new Set();
  if (!doiFieldId) return collectedKeys;

  const rows = await query(
    `
    SELECT v.value AS doi
    FROM "itemData" d
    JOIN "itemDataValues" v ON v."valueID" = d."valueID"
    JOIN items i ON i."itemID" = d."itemID"
    WHERE d."fieldID" = $1
      AND i.deleted = 0
      AND i."parentItemID" IS NULL
  `,
    [doiFieldId],
  );
  for (const r of rows) {
    const key = doiCompareKey(r.doi);
    if (key) collectedKeys.add(key);
  }
  return collectedKeys;
}

/**
 * AIS Basket target list (target_dois.txt) vs DOIs already in the library.
 * All counts are unique normalized DOI keys.
 */
export async function getDoiCoverageStats() {
  const targetKeys = getTargetDoiKeys();
  const collectedKeys = await getCollectedDoiKeys();

  let intersection = 0;
  for (const key of targetKeys) {
    if (collectedKeys.has(key)) intersection += 1;
  }

  const targetTotal = targetKeys.size;
  const collectedTotal = collectedKeys.size;
  const targetOnly = targetTotal - intersection;
  const collectedOnly = collectedTotal - intersection;
  const coveragePct = targetTotal === 0 ? 0 : Math.round((intersection / targetTotal) * 1000) / 10;

  return {
    targetTotal,
    collectedTotal,
    intersection,
    targetOnly,
    collectedOnly,
    coveragePct,
  };
}

/**
 * Library DOI → { journal (Basket or UNFILED), year } for coverage joins.
 */
async function getLibraryDoiMetaMap() {
  const doiFieldId = await fieldIdByName('DOI');
  const pubFieldId = await fieldIdByName('publicationTitle');
  const dateFieldId = await fieldIdByName('date');
  const map = new Map();
  if (!doiFieldId) return map;

  const rows = await query(
    `
    SELECT
      v_doi.value AS doi,
      v_pub.value AS "publicationTitle",
      v_date.value AS date
    FROM "itemData" d_doi
    JOIN "itemDataValues" v_doi ON v_doi."valueID" = d_doi."valueID"
    JOIN items i ON i."itemID" = d_doi."itemID"
    LEFT JOIN "itemData" d_pub
      ON d_pub."itemID" = i."itemID" AND d_pub."fieldID" = $2
    LEFT JOIN "itemDataValues" v_pub ON v_pub."valueID" = d_pub."valueID"
    LEFT JOIN "itemData" d_date
      ON d_date."itemID" = i."itemID" AND d_date."fieldID" = $3
    LEFT JOIN "itemDataValues" v_date ON v_date."valueID" = d_date."valueID"
    WHERE d_doi."fieldID" = $1
      AND i.deleted = 0
      AND i."parentItemID" IS NULL
  `,
    [doiFieldId, pubFieldId || -1, dateFieldId || -1],
  );

  for (const r of rows) {
    const key = doiCompareKey(r.doi);
    if (!key) continue;
    const journal = classifyJournal(r.publicationTitle);
    const year = extractYear(r.date) ?? inferYearFromDoi(key);
    // Prefer first occurrence; DOIs may duplicate across items
    if (!map.has(key)) map.set(key, { journal, year, inLibrary: true });
  }
  return map;
}

function emptyYearBucket(year) {
  return { year, target: 0, collected: 0, missing: 0 };
}

function emptyJournalBucket(name) {
  return {
    name,
    target: 0,
    collected: 0,
    missing: 0,
    coveragePct: 0,
    years: [],
  };
}

/**
 * AIS Basket target coverage broken down by journal and year.
 * Journal/year for library hits come from item metadata; missing DOIs use
 * DOI heuristics (see targetDoiMeta.js). Unrecognised missing DOIs land in
 * the `unattributed` bucket.
 */
export async function getDoiCoverageBreakdown() {
  const targetKeys = getTargetDoiKeys();
  const libraryMeta = await getLibraryDoiMetaMap();
  const order = basketJournalOrder();
  const byJournal = new Map(order.map((name) => [name, emptyJournalBucket(name)]));
  const unattributed = emptyJournalBucket('未识别');
  const yearMaps = new Map(order.map((name) => [name, new Map()]));
  const unattributedYears = new Map();

  function bumpYear(yearMap, year, field) {
    if (year == null) return;
    if (!yearMap.has(year)) yearMap.set(year, emptyYearBucket(year));
    yearMap.get(year)[field] += 1;
  }

  for (const key of targetKeys) {
    const lib = libraryMeta.get(key);
    const collected = Boolean(lib);
    let journal = lib?.journal && lib.journal !== UNFILED ? lib.journal : inferJournalFromDoi(key);
    if (journal && !byJournal.has(journal)) {
      // Library classified outside Basket — still attribute via DOI heuristic
      journal = inferJournalFromDoi(key);
    }
    const year = lib?.year ?? inferYearFromDoi(key);

    const bucket = journal && byJournal.has(journal) ? byJournal.get(journal) : unattributed;
    const ymap = journal && yearMaps.has(journal) ? yearMaps.get(journal) : unattributedYears;

    bucket.target += 1;
    if (collected) {
      bucket.collected += 1;
      bumpYear(ymap, year, 'target');
      bumpYear(ymap, year, 'collected');
    } else {
      bucket.missing += 1;
      bumpYear(ymap, year, 'target');
      bumpYear(ymap, year, 'missing');
    }
  }

  function finalize(bucket, yearMap) {
    bucket.coveragePct =
      bucket.target === 0 ? 0 : Math.round((bucket.collected / bucket.target) * 1000) / 10;
    bucket.years = [...yearMap.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
    return bucket;
  }

  const journals = order.map((name) => finalize(byJournal.get(name), yearMaps.get(name)));
  const unattributedFinal = finalize(unattributed, unattributedYears);

  return {
    journals,
    unattributed: unattributedFinal.target > 0 ? unattributedFinal : null,
    targetTotal: targetKeys.size,
    collectedTotal: [...targetKeys].filter((k) => libraryMeta.has(k)).length,
  };
}

/**
 * DOIs in AIS Basket target list that are not yet in the library.
 * Optional journal/year filters use the same attribution rules as the breakdown.
 * Sorted lexicographically for stable UI display / copy-paste.
 *
 * @param {{ journal?: string|null, year?: number|null }} [filters]
 */
export async function getMissingTargetDois({ journal = null, year = null } = {}) {
  const targetKeys = getTargetDoiKeys();
  const libraryMeta = await getLibraryDoiMetaMap();
  const yearNum = year == null || year === '' ? null : Number(year);
  const dois = [];

  for (const key of targetKeys) {
    if (libraryMeta.has(key)) continue;

    const inferredJournal = inferJournalFromDoi(key);
    const inferredYear = inferYearFromDoi(key);

    if (journal) {
      if (journal === '未识别') {
        if (inferredJournal) continue;
      } else if (inferredJournal !== journal) {
        continue;
      }
    }
    if (yearNum != null && !Number.isNaN(yearNum)) {
      if (inferredYear !== yearNum) continue;
    }
    dois.push(key);
  }

  dois.sort();
  return {
    total: dois.length,
    dois,
    journal: journal || null,
    year: yearNum != null && !Number.isNaN(yearNum) ? yearNum : null,
  };
}
