import { getAddress, verifyMessage } from 'viem';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../../config.js';

const textEncoder = new TextEncoder();
const secret = textEncoder.encode(config.auth.secret);
const nonces = new Map();

function cleanExpiredNonces() {
  const now = Date.now();
  for (const [key, { expiresAt }] of nonces) {
    if (expiresAt < now) nonces.delete(key);
  }
}

setInterval(cleanExpiredNonces, 60_000).unref?.();

export function isEditor(address) {
  if (!address) return false;
  return config.auth.editorWhitelist.includes(address.toLowerCase());
}

export function getEditorAddresses() {
  return config.auth.editorWhitelist;
}

export function generateNonce(address) {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('invalid address');
  }
  const normalized = getAddress(address);
  const nonce = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  const key = `${normalized.toLowerCase()}:${nonce}`;
  nonces.set(key, {
    address: normalized,
    expiresAt: Date.now() + config.auth.nonceTtlSec * 1000,
  });
  return nonce;
}

function consumeNonce(address, nonce) {
  const normalized = getAddress(address);
  const key = `${normalized.toLowerCase()}:${nonce}`;
  const record = nonces.get(key);
  if (!record) return null;
  nonces.delete(key);
  if (record.expiresAt < Date.now()) return null;
  return record.address;
}

export function buildSignMessage(address, nonce) {
  return `Otero wants you to sign in with your Ethereum account:\n${address}\n\nNonce: ${nonce}`;
}

export async function signToken(address) {
  const normalized = getAddress(address);
  const canEdit = isEditor(normalized);
  return new SignJWT({ address: normalized, canEdit })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.auth.jwtTtlSec}s`)
    .sign(secret);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.address || typeof payload.address !== 'string') return null;
    return { address: payload.address, canEdit: Boolean(payload.canEdit) };
  } catch {
    return null;
  }
}

export async function verifyWalletSignature(address, nonce, signature) {
  const expected = consumeNonce(address, nonce);
  if (!expected) return null;
  const normalized = getAddress(address);
  if (normalized.toLowerCase() !== expected.toLowerCase()) return null;
  const message = buildSignMessage(normalized, nonce);
  try {
    const valid = await verifyMessage({ address: normalized, message, signature });
    return valid ? normalized : null;
  } catch {
    return null;
  }
}

export function optionalAuth() {
  return async (req, _res, next) => {
    req.auth = null;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      req.auth = await verifyToken(token);
    }
    next();
  };
}

export function requireEditor(req, res, next) {
  if (!req.auth || !req.auth.address) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (!req.auth.canEdit) {
    return res.status(403).json({ error: 'not an editor' });
  }
  next();
}

export function editorWriteGate(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  const url = req.originalUrl || req.url || '';
  const publicWrites = ['/api/auth', '/api/merkle/verify'];
  if (publicWrites.some(prefix => url.startsWith(prefix))) {
    return next();
  }
  return requireEditor(req, res, next);
}
