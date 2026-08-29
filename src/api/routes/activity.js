import { Router } from 'express';
import { recordActivity } from '../../repositories/activityLogRepo.js';

export const activityRouter = Router();

activityRouter.post('/client', (req, res) => {
  const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
  if (!path || path.length > 500 || !path.startsWith('/')) {
    return res.status(204).end();
  }
  recordActivity({
    accountID: req.auth?.accountID || null,
    address: req.auth?.address || null,
    ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
      || req.ip
      || req.socket?.remoteAddress
      || '',
    userAgent: req.get('user-agent'),
    method: 'GET',
    path,
    action: 'page.view',
    meta: { source: 'client' },
  });
  res.status(204).end();
});
