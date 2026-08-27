import { query, queryOne } from '../db/connection.js';
import {
  creatorTypeIdByName,
  fieldIdByName,
  appendItemScopeFilters,
  itemTypeIdByName,
} from './itemRepo.js';
import { JOURNAL_WHITELIST } from '../services/journalWhitelist.js';
import { analyzeUndirectedGraph } from '../services/graphAnalysis.js';

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

function emptyCoauthorGraph({
  minPapers, minCollaborations, maxNodes, journal, yearFrom, yearTo,
} = {}) {
  return {
    nodes: [],
    edges: [],
    communities: [],
    meta: {
      nodeCount: 0,
      eligibleNodeCount: 0,
      edgeCount: 0,
      communityCount: 0,
      componentCount: 0,
      largestComponentSize: 0,
      isolatedNodeCount: 0,
      density: 0,
      modularity: 0,
      truncated: false,
      metricScope: 'displayed-network',
      filters: { minPapers, minCollaborations, maxNodes, journal, yearFrom, yearTo },
    },
  };
}

/**
 * Basket-scoped co-authorship graph plus metrics for the displayed induced
 * network. Filtering happens before paper counts and edge weights are built.
 */
export async function getCoauthorGraph({
  minPapers = 1,
  minCollaborations = 1,
  maxNodes = 600,
  journal,
  yearFrom,
  yearTo,
  basketOnly = true,
  requireDoiForArticles = false,
} = {}) {
  const authorTypeId = await creatorTypeIdByName('author');
  const filterMeta = {
    minPapers, minCollaborations, maxNodes, journal: journal || null,
    yearFrom: yearFrom ?? null, yearTo: yearTo ?? null,
  };
  if (authorTypeId == null) return emptyCoauthorGraph(filterMeta);

  const candidateWhere = ['i.deleted = 0', 'i."parentItemID" IS NULL'];
  const candidateParams = [authorTypeId, minPapers, maxNodes];
  const nextParam = await appendItemScopeFilters(candidateWhere, candidateParams, 4, {
    journal, yearFrom, yearTo, basketOnly, requireDoiForArticles,
  });
  if (nextParam == null) return emptyCoauthorGraph(filterMeta);

  const candidateRows = await query(`
    SELECT c."creatorID" AS id, c."firstName", c."lastName", c."fieldMode",
           COUNT(DISTINCT ic."itemID")::int AS "paperCount",
           COUNT(*) OVER()::int AS "eligibleCount"
    FROM "itemCreators" ic
    JOIN creators c ON c."creatorID" = ic."creatorID"
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ic."creatorTypeID" = $1
      AND ${candidateWhere.join(' AND ')}
    GROUP BY c."creatorID"
    HAVING COUNT(DISTINCT ic."itemID") >= $2
    ORDER BY "paperCount" DESC, c."creatorID" ASC
    LIMIT $3
  `, candidateParams);

  const rawNodes = candidateRows.map((node) => ({
    id: node.id,
    name: creatorDisplayName(node),
    paperCount: Number(node.paperCount) || 0,
  }));
  if (rawNodes.length === 0) return emptyCoauthorGraph(filterMeta);

  const candidateIds = rawNodes.map((node) => node.id);
  const edgeWhere = ['i.deleted = 0', 'i."parentItemID" IS NULL'];
  const edgeParams = [authorTypeId, candidateIds, minCollaborations];
  const edgeNextParam = await appendItemScopeFilters(edgeWhere, edgeParams, 4, {
    journal, yearFrom, yearTo, basketOnly, requireDoiForArticles,
  });
  if (edgeNextParam == null) return emptyCoauthorGraph(filterMeta);
  const edgeRows = await query(`
    SELECT ic1."creatorID" AS source, ic2."creatorID" AS target,
           COUNT(DISTINCT ic1."itemID")::int AS weight
    FROM "itemCreators" ic1
    JOIN "itemCreators" ic2
      ON ic1."itemID" = ic2."itemID" AND ic1."creatorID" < ic2."creatorID"
    JOIN items i ON i."itemID" = ic1."itemID"
    WHERE ic1."creatorTypeID" = $1 AND ic2."creatorTypeID" = $1
      AND ic1."creatorID" = ANY($2::int[])
      AND ic2."creatorID" = ANY($2::int[])
      AND ${edgeWhere.join(' AND ')}
    GROUP BY ic1."creatorID", ic2."creatorID"
    HAVING COUNT(DISTINCT ic1."itemID") >= $3
    ORDER BY weight DESC, source ASC, target ASC
  `, edgeParams);

  const paperCountById = new Map(rawNodes.map((node) => [node.id, node.paperCount]));
  const edges = edgeRows.map((edge) => {
    const weight = Number(edge.weight) || 0;
    const sourcePapers = paperCountById.get(edge.source) || 0;
    const targetPapers = paperCountById.get(edge.target) || 0;
    const union = sourcePapers + targetPapers - weight;
    return {
      source: edge.source,
      target: edge.target,
      weight,
      jaccard: union > 0 ? Number((weight / union).toFixed(6)) : 0,
      cosine: sourcePapers > 0 && targetPapers > 0
        ? Number((weight / Math.sqrt(sourcePapers * targetPapers)).toFixed(6))
        : 0,
    };
  });

  const analysis = analyzeUndirectedGraph(rawNodes, edges);
  const eligibleNodeCount = Number(candidateRows[0]?.eligibleCount) || rawNodes.length;
  return {
    nodes: analysis.nodes,
    edges,
    communities: analysis.communities,
    meta: {
      ...analysis.stats,
      eligibleNodeCount,
      truncated: eligibleNodeCount > rawNodes.length,
      metricScope: 'displayed-network',
      filters: filterMeta,
    },
  };
}

export async function getAuthorDetail(creatorId, { basketOnly = false, requireDoiForArticles = false } = {}) {
  const creator = await queryOne(
    'SELECT "creatorID" AS id, "firstName", "lastName", "fieldMode" FROM creators WHERE "creatorID" = $1',
    [creatorId]
  );
  if (!creator) return null;

  const where = [
    'ic."creatorID" = $1',
    'i.deleted = 0',
    'i."parentItemID" IS NULL',
  ];
  const params = [creatorId];
  const next = await appendItemScopeFilters(where, params, 2, { basketOnly, requireDoiForArticles });
  if (next == null) {
    return { id: creator.id, name: creatorDisplayName(creator), itemIds: [] };
  }

  const rows = await query(`
    SELECT DISTINCT i."itemID" AS "itemID"
    FROM "itemCreators" ic
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ${where.join(' AND ')}
  `, params);

  return {
    id: creator.id,
    name: creatorDisplayName(creator),
    itemIds: rows.map(r => r.itemID),
  };
}

/**
 * Keyword search authors with optional open-API scope filters.
 * paperCount reflects the filtered paper set (Basket by default).
 */
export async function searchAuthors({
  q, page = 1, pageSize = 20,
  journal, journals, yearFrom, yearTo, type, basketOnly = true,
  requireDoiForArticles = false,
} = {}) {
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const validPageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const empty = { items: [], total: 0, page: validPage, pageSize: validPageSize, totalPages: 0 };

  const needle = (q || '').trim();
  if (!needle) return empty;

  const where = [
    'i.deleted = 0',
    'i."parentItemID" IS NULL',
  ];
  const params = [];
  let p = 1;

  if (type) {
    const typeId = await itemTypeIdByName(type);
    if (typeId == null) return empty;
    where.push(`i."itemTypeID" = $${p++}`);
    params.push(typeId);
  }

  p = await appendItemScopeFilters(where, params, p, {
    journal, journals, yearFrom, yearTo, basketOnly, requireDoiForArticles,
  });
  if (p == null) return empty;

  const like = `%${needle}%`;
  const likeParam = p++;
  params.push(like);
  const nameMatch = `(
    COALESCE(c."firstName",'') || ' ' || COALESCE(c."lastName",'') ILIKE $${likeParam}
    OR c."lastName" ILIKE $${likeParam}
    OR c."firstName" ILIKE $${likeParam}
  )`;

  const itemWhere = where.join(' AND ');

  const countRow = await queryOne(`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT c."creatorID"
      FROM creators c
      JOIN "itemCreators" ic ON ic."creatorID" = c."creatorID"
      JOIN items i ON i."itemID" = ic."itemID"
      WHERE ${itemWhere} AND ${nameMatch}
      GROUP BY c."creatorID"
    ) t
  `, params);
  const total = countRow?.cnt || 0;
  if (total === 0) return empty;

  const offset = (validPage - 1) * validPageSize;
  const limitParam = p++;
  const offsetParam = p++;
  const rows = await query(`
    SELECT c."creatorID" AS id, c."firstName", c."lastName", c."fieldMode",
           COUNT(*)::int AS "paperCount"
    FROM creators c
    JOIN "itemCreators" ic ON ic."creatorID" = c."creatorID"
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ${itemWhere} AND ${nameMatch}
    GROUP BY c."creatorID"
    ORDER BY "paperCount" DESC, c."lastName" ASC, c."firstName" ASC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `, [...params, validPageSize, offset]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      name: creatorDisplayName(r),
      paperCount: r.paperCount,
    })),
    total,
    page: validPage,
    pageSize: validPageSize,
    totalPages: Math.ceil(total / validPageSize),
  };
}

/**
 * Paginated items for one author, with the same open-API scope filters.
 * Returns item IDs + author meta; caller loads Item JSON.
 */
export async function listAuthorItems({
  creatorId, page = 1, pageSize = 20,
  journal, journals, yearFrom, yearTo, type, basketOnly = true,
  requireDoiForArticles = false,
} = {}) {
  const validPage = Math.max(1, parseInt(page, 10) || 1);
  const validPageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));

  const creator = await queryOne(
    'SELECT "creatorID" AS id, "firstName", "lastName", "fieldMode" FROM creators WHERE "creatorID" = $1',
    [creatorId]
  );
  if (!creator) return null;

  const emptyResult = {
    id: creator.id,
    name: creatorDisplayName(creator),
    itemIds: [],
    total: 0,
    page: validPage,
    pageSize: validPageSize,
    totalPages: 0,
  };

  const where = [
    'i.deleted = 0',
    'i."parentItemID" IS NULL',
    'ic."creatorID" = $1',
  ];
  const params = [creatorId];
  let p = 2;

  if (type) {
    const typeId = await itemTypeIdByName(type);
    if (typeId == null) return emptyResult;
    where.push(`i."itemTypeID" = $${p++}`);
    params.push(typeId);
  }

  p = await appendItemScopeFilters(where, params, p, {
    journal, journals, yearFrom, yearTo, basketOnly, requireDoiForArticles,
  });
  if (p == null) return emptyResult;

  const itemWhere = where.join(' AND ');
  const countRow = await queryOne(`
    SELECT COUNT(DISTINCT i."itemID")::int AS cnt
    FROM "itemCreators" ic
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ${itemWhere}
  `, params);
  const total = countRow?.cnt || 0;
  if (total === 0) return emptyResult;

  const dateFid = await fieldIdByName('date');
  const offset = (validPage - 1) * validPageSize;
  const listParams = [...params];
  let rows;

  if (dateFid) {
    const dParam = p++;
    listParams.push(dateFid);
    const limitParam = p++;
    const offsetParam = p++;
    listParams.push(validPageSize, offset);
    rows = await query(`
      SELECT i."itemID" AS "itemID"
      FROM items i
      JOIN "itemCreators" ic ON ic."itemID" = i."itemID"
      LEFT JOIN "itemData" d_date ON d_date."itemID" = i."itemID" AND d_date."fieldID" = $${dParam}
      LEFT JOIN "itemDataValues" v_date ON v_date."valueID" = d_date."valueID"
      WHERE ${itemWhere}
      GROUP BY i."itemID", v_date.value, i."dateModified"
      ORDER BY SUBSTRING(COALESCE(v_date.value, ''), 1, 4) DESC NULLS LAST,
               i."dateModified" DESC, i."itemID" DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, listParams);
  } else {
    const limitParam = p++;
    const offsetParam = p++;
    listParams.push(validPageSize, offset);
    rows = await query(`
      SELECT i."itemID" AS "itemID"
      FROM items i
      JOIN "itemCreators" ic ON ic."itemID" = i."itemID"
      WHERE ${itemWhere}
      GROUP BY i."itemID", i."dateModified"
      ORDER BY i."dateModified" DESC, i."itemID" DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `, listParams);
  }

  return {
    id: creator.id,
    name: creatorDisplayName(creator),
    itemIds: rows.map((r) => r.itemID),
    total,
    page: validPage,
    pageSize: validPageSize,
    totalPages: Math.ceil(total / validPageSize),
  };
}

/**
 * Finer-grained author analytics for the dashboard:
 * top authors, creator-type mix, productivity histogram, collaboration-size
 * histogram, and per-Basket-journal core authors.
 */
export async function getAuthorAnalytics({ topN = 25, coreN = 5, basketOnly = false, requireDoiForArticles = false } = {}) {
  const authorTypeId = await creatorTypeIdByName('author');
  const itemWhere = ['i.deleted = 0', 'i."parentItemID" IS NULL'];
  const itemParams = [];
  const next = await appendItemScopeFilters(itemWhere, itemParams, 1, { basketOnly, requireDoiForArticles });
  if (next == null) {
    return {
      authorTotal: 0,
      topAuthors: [],
      creatorTypes: [],
      papersPerAuthor: PAPER_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: 0 })),
      collabSize: COLLAB_BUCKETS.map((b) => ({ id: b.id, label: b.label, count: 0 })),
      journalCores: JOURNAL_WHITELIST.map((journal) => ({ journal, authors: [] })),
    };
  }
  const itemSql = itemWhere.join(' AND ');

  const typeRows = await query(`
    SELECT ct."creatorType" AS type, COUNT(*)::int AS count
    FROM "itemCreators" ic
    JOIN "creatorTypes" ct ON ct."creatorTypeID" = ic."creatorTypeID"
    JOIN items i ON i."itemID" = ic."itemID"
    WHERE ${itemSql}
    GROUP BY ct."creatorType"
    ORDER BY count DESC
  `, itemParams);

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
      WHERE ic."creatorTypeID" = $${itemParams.length + 1}
        AND ${itemSql}
      GROUP BY c."creatorID"
      ORDER BY "paperCount" DESC, c."lastName" ASC
    `, [...itemParams, authorTypeId]);

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
        WHERE ic."creatorTypeID" = $${itemParams.length + 1}
          AND ${itemSql}
        GROUP BY ic."itemID"
      ) t
      GROUP BY authors
      ORDER BY authors
    `, [...itemParams, authorTypeId]);

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
