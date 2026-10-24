import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { buildApp } from '../src/api/server.js';
import { Item } from '../src/models/Item.js';
import { insertAttachment } from '../src/repositories/itemRepo.js';
import { JOURNAL_WHITELIST, UNFILED } from '../src/services/journalWhitelist.js';
import {
  hideFromPublic,
  isBasketVisibleItem,
  publicItemScope,
} from '../src/services/itemVisibility.js';
import { config } from '../src/config.js';
import { signToken } from '../src/api/middleware/auth.js';

const createdKeys = [];
const tag = `vis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const EDITOR = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let app;
let editorToken;

async function makeItem({
  title,
  journal = JOURNAL_WHITELIST[0],
  date = '2024',
  creator,
  doi,
} = {}) {
  const item = new Item();
  await item.setItemType('journalArticle');
  item.setField('title', title || tag);
  item.setField('publicationTitle', journal);
  item.setField('date', date);
  if (doi !== null) {
    item.setField('DOI', doi || `10.9999/${tag}-${createdKeys.length + 1}`);
  }
  if (creator) item.addCreator({ ...creator, creatorType: 'author' });
  await item.save();
  createdKeys.push(item.key);
  return Item.loadByKey(item.key);
}

before(async () => {
  await prepareTestDb();
  if (!config.auth.editorWhitelist.includes(EDITOR)) {
    config.auth.editorWhitelist.push(EDITOR);
  }
  editorToken = await signToken(EDITOR);
  app = buildApp();
});

after(async () => {
  for (const key of createdKeys.splice(0)) {
    const item = await Item.loadByKey(key);
    if (item) await item.delete(true);
  }
  await closeDb();
});

test('visibility helpers: editors see unfiled, public does not', () => {
  const visible = {
    deleted: false,
    parentItemID: null,
    itemType: 'journalArticle',
    getField: (name) => (name === 'DOI' ? '10.1/x' : JOURNAL_WHITELIST[0]),
  };
  const hidden = {
    deleted: false,
    parentItemID: null,
    itemType: 'journalArticle',
    getField: () => `Outside ${tag}`,
  };
  const missingDoi = {
    deleted: false,
    parentItemID: null,
    itemType: 'journalArticle',
    getField: (name) => (name === 'DOI' ? '' : JOURNAL_WHITELIST[0]),
  };
  assert.equal(isBasketVisibleItem(visible), true);
  assert.equal(isBasketVisibleItem(hidden), false);
  assert.equal(isBasketVisibleItem(missingDoi), false);
  assert.deepEqual(publicItemScope({}), { basketOnly: true, requireDoiForArticles: true });
  assert.deepEqual(publicItemScope({ auth: { canEdit: true } }), {});
  assert.equal(hideFromPublic({}, hidden), true);
  assert.equal(hideFromPublic({ auth: { canEdit: true } }, hidden), false);
  assert.equal(hideFromPublic({}, missingDoi), true);
  assert.equal(hideFromPublic({ auth: { canEdit: true } }, missingDoi), false);
});

test('anonymous GET /api/items hides unfiled rows and rejects explicit 待归档', async () => {
  const visible = await makeItem({ title: `${tag} visible` });
  const hidden = await makeItem({ title: `${tag} hidden`, journal: `Outside Journal ${tag}` });

  const list = await request(app)
    .get('/api/items')
    .query({ search: tag, pageSize: 50 })
    .expect(200);
  const keys = list.body.items.map((it) => it.key);
  assert.ok(keys.includes(visible.key));
  assert.ok(!keys.includes(hidden.key));

  await request(app).get(`/api/items/${visible.key}`).expect(200);
  await request(app).get(`/api/items/${hidden.key}`).expect(404);
  await request(app).get(`/api/items/${hidden.key}/fulltext`).expect(404);
  await request(app).get(`/api/items/${hidden.key}/export`).expect(404);

  const unfiled = await request(app)
    .get('/api/items')
    .query({ journal: UNFILED, search: tag })
    .expect(200);
  assert.equal(unfiled.body.total, 0);
  assert.equal(unfiled.body.items.length, 0);

  const keysRes = await request(app).get('/api/items/keys').query({ search: tag }).expect(200);
  assert.ok(keysRes.body.keys.includes(visible.key));
  assert.ok(!keysRes.body.keys.includes(hidden.key));
});

test('editor token can list and open unfiled items', async () => {
  const hidden = await makeItem({
    title: `${tag} editor-hidden`,
    journal: `Outside Editor ${tag}`,
  });

  const list = await request(app)
    .get('/api/items')
    .set('Authorization', `Bearer ${editorToken}`)
    .query({ search: `${tag} editor-hidden`, pageSize: 50 })
    .expect(200);
  assert.ok(list.body.items.some((it) => it.key === hidden.key));

  const detail = await request(app)
    .get(`/api/items/${hidden.key}`)
    .set('Authorization', `Bearer ${editorToken}`)
    .expect(200);
  assert.equal(detail.body.key, hidden.key);
});

test('anonymous cannot fetch attachments or authors for unfiled-only work', async () => {
  const creator = { firstName: 'Vis', lastName: `Author-${tag}` };
  const hidden = await makeItem({
    title: `${tag} att-hidden`,
    journal: `Outside Att ${tag}`,
    creator,
  });
  const att = new Item();
  await att.setItemType('document');
  att.setParent(hidden.id);
  await att.save();
  createdKeys.push(att.key);
  await insertAttachment({
    itemId: att.id,
    parentItemId: hidden.id,
    linkMode: 0,
    path: `missing-${tag}.pdf`,
  });

  await request(app).get(`/api/attachments/${att.key}/file`).expect(404);
  await request(app).get(`/api/attachments/${hidden.key}/fulltext/content.md`).expect(404);

  const authorId =
    hidden.creators.find((c) => c.lastName === `Author-${tag}`)?.id ?? hidden.creators[0]?.id;
  assert.ok(authorId);
  await request(app).get(`/api/authors/${authorId}`).expect(404);
});

test('author page for mixed corpus drops unfiled papers for anonymous users', async () => {
  const creator = { firstName: 'Mix', lastName: `Mixed-${tag}` };
  const visible = await makeItem({ title: `${tag} mix-visible`, creator });
  await makeItem({ title: `${tag} mix-hidden`, journal: `Outside Mix ${tag}`, creator });

  const authorId =
    visible.creators.find((c) => c.lastName === `Mixed-${tag}`)?.id ?? visible.creators[0]?.id;
  const anon = await request(app).get(`/api/authors/${authorId}`).expect(200);
  assert.ok(anon.body.items.every((it) => it.key !== undefined));
  assert.ok(anon.body.items.some((it) => it.key === visible.key));
  assert.ok(anon.body.items.every((it) => it.fields?.publicationTitle !== `Outside Mix ${tag}`));

  const asEditor = await request(app)
    .get(`/api/authors/${authorId}`)
    .set('Authorization', `Bearer ${editorToken}`)
    .expect(200);
  assert.ok(asEditor.body.items.some((it) => it.fields?.publicationTitle === `Outside Mix ${tag}`));
});

test('anonymous GET hides Basket journalArticle without DOI', async () => {
  const missing = await makeItem({ title: `${tag} doi-missing`, doi: null });
  const present = await makeItem({ title: `${tag} doi-present` });

  const list = await request(app)
    .get('/api/items')
    .query({ search: tag, pageSize: 50 })
    .expect(200);
  const keys = list.body.items.map((it) => it.key);
  assert.ok(!keys.includes(missing.key));
  assert.ok(keys.includes(present.key));

  await request(app).get(`/api/items/${missing.key}`).expect(404);
  await request(app).get(`/api/items/${present.key}`).expect(200);

  const asEditor = await request(app)
    .get(`/api/items/${missing.key}`)
    .set('Authorization', `Bearer ${editorToken}`)
    .expect(200);
  assert.equal(asEditor.body.key, missing.key);
});

test('anonymous overview stats ignore newly created unfiled items', async () => {
  const before = await request(app).get('/api/stats/overview').expect(200);
  await makeItem({ title: `${tag} stats-hidden`, journal: `Outside Stats ${tag}` });
  const after = await request(app).get('/api/stats/overview').expect(200);
  assert.equal(after.body.totalItems, before.body.totalItems);

  const editorAfter = await request(app)
    .get('/api/stats/overview')
    .set('Authorization', `Bearer ${editorToken}`)
    .expect(200);
  assert.ok(editorAfter.body.totalItems >= before.body.totalItems + 1);
});
