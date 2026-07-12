import { query, queryOne } from '../db/connection.js';
import { creatorTypeIdByName, fieldIdByName } from './itemRepo.js';
import { JOURNAL_WHITELIST } from '../services/journalWhitelist.js';

function creatorDisplayName({ firstName, lastName, fieldMode }) {
  if (fieldMode === 1 || !firstName) return lastName || '';
  return `${lastName || ''}, ${firstName || ''}`.trim().replace(/^,\s*/, '');
}

const PAPER_BUCKETS = [
  { id: '1', min: 1, max: 1, label: '1 篇' },
  { id: '2-3', min: 2, max: 3, label: '2–3 篇' },
  { id: '4-9', min: 4, max: 9, label: '4–9 篇' },
  { id: '10-19', min: 10, max: 19, label: '10–19 篇' },
  { id: '20+', min: 20, max: Infinity, label: '20+ 篇' },
];

const COLLAB_BUCKETS = [
  { id: '1', min: 1, max: 1, label: '独著' },
  { id: '2', min: 2, max: 2, label: '2 人' },
  { id: '3-4', min: 3, max: 4, label: '3–4 人' },
  { id: '5-8', min: 5, max: 8, label: '5–8 人' },
  { id: '9+', min: 9, max: Infinity, label: '9+ 人' },
];

function bucketCount(buckets, value) {
  const b = buckets.find((x) => value >= x.min && value <= x.max);
  return b ? b.id : null;
}

/**
 * Co-authorship graph for creators with at least minPapers items.
 */
export async function getCoauthorGraph({ minPapers = 1 } = {}) {
  const authorTypeId = await creatorTypeIdByName('author');
  if (authorTypeId == null) return { nodes: [], edges: [] };

  const candidateRows = await query(`
    SELECT c."creatorID" AS id, c."firstName" AS "firstName", c."lastName" AS "lastName",
           c."fieldMode" AS "fieldMode", COUNT(*)::int AS "paperCount"
    FROM "itemCreators" ic
    JOIN creators c ON c."creatorID" = ic."creatorID"
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ic."creatorTypeID" = $1
      AND i.deleted = 0
      AND i."parentItemID" IS NULL
    GROUP BY c."creatorID"
    HAVING COUNT(*) >= $2
  `, [authorTypeId, minPapers]);

  if (candidateRows.length === 0) return { nodes: [], edges: [] };

  const nodes = candidateRows.map(r => ({
    id: r.id,
    name: creatorDisplayName(r),
    paperCount: r.paperCount,
  }));

  const candidateIds = candidateRows.map(r => r.id);
  const placeholders = candidateIds.map((_, i) => `$${i + 3}`).join(',');

  const edgeRows = await query(`
    SELECT ic1."creatorID" AS source, ic2."creatorID" AS target, COUNT(*)::int AS weight
    FROM "itemCreators" ic1
    JOIN "itemCreators" ic2 ON ic1."itemID" = ic2."itemID" AND ic1."creatorID" < ic2."creatorID"
    JOIN items i ON i."itemID" = ic1."itemID"
    WHERE ic1."creatorTypeID" = $1 AND ic2."creatorTypeID" = $2
      AND i.deleted = 0
      AND i."parentItemID" IS NULL
      AND ic1."creatorID" IN (${placeholders})
      AND ic2."creatorID" IN (${placeholders})
    GROUP BY ic1."creatorID", ic2."creatorID"
  `, [authorTypeId, authorTypeId, ...candidateIds]);

  return { nodes, edges: edgeRows };
}

export async function getAuthorDetail(creatorId) {
  const creator = await queryOne(
    'SELECT "creatorID" AS id, "firstName", "lastName", "fieldMode" FROM creators WHERE "creatorID" = $1',
    [creatorId]
  );
  if (!creator) return null;

  const rows = await query(`
    SELECT DISTINCT i."itemID" AS "itemID"
    FROM "itemCreators" ic
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ic."creatorID" = $1 AND i.deleted = 0 AND i."parentItemID" IS NULL
  `, [creatorId]);

  return {
    id: creator.id,
    name: creatorDisplayName(creator),
    itemIds: rows.map(r => r.itemID),
  };
}

/**
 * Finer-grained author analytics for the dashboard:
 * top authors, creator-type mix, productivity histogram, collaboration-size
 * histogram, and per-Basket-journal core authors.
 */
export async function getAuthorAnalytics({ topN = 25, coreN = 5 } = {}) {
  const authorTypeId = await creatorTypeIdByName('author');

  const typeRows = await query(`
    SELECT ct."creatorType" AS type, COUNT(*)::int AS count
    FROM "itemCreators" ic
    JOIN "creatorTypes" ct ON ct."creatorTypeID" = ic."creatorTypeID"
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
    GROUP BY ct."creatorType"
    ORDER BY count DESC
  `);

  let topAuthors = [];
  let papersPerAuthor = PAPER_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: 0 }));
  let authorTotal = 0;
  let collabSize = COLLAB_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: 0 }));

  if (authorTypeId != null) {
    const authorRows = await query(`
      SELECT c."creatorID" AS id, c."firstName" AS "firstName", c."lastName" AS "lastName",
             c."fieldMode" AS "fieldMode", COUNT(*)::int AS "paperCount"
      FROM "itemCreators" ic
      JOIN creators c ON c."creatorID" = ic."creatorID"
      JOIN items i ON i."itemID" = ic."itemID"
      WHERE ic."creatorTypeID" = $1
        AND i.deleted = 0
        AND i."parentItemID" IS NULL
      GROUP BY c."creatorID"
      ORDER BY "paperCount" DESC, c."lastName" ASC
    `, [authorTypeId]);

    authorTotal = authorRows.length;
    topAuthors = authorRows.slice(0, topN).map((r) => ({
      id: r.id,
      name: creatorDisplayName(r),
      paperCount: r.paperCount,
    }));

    const paperHist = Object.fromEntries(papersPerAuthor.map((b) => [b.id, 0]));
    for (const r of authorRows) {
      const id = bucketCount(PAPER_BUCKETS, r.paperCount);
      if (id) paperHist[id] += 1;
    }
    papersPerAuthor = PAPER_BUCKETS.map((b) => ({
      id: b.id,
      label: b.label,
      count: paperHist[b.id] || 0,
    }));

    const sizeRows = await query(`
      SELECT authors, COUNT(*)::int AS papers
      FROM (
        SELECT ic."itemID", COUNT(DISTINCT ic."creatorID")::int AS authors
        FROM "itemCreators" ic
        JOIN items i ON i."itemID" = ic."itemID"
        WHERE ic."creatorTypeID" = $1
          AND i.deleted = 0
          AND i."parentItemID" IS NULL
        GROUP BY ic."itemID"
      ) t
      GROUP BY authors
      ORDER BY authors
    `, [authorTypeId]);

    const collabHist = Object.fromEntries(COLLAB_BUCKETS.map((b) => [b.id, 0]));
    for (const r of sizeRows) {
      const id = bucketCount(COLLAB_BUCKETS, r.authors);
      if (id) collabHist[id] += r.papers;
    }
    collabSize = COLLAB_BUCKETS.map((b) => ({
      id: b.id,
      label: b.label,
      count: collabHist[b.id] || 0,
    }));
  }

  const pubFieldId = await fieldIdByName('publicationTitle');
  let journalCores = [];
  if (authorTypeId != null && pubFieldId) {
    journalCores = await Promise.all(JOURNAL_WHITELIST.map(async (journal) => {
      const rows = await query(`
        SELECT c."creatorID" AS id, c."firstName" AS "firstName", c."lastName" AS "lastName",
               c."fieldMode" AS "fieldMode", COUNT(*)::int AS "paperCount"
        FROM "itemCreators" ic
        JOIN creators c ON c."creatorID" = ic."creatorID"
        JOIN items i ON i."itemID" = ic."itemID"
        JOIN "itemData" d ON d."itemID" = i."itemID" AND d."fieldID" = $1
        JOIN "itemDataValues" v ON v."valueID" = d."valueID"
        WHERE ic."creatorTypeID" = $2
          AND v.value = $3
          AND i.deleted = 0
          AND i."parentItemID" IS NULL
        GROUP BY c."creatorID"
        ORDER BY "paperCount" DESC, c."lastName" ASC
        LIMIT $4
      `, [pubFieldId, authorTypeId, journal, coreN]);

      return {
        journal,
        authors: rows.map((r) => ({
          id: r.id,
          name: creatorDisplayName(r),
          paperCount: r.paperCount,
        })),
      };
    }));
  }

  return {
    authorTotal,
    topAuthors,
    creatorTypes: typeRows,
    papersPerAuthor,
    collabSize,
    journalCores,
  };
}
