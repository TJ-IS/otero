import { getDb } from '../db/connection.js';
import { fieldIdByName } from './itemRepo.js';
import { listJournals } from './itemRepo.js';
import { getFullTextCounts } from './fulltextRepo.js';
import { JOURNAL_WHITELIST, UNFILED } from '../services/journalWhitelist.js';

// Mirrors the frontend's yearOf() regex (web/src/lib/items.js) so the two
// sides never disagree on what counts as "a year" inside a free-text date
// field.
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

/**
 * Top-line counts for the dashboard's overview cards.
 */
export function getOverviewStats() {
  const db = getDb();
  const totalItems = db.prepare(`
    SELECT COUNT(*) AS n FROM items WHERE deleted = 0 AND parentItemID IS NULL
  `).get().n;

  const totalCreators = db.prepare(`
    SELECT COUNT(DISTINCT ic.creatorID) AS n
    FROM itemCreators ic
    JOIN items i ON i.itemID = ic.itemID
    WHERE i.deleted = 0 AND i.parentItemID IS NULL
  `).get().n;

  const doiFieldId = fieldIdByName('DOI');
  const withDoi = doiFieldId ? db.prepare(`
    SELECT COUNT(*) AS n
    FROM itemData d
    JOIN items i ON i.itemID = d.itemID
    WHERE d.fieldID = ? AND i.deleted = 0 AND i.parentItemID IS NULL
  `).get(doiFieldId).n : 0;

  const withAttachment = db.prepare(`
    SELECT COUNT(DISTINCT ia.parentItemID) AS n
    FROM itemAttachments ia
    JOIN items i ON i.itemID = ia.parentItemID
    WHERE i.deleted = 0 AND i.parentItemID IS NULL
  `).get().n;

  const journalCount = JOURNAL_WHITELIST.length;

  return {
    totalItems,
    totalCreators,
    journalCount,
    withDoi,
    withAttachment,
  };
}

/**
 * Item-type distribution across top-level, non-deleted items.
 * Returns [{ itemType, count }], ordered by count descending.
 */
export function getItemTypeDistribution() {
  const db = getDb();
  return db.prepare(`
    SELECT it.typeName AS itemType, COUNT(*) AS count
    FROM items i
    JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
    WHERE i.deleted = 0 AND i.parentItemID IS NULL
    GROUP BY it.typeName
    ORDER BY count DESC
  `).all();
}

/**
 * Publication-year histogram over top-level, non-deleted items' `date`
 * field. Year extraction happens in JS (not SQL) so the logic can share the
 * exact same regex as the frontend's yearOf(), and so implausible years
 * (OCR/metadata noise like 1900 or 2052) can be dropped consistently.
 * Returns [{ year, count }], sorted by year ascending.
 */
export function getPublicationYearHistogram() {
  const db = getDb();
  const dateFieldId = fieldIdByName('date');
  if (!dateFieldId) return [];

  const rows = db.prepare(`
    SELECT v.value AS date
    FROM itemData d
    JOIN itemDataValues v ON v.valueID = d.valueID
    JOIN items i ON i.itemID = d.itemID
    WHERE d.fieldID = ? AND i.deleted = 0 AND i.parentItemID IS NULL
  `).all(dateFieldId);

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

/**
 * Per-journal item counts (reuses listJournals()) plus, for each journal,
 * its publication-year breakdown — used for the journal detail view's
 * per-journal timeline. Data volume (~8000 items) makes a per-journal pass
 * in JS cheap enough to do on every request rather than caching.
 */
export function getJournalBreakdown() {
  const db = getDb();
  const journals = listJournals();
  const jfid = fieldIdByName('publicationTitle');
  const dateFieldId = fieldIdByName('date');
  if (!jfid || !dateFieldId) return journals.map(j => ({ ...j, years: [] }));

  const yearsByJournalStmt = db.prepare(`
    SELECT v2.value AS date
    FROM itemData d1
    JOIN itemDataValues v1 ON v1.valueID = d1.valueID
    JOIN items i ON i.itemID = d1.itemID
    JOIN itemData d2 ON d2.itemID = i.itemID AND d2.fieldID = ?
    JOIN itemDataValues v2 ON v2.valueID = d2.valueID
    WHERE d1.fieldID = ? AND d1.itemID = i.itemID AND v1.value = ?
      AND i.deleted = 0 AND i.parentItemID IS NULL
  `);

  const placeholders = JOURNAL_WHITELIST.map(() => '?').join(',');
  const unfiledYearsStmt = db.prepare(`
    SELECT v.value AS date
    FROM itemData d
    JOIN itemDataValues v ON v.valueID = d.valueID
    JOIN items i ON i.itemID = d.itemID
    WHERE d.fieldID = ? AND i.deleted = 0 AND i.parentItemID IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM itemData d2
        JOIN itemDataValues v2 ON v2.valueID = d2.valueID
        WHERE d2.itemID = i.itemID AND d2.fieldID = ? AND v2.value IN (${placeholders})
      )
  `);

  return journals.map((j) => {
    const rows = j.name === UNFILED
      ? unfiledYearsStmt.all(dateFieldId, jfid, ...JOURNAL_WHITELIST)
      : yearsByJournalStmt.all(dateFieldId, jfid, j.name);
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
  });
}

/**
 * MinerU full-text parse state counts (reuses fulltextRepo.getFullTextCounts()).
 */
export function getFullTextStatusCounts() {
  return getFullTextCounts();
}

/**
 * Hourly bucketed MinerU submission/completion activity — an "operational"
 * timeline distinct from the bibliographic publication-year timeline. Useful
 * because dateAdded is nearly worthless for growth-over-time (the whole
 * corpus was bulk-imported in a two-day window); this instead shows the
 * actual full-text parsing throughput over time.
 * Returns [{ hour: 'YYYY-MM-DD HH:00', submitted, completed }].
 */
export function getIngestionActivity() {
  const db = getDb();
  const submitted = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', submittedAt) AS hour, COUNT(*) AS n
    FROM itemFullText
    WHERE submittedAt IS NOT NULL
    GROUP BY hour
  `).all();
  const completed = db.prepare(`
    SELECT strftime('%Y-%m-%d %H:00', completedAt) AS hour, COUNT(*) AS n
    FROM itemFullText
    WHERE completedAt IS NOT NULL
    GROUP BY hour
  `).all();

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
