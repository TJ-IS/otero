import { Router } from 'express';
import { getAddress, isAddress } from 'viem';
import {
  generateNonce,
  signToken,
  verifyToken,
  verifyWalletSignature,
  buildSignMessage,
} from '../middleware/auth.js';
import { recordLogin } from '../../repositories/accountRepo.js';
import { recordActivity } from '../../repositories/activityLogRepo.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

function publicAuth(account) {
  return {
    address: account.address,
    role: account.role,
    canEdit: account.canEdit,
  };
}

router.get('/nonce', (req, res) => {
  const address = req.query.address;
  if (!address || !isAddress(address)) {
    return res.status(400).json({ error: 'invalid address' });
  }
  try {
    const nonce = generateNonce(address);
    res.json({ nonce, message: buildSignMessage(getAddress(address), nonce) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const { address, nonce, signature } = req.body || {};
    if (!address || !isAddress(address)) {
      return res.status(400).json({ error: 'invalid address' });
    }
    if (!nonce || typeof nonce !== 'string' || !signature || typeof signature !== 'string') {
      return res.status(400).json({ error: 'nonce and signature are required' });
    }
    const normalized = await verifyWalletSignature(address, nonce, signature);
    if (!normalized) {
      return res.status(401).json({ error: 'invalid signature' });
    }
    const account = await recordLogin(normalized);
    const token = await signToken(account.address);
    recordActivity({
      accountID: account.accountID,
      address: account.address,
      method: 'POST',
      path: '/api/auth/verify',
      statusCode: 200,
      action: 'auth.verify',
    });
    res.json({ ...publicAuth(account), token });
  }),
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const auth = await verifyToken(token);
    if (!auth) {
      return res.status(401).json({ error: 'invalid token' });
    }
    res.json(publicAuth(auth));
  }),
);

export { router as authRouter };
