import { Router } from 'express';
import { getAddress, isAddress } from 'viem';
import {
  generateNonce,
  signToken,
  verifyToken,
  verifyWalletSignature,
  isEditor,
  buildSignMessage,
} from '../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

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

router.post('/verify', asyncHandler(async (req, res) => {
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
  const token = await signToken(normalized);
  const canEdit = isEditor(normalized);
  res.json({ address: normalized, token, canEdit });
}));

router.get('/me', asyncHandler(async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const auth = await verifyToken(token);
  if (!auth) {
    return res.status(401).json({ error: 'invalid token' });
  }
  res.json({ address: auth.address, canEdit: auth.canEdit });
}));

export { router as authRouter };
