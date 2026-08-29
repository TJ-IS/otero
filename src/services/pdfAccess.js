import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

function pdfSecret() {
  return config.auth.pdfSigningSecret || config.auth.secret;
}

export function requestBaseUrl(req) {
  const proto = req.get?.('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get?.('x-forwarded-host') || req.get?.('host') || 'localhost';
  return `${proto}://${host}`;
}

export function signPdfAccess(attachmentKey, ttlSec = config.auth.pdfUrlTtlSec) {
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? Math.floor(ttlSec) : 600;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = createHmac('sha256', pdfSecret())
    .update(`${attachmentKey}.${exp}`)
    .digest('base64url');
  const qs = new URLSearchParams({ exp: String(exp), sig });
  return {
    attachmentKey,
    exp,
    sig,
    url: `/api/attachments/${attachmentKey}/file?${qs.toString()}`,
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlSec: ttl,
  };
}

export function verifyPdfAccess(attachmentKey, exp, sig) {
  const expNum = Number(exp);
  if (!attachmentKey || !sig || !Number.isFinite(expNum)) return false;
  if (expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac('sha256', pdfSecret())
    .update(`${attachmentKey}.${expNum}`)
    .digest('base64url');
  const given = Buffer.from(String(sig));
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

export function withAbsolutePdfUrl(req, signed, extra = {}) {
  return {
    ...extra,
    attachmentKey: signed.attachmentKey,
    url: signed.url,
    absoluteUrl: `${requestBaseUrl(req)}${signed.url}`,
    expiresAt: signed.expiresAt,
    ttlSec: signed.ttlSec,
  };
}
