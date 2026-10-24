function clientStatus(err) {
  const status = err?.status;
  return Number.isInteger(status) && status >= 400 && status <= 499 ? status : null;
}

function requestPath(req) {
  return String(req.originalUrl || req.url || '/').split('?')[0];
}

/**
 * Global error middleware. Business errors (4xx `err.status`) keep their
 * message; unexpected errors are logged with request context and never leak
 * `err.message` (or a stack) to clients in production.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = clientStatus(err);
  const method = req.method || 'UNKNOWN';
  const path = requestPath(req);

  if (status) {
    console.debug(`[http] ${method} ${path} -> ${status}: ${err.message || 'request failed'}`);
    const body = { error: err.message || 'request failed' };
    if (err.code) body.code = err.code;
    return res.status(status).json(body);
  }

  console.error(`[error] ${method} ${path}`, err);

  const responseStatus = Number.isInteger(err?.status) && err.status >= 500 && err.status <= 599
    ? err.status
    : 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'internal error'
    : (err?.message || 'internal error');
  return res.status(responseStatus).json({ error: message });
}
