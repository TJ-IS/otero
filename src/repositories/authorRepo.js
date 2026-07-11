import { query, queryOne } from '../db/connection.js';
import { creatorTypeIdByName } from './itemRepo.js';

function creatorDisplayName({ firstName, lastName, fieldMode }) {
  if (fieldMode === 1 || !firstName) return lastName || '';
  return `${lastName || ''}, ${firstName || ''}`.trim().replace(/^,\s*/, '');
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

  // Reuse the same $n placeholders for both IN lists (pass candidateIds once).
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
