import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import request from 'supertest';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { buildApp } from '../src/api/server.js';
import { buildSignMessage, signToken, verifyToken, isEditor } from '../src/api/middleware/auth.js';
import { config } from '../src/config.js';
import { setAccountRole } from '../src/repositories/accountRepo.js';

describe('wallet auth', () => {
  let app;

  before(async () => {
    await prepareTestDb();
    app = buildApp();
  });

  after(async () => {
    await closeDb();
  });

  test('GET endpoints are public', async () => {
    await request(app).get('/health').expect(200);
  });

  test('POST write endpoint without token returns 401', async () => {
    await request(app)
      .post('/api/import/pdf')
      .send({})
      .expect(401)
      .expect((res) => {
        assert.equal(res.body.error, 'unauthorized');
      });
  });

  test('non-whitelisted token cannot write', async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const token = await signToken(account.address);
    await request(app)
      .post('/api/import/pdf')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403)
      .expect((res) => {
        assert.equal(res.body.error, 'not an editor');
      });
  });

  test('whitelisted token can pass write gate', async () => {
    const [whitelisted] = config.auth.editorWhitelist;
    if (!whitelisted) {
      console.log('no whitelist configured; skipping');
      return;
    }
    const token = await signToken(whitelisted);
    const auth = await verifyToken(token);
    assert.ok(auth);
    assert.equal(auth.address.toLowerCase(), whitelisted.toLowerCase());
    assert.equal(auth.canEdit, true);
    assert.equal(auth.role, 'admin');
    assert.equal(await isEditor(whitelisted), true);
  });

  test('auth nonce and verify flow', async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);

    const nonceRes = await request(app)
      .get('/api/auth/nonce')
      .query({ address: account.address })
      .expect(200);
    const { nonce, message } = nonceRes.body;
    assert.ok(nonce);
    assert.equal(message, buildSignMessage(account.address, nonce));

    const signature = await account.signMessage({ message });
    const verifyRes = await request(app)
      .post('/api/auth/verify')
      .send({ address: account.address, nonce, signature })
      .expect(200);
    const body = verifyRes.body;
    assert.equal(body.address.toLowerCase(), account.address.toLowerCase());
    assert.equal(body.canEdit, await isEditor(account.address));
    assert.equal(body.role, 'user');
    assert.ok(body.token);

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.token}`)
      .expect(200)
      .expect((res) => {
        assert.equal(res.body.address.toLowerCase(), account.address.toLowerCase());
        assert.equal(res.body.canEdit, body.canEdit);
        assert.equal(res.body.role, 'user');
      });

    await setAccountRole(account.address, 'admin');
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.token}`)
      .expect(200)
      .expect((res) => {
        assert.equal(res.body.role, 'admin');
        assert.equal(res.body.canEdit, true);
      });
    await setAccountRole(account.address, 'user');
  });

  test('POST /api/merkle/verify stays public', async () => {
    await request(app)
      .post('/api/merkle/verify')
      .send({ doi: '10.0000/a', proof: { siblings: [] } })
      .expect(200);
  });
});
