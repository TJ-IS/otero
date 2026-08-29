import { getAddress, verifyMessage } from 'viem';
import { jwtVerify, SignJWT } from 'jose';
import { config } from '../../config.js';
import { ensureAccount, isBootstrapAdmin, getBootstrapAddresses } from '../../repositories/accountRepo.js';

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

/** True when the address is an admin (DB role, or bootstrap whitelist before first upsert). */
export async function isEditor(address) {
  if (!address) return false;
  try {
    const account = await ensureAccount(address);
    return account.role === 'admin';
  } catch {
    return isBootstrapAdmin(address);
  }
}

export function getEditorAddresses() {
  return getBootstrapAddresses().map(a => a.toLowerCase());
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

function authPayload(account) {
  return {
    address: account.address,
    role: account.role,
    canEdit: account.role === 'admin',
    accountID: account.accountID,
  };
}

export async function signToken(address) {
  const account = await ensureAccount(address);
  const canEdit = account.role === 'admin';
  return new SignJWT({ address: account.address, canEdit, role: account.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${config.auth.jwtTtlSec}s`)
    .sign(secret);
}

export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.address || typeof payload.address !== 'string') return null;
    const account = await ensureAccount(payload.address);
    return authPayload(account);
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
  const publicWrites = ['/api/auth', '/api/merkle/verify', '/api/activity'];
  const publicWritePatterns = [/^\/api\/items\/[^/]+\/chat(\?.*)?$/];
  if (publicWrites.some(prefix => url.startsWith(prefix)) || publicWritePatterns.some(re => re.test(url))) {
    return next();
  }
  return requireEditor(req, res, next);
}
