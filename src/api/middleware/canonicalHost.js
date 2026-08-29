import { config } from '../../config.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function requestHost(req) {
  const forwarded = req.headers['x-forwarded-host'];
  const raw = (typeof forwarded === 'string' && forwarded.split(',')[0].trim())
    || req.headers.host
    || '';
  return String(raw).split(':')[0].toLowerCase();
}

function isBareIp(host) {
  if (!host) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (with or without brackets) after stripping the port above.
  return host.includes(':') || (host.startsWith('[') && host.endsWith(']'));
}

function canonicalHostname() {
  try {
    return new URL(config.publicBaseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 301 non-canonical Hosts to config.publicBaseUrl, preserving the path.
 * Disabled unless OTERO_ENFORCE_CANONICAL_HOST is set. Skips /health,
 * localhost, and bare IPs so local/dev and in-container probes still work.
 */
export function canonicalHostRedirect(req, res, next) {
  if (!config.enforceCanonicalHost) return next();
  if (req.path === '/health') return next();

  const host = requestHost(req);
  if (!host || LOCAL_HOSTS.has(host) || isBareIp(host)) return next();

  const canonical = canonicalHostname();
  if (!canonical || host === canonical) return next();

  const dest = `${config.publicBaseUrl}${req.originalUrl || req.url || '/'}`;
  return res.redirect(301, dest);
}
