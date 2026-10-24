import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import request from 'supertest';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { buildApp } from '../src/api/server.js';
import { Item } from '../src/models/Item.js';
import { insertAttachment } from '../src/repositories/itemRepo.js';
import { JOURNAL_WHITELIST } from '../src/services/journalWhitelist.js';
import { signPdfAccess, verifyPdfAccess } from '../src/services/pdfAccess.js';
import { signToken } from '../src/api/middleware/auth.js';

const createdKeys = [];
const tag = `pdf-access-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let app;
let item;
let attachment;

before(async () => {
  await prepareTestDb();
  app = buildApp();
  item = new Item();
  await item.setItemType('journalArticle');
  item.setField('title', `${tag} visible`);
  item.setField('publicationTitle', JOURNAL_WHITELIST[0]);
  item.setField('date', '2024');
  item.setField('DOI', `10.9999/${tag}`);
  await item.save();
  createdKeys.push(item.key);

  attachment = new Item();
  await attachment.setItemType('document');
  attachment.setParent(item.id);
  await attachment.save();
  createdKeys.push(attachment.key);
  await insertAttachment({
    itemId: attachment.id,
    parentItemId: item.id,
    linkMode: 0,
    contentType: 'application/pdf',
    path: `attachments/${tag}.pdf`,
  });
});

after(async () => {
  for (const key of createdKeys.splice(0)) {
    const row = await Item.loadByKey(key);
    if (row) await row.delete(true);
  }
  await closeDb();
});

test('HMAC pdf signatures expire and reject tampering', () => {
  const signed = signPdfAccess(attachment.key, 60);
  assert.equal(verifyPdfAccess(attachment.key, signed.exp, signed.sig), true);
  assert.equal(verifyPdfAccess(attachment.key, signed.exp, 'not-the-sig'), false);
  assert.equal(
    verifyPdfAccess(attachment.key, Math.floor(Date.now() / 1000) - 10, signed.sig),
    false,
  );
});

test('unsigned or bad signatures cannot stream PDF', async () => {
  const unsigned = await request(app).get(`/api/attachments/${attachment.key}/file`).expect(404);
  assert.equal(unsigned.body.error, 'attachment not found');

  const signed = signPdfAccess(attachment.key);
  const bad = await request(app)
    .get(`/api/attachments/${attachment.key}/file`)
    .query({ exp: signed.exp, sig: 'aaaa' })
    .expect(404);
  assert.equal(bad.body.error, 'attachment not found');

  const expired = await request(app)
    .get(`/api/attachments/${attachment.key}/file`)
    .query({ exp: Math.floor(Date.now() / 1000) - 30, sig: signed.sig })
    .expect(404);
  assert.equal(expired.body.error, 'attachment not found');
});

test('website pdf-url requires a logged-in wallet and returns a signed URL', async () => {
  await request(app).get(`/api/items/${item.key}/pdf-url`).expect(404);

  const wallet = privateKeyToAccount(generatePrivateKey());
  const token = await signToken(wallet.address);
  const minted = await request(app)
    .get(`/api/items/${item.key}/pdf-url`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.equal(minted.body.itemKey, item.key);
  assert.equal(minted.body.attachmentKey, attachment.key);
  assert.match(minted.body.url, /\?exp=\d+&sig=/);
  assert.ok(minted.body.expiresAt);

  const guests = await request(app).get(`/api/items/${item.key}/attachments`).expect(200);
  assert.equal(
    guests.body.attachments.some((a) => String(a.contentType || '').includes('pdf')),
    false,
  );

  const authed = await request(app)
    .get(`/api/items/${item.key}/attachments`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  assert.ok(authed.body.attachments.some((a) => a.key === attachment.key));
});

test('open API pdf-url mints a usable temporary key without login', async () => {
  const minted = await request(app).get(`/api/open/v1/items/${item.key}/pdf-url`).expect(200);
  assert.match(minted.body.url, new RegExp(`/api/attachments/${attachment.key}/file\\?`));
  const streamed = await request(app).get(minted.body.url);
  assert.ok(streamed.status === 200 || streamed.body?.error === 'file missing');
});
