/**
 * Admin API routes for whitelist management.
 * Requires editor authentication.
 */
import { Router } from 'express';
import {
  checkDuplicates,
  getAllDuplicates,
  getPostgresStatus,
  getR2Status,
  getSystemStatus,
  getTrash,
  emptyTrash,
  reconcileStorage,
  deleteOrphanObjects,
} from '../../services/adminService.js';
import {
  listAccounts,
  setAccountRole,
  getAccountByAddress,
  getBootstrapAddresses,
} from '../../repositories/accountRepo.js';
import { listActivityLogs, recordActivity } from '../../repositories/activityLogRepo.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const adminRouter = Router();

/**
 * GET /api/admin/duplicates
 * Find duplicate items in the database.
 *
 * Query params:
 *   - doi: specific DOI to check
 *   - title: specific title to check
 *   - author: author name to search
 *   - limit: max results (default 50)
 *
 * Without params, returns all duplicate groups.
 */
adminRouter.get('/duplicates', async (req, res, next) => {
  try {
    const { doi, title, author, limit } = req.query;

    // If no specific search params, return all duplicates
    if (!doi && !title && !author) {
      const result = await getAllDuplicates();
      return res.json(result);
    }

    // Otherwise, search for specific duplicates
    const result = await checkDuplicates({
      doi,
      title,
      author,
      limit: limit ? parseInt(limit) : 50,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/duplicates/check
 * Check if a new item would be a duplicate before importing.
 *
 * Body:
 *   { doi, title, authors: [{ firstName, lastName }] }
 */
adminRouter.post('/duplicates/check', async (req, res, next) => {
  try {
    const { doi, title, authors } = req.body;

    const result = await checkDuplicates({
      doi,
      title,
      author: authors?.[0]?.lastName, // Check first author
      limit: 10,
    });

    // Determine if this would be a duplicate
    const isDuplicate =
      (result.byDoi && result.byDoi.length > 0) ||
      (result.byTitle?.exact && result.byTitle.exact.length > 0);

    res.json({
      isDuplicate,
      confidence: isDuplicate ? (result.byDoi?.length > 0 ? 'high' : 'medium') : 'low',
      matches: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/status/postgres
 * Get detailed PostgreSQL connection status.
 */
adminRouter.get('/status/postgres', async (req, res, next) => {
  try {
    const status = await getPostgresStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/status/r2
 * Get detailed Cloudflare R2 connection status.
 */
adminRouter.get('/status/r2', async (req, res, next) => {
  try {
    const status = await getR2Status();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/status
 * Get combined system status (PostgreSQL + R2 + statistics).
 */
adminRouter.get('/status', async (req, res, next) => {
  try {
    const status = await getSystemStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/** GET /api/admin/trash — paginated soft-deleted item trees. */
adminRouter.get('/trash', async (req, res, next) => {
  try {
    const result = await getTrash({ page: req.query.page, pageSize: req.query.pageSize });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/** DELETE /api/admin/trash — permanently purge every soft-deleted item tree. */
adminRouter.delete('/trash', async (_req, res, next) => {
  try {
    res.json(await emptyTrash());
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/reconcile
 * Compare PostgreSQL attachment/full-text references against R2 objects.
 * Returns items missing from R2 and R2 objects with no DB reference.
 */
adminRouter.get('/reconcile', async (req, res, next) => {
  try {
    const force = req.query.force === 'true' || req.query.force === '1';
    const result = await reconcileStorage({ force });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/admin/reconcile/delete
 * Manually delete orphaned R2 objects (present in R2, no DB reference).
 * Body: { names: string[] }
 *
 * Each name is re-validated against fresh DB state right before deletion,
 * so anything that became referenced in the interim is skipped, not deleted.
 */
adminRouter.post('/reconcile/delete', async (req, res, next) => {
  try {
    const { names } = req.body;
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'names must be a non-empty array' });
    }
    if (names.length > 1000) {
      return res.status(400).json({ error: 'cannot delete more than 1000 objects at once' });
    }
    const result = await deleteOrphanObjects(names);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/admin/health
 * Quick health check for admin features.
 */
adminRouter.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const result = await listAccounts({
      page: req.query.page,
      pageSize: req.query.pageSize,
      q: req.query.q,
    });
    res.json({
      ...result,
      bootstrapAddresses: getBootstrapAddresses(),
    });
  }),
);

adminRouter.patch(
  '/accounts/:address',
  asyncHandler(async (req, res) => {
    const before = await getAccountByAddress(req.params.address);
    try {
      const account = await setAccountRole(req.params.address, req.body?.role);
      if (before && before.role !== account.role) {
        recordActivity({
          accountID: req.auth?.accountID || null,
          address: req.auth?.address || null,
          method: 'PATCH',
          path: (req.originalUrl || '').split('?')[0],
          statusCode: 200,
          action: 'admin.role',
          meta: { target: account.address, from: before.role, to: account.role },
        });
      }
      res.json({ account });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  }),
);

adminRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const result = await listActivityLogs({
      page: req.query.page,
      pageSize: req.query.pageSize,
      address: req.query.address,
      action: req.query.action,
      path: req.query.path,
      from: req.query.from,
      to: req.query.to,
    });
    res.json(result);
  }),
);

adminRouter.get('/health', async (req, res) => {
  res.json({
    ok: true,
    features: [
      'duplicate-detection',
      'postgres-status',
      'r2-status',
      'system-monitoring',
      'trash-management',
      'storage-reconciliation',
      'accounts',
      'activity-logs',
    ],
    timestamp: new Date().toISOString(),
  });
});
