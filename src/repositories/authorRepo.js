import { getDb } from '../db/connection.js';
import { creatorTypeIdByName } from './itemRepo.js';

// Mirrors web/src/lib/items.js creatorDisplay(): "Last, First" unless the
// creator is a single-field name (fieldMode=1) or has no firstName.
function creatorDisplayName({ firstName, lastName, fieldMode }) {
  if (fieldMode === 1 || !firstName) return lastName || '';
  return `${lastName || ''}, ${firstName || ''}`.trim().replace(/^,\s*/, '');
}

/**
 * Compute the co-authorship graph: nodes are creators (creatorType='author')
 * with at least `minPapers` top-level, non-deleted items; edges connect two
 * such creators for each shared item, weighted by the number of shared items.
 *
 * Returns { nodes: [{ id, name, paperCount }], edges: [{ source, target, weight }] }.
 */
export function getCoauthorGraph({ minPapers = 1 } = {}) {
  const db = getDb();
  const authorTypeId = creatorTypeIdByName('author');
  if (authorTypeId == null) return { nodes: [], edges: [] };

  const candidateRows = db.prepare(`
    SELECT c.creatorID AS id, c.firstName AS firstName, c.lastName AS lastName,
           c.fieldMode AS fieldMode, COUNT(*) AS paperCount
    FROM itemCreators ic
    JOIN creators c ON c.creatorID = ic.creatorID
    JOIN items i ON i.itemID = ic.itemID
    WHERE ic.creatorTypeID = ?
      AND i.deleted = 0
      AND i.parentItemID IS NULL
    GROUP BY c.creatorID
    HAVING COUNT(*) >= ?
  `).all(authorTypeId, minPapers);

  if (candidateRows.length === 0) return { nodes: [], edges: [] };

  const nodes = candidateRows.map(r => ({
    id: r.id,
    name: creatorDisplayName(r),
    paperCount: r.paperCount,
  }));

  const candidateIds = candidateRows.map(r => r.id);
  const placeholders = candidateIds.map(() => '?').join(',');

  const edgeRows = db.prepare(`
    SELECT ic1.creatorID AS source, ic2.creatorID AS target, COUNT(*) AS weight
    FROM itemCreators ic1
    JOIN itemCreators ic2 ON ic1.itemID = ic2.itemID AND ic1.creatorID < ic2.creatorID
    JOIN items i ON i.itemID = ic1.itemID
    WHERE ic1.creatorTypeID = ? AND ic2.creatorTypeID = ?
      AND i.deleted = 0
      AND i.parentItemID IS NULL
      AND ic1.creatorID IN (${placeholders})
      AND ic2.creatorID IN (${placeholders})
    GROUP BY ic1.creatorID, ic2.creatorID
  `).all(authorTypeId, authorTypeId, ...candidateIds, ...candidateIds);

  return { nodes, edges: edgeRows };
}

/**
 * Look up a single author by creatorID plus the itemIDs of all their
 * top-level, non-deleted items (any item type, not just journalArticle).
 * Returns null if the creatorID doesn't exist.
 */
export function getAuthorDetail(creatorId) {
  const db = getDb();
  const creator = db.prepare(
    'SELECT creatorID AS id, firstName, lastName, fieldMode FROM creators WHERE creatorID = ?'
  ).get(creatorId);
  if (!creator) return null;

  const itemIds = db.prepare(`
    SELECT DISTINCT i.itemID AS itemID
    FROM itemCreators ic
    JOIN items i ON i.itemID = ic.itemID
    WHERE ic.creatorID = ? AND i.deleted = 0 AND i.parentItemID IS NULL
  `).all(creatorId).map(r => r.itemID);

  return { id: creator.id, name: creatorDisplayName(creator), itemIds };
}
