import { recordActivity, redactQuery } from '../../repositories/activityLogRepo.js';

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

function requestPath(req) {
  const raw = req.originalUrl || req.url || '';
  return raw.split('?')[0];
}

function shouldSkip(req) {
  const path = requestPath(req);
  if (path === '/health' || path.startsWith('/health/')) return true;
  if (path.startsWith('/api/open/v1')) return true;
  if (path.startsWith('/api/auth/nonce')) return true;
  if (path.startsWith('/api/activity')) return true;
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (/\/api\/items\/[^/]+\/fulltext(\/structure)?$/.test(path)) return true;
    if (/\/api\/attachments\/[^/]+\/fulltext\//.test(path)) return true;
    if (!path.startsWith('/api/')) return true;
  }
  if (!path.startsWith('/api/')) return true;
  return false;
}

function deriveAction(req) {
  const path = requestPath(req);
  const method = (req.method || 'GET').toUpperCase();
  if (path.startsWith('/api/auth/verify')) return 'auth.verify';
  if (path.endsWith('/pdf-url') || path.includes('/pdf-url?')) return 'pdf.mint';
  if (/\/api\/attachments\/[^/]+\/file$/.test(path)) return 'pdf.view';
  if (path.startsWith('/api/admin/accounts') && method !== 'GET') return 'admin.role';
  if (path.startsWith('/api/admin')) return 'admin.request';
  if (method === 'GET' && /\/api\/items\/[^/]+$/.test(path)) return 'item.view';
  if (path.startsWith('/api/items') && req.query?.search) return 'item.search';
  return 'api.request';
}

export function activityLogMiddleware() {
  return (req, res, next) => {
    if (shouldSkip(req)) return next();
    const started = Date.now();
    res.on('finish', () => {
      recordActivity({
        accountID: req.auth?.accountID || null,
        address: req.auth?.address || null,
        ip: clientIp(req),
        userAgent: req.get('user-agent'),
        method: req.method,
        path: requestPath(req),
        query: redactQuery(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : ''),
        statusCode: res.statusCode,
        durationMs: Date.now() - started,
        action: deriveAction(req),
      });
    });
    next();
  };
}
