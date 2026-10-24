import { Router } from 'express';
import { extractItem, applyExtraction } from '../../services/extractService.js';
import { listUnfiledWithFulltextDone } from '../../repositories/itemRepo.js';
import { config } from '../../config.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const extractRouter = Router();

// POST /api/items/:key/extract
// Run LLM-based metadata extraction against the parsed full text.
// Returns per-field suggestions with confidence; does NOT modify the database.
extractRouter.post(
  '/items/:key/extract',
  asyncHandler(async (req, res) => {
    try {
      const result = await extractItem(req.params.key);
      res.json(result);
    } catch (err) {
      const status = /未找到|not found/i.test(err.message) ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }),
);

// POST /api/items/:key/extract/apply
// Run extraction AND apply the result to the database (gated by confidence
// thresholds supplied in the body). Returns what was applied vs skipped.
extractRouter.post(
  '/items/:key/extract/apply',
  asyncHandler(async (req, res) => {
    try {
      const result = await extractItem(req.params.key);
      const opts = {
        fieldThreshold: Number(req.body?.fieldThreshold ?? 0.8),
        creatorThreshold: Number(req.body?.creatorThreshold ?? 0.8),
        typeThreshold: Number(req.body?.typeThreshold ?? 0.9),
        overwrite: Boolean(req.body?.overwrite),
      };
      const applied = await applyExtraction(req.params.key, result, opts);
      res.json({ extraction: result, applied });
    } catch (err) {
      const status = /未找到|not found/i.test(err.message) ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }),
);

// POST /api/extract/batch
// Synchronously process a batch of unfiled+fulltext-done items. Each item is
// extracted and (unless dryRun) auto-applied per the confidence thresholds.
// Returns a summary; per-item detail goes to the response array.
//
// Body: { threshold, typeThreshold, limit, dryRun, overwrite }
extractRouter.post(
  '/extract/batch',
  asyncHandler(async (req, res) => {
    if (!config.llm.apiKey) {
      return res.status(400).json({ error: '未配置 OPENAI_API_KEY' });
    }
    const fieldThreshold = Number(req.body?.threshold ?? 0.8);
    const typeThreshold = Number(req.body?.typeThreshold ?? 0.9);
    const limit = Math.max(0, Number(req.body?.limit ?? 0));
    const dryRun = Boolean(req.body?.dryRun);
    const overwrite = Boolean(req.body?.overwrite);

    // Collect target set.
    const all = [];
    let page = 1;
    while (true) {
      const { items, total } = await listUnfiledWithFulltextDone({ page, pageSize: 200 });
      all.push(...items);
      if (all.length >= total || items.length === 0) break;
      page++;
    }
    const targets = limit > 0 ? all.slice(0, limit) : all;

    const results = [];
    let applied = 0,
      skipped = 0,
      failed = 0;

    // Process sequentially to avoid overwhelming the LLM endpoint from an HTTP
    // request handler. Use the CLI script (extract_all.mjs) for high-throughput
    // parallel runs.
    for (const t of targets) {
      try {
        const extraction = await extractItem(t.key);
        if (dryRun) {
          results.push({ key: t.key, extraction, applied: null });
          skipped++;
        } else {
          const apply = await applyExtraction(t.key, extraction, {
            fieldThreshold,
            creatorThreshold: fieldThreshold,
            typeThreshold,
            overwrite,
          });
          results.push({ key: t.key, extraction, applied: apply });
          if (apply.appliedFields.length || apply.appliedCreators || apply.typeChanged) applied++;
          else skipped++;
        }
      } catch (err) {
        results.push({ key: t.key, error: err.message });
        failed++;
      }
    }

    res.json({
      processed: results.length,
      applied,
      skipped,
      failed,
      threshold: fieldThreshold,
      typeThreshold,
      dryRun,
      results,
    });
  }),
);
