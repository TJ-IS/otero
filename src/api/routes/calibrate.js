import { Router } from 'express';
import { calibrateItem } from '../../services/calibrateService.js';

export const calibrateRouter = Router();

// POST /api/items/:key/calibrate
// Runs LLM-based metadata verification against the parsed full text.
// Returns per-field suggestions; does NOT modify the database.
calibrateRouter.post('/items/:key/calibrate', async (req, res) => {
  try {
    const result = await calibrateItem(req.params.key);
    res.json(result);
  } catch (err) {
    const status = /未找到|not found/i.test(err.message) ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});
