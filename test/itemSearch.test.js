import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { buildApp } from '../src/api/server.js';
import { Item, Items } from '../src/models/Item.js';
import { execute, nowUtc } from '../src/db/connection.js';
import { upsertFullText } from '../src/repositories/fulltextRepo.js';
import { JOURNAL_WHITELIST } from '../src/services/journalWhitelist.js';

const createdKeys = [];
const tag = `srch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueToken = `zxqwv${tag.replace(/[^a-z0-9]/gi, '')}`;
let app;

async function makeItem({
  title,
  journal = JOURNAL_WHITELIST[0],
  date = '2024',
  doi,
  creator,
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
  return item;
}

async function indexPlainText(itemId, plainText) {
  await upsertFullText(itemId, { state: 'done', markdownPath: `${tag}.md` });
  await execute(
    `UPDATE "itemFullText"
     SET "plainText" = $1,
         tsv = to_tsvector('simple', $1),
         "indexedAt" = $2
     WHERE "itemID" = $3`,
    [plainText, nowUtc(), itemId],
  );
}

before(async () => {
  await prepareTestDb();
  app = buildApp();
});

after(async () => {
  for (const key of createdKeys.splice(0)) {
    const item = await Item.loadByKey(key);
    if (item) await item.delete(true);
  }
  await closeDb();
});

test('search matches title, author, and full text with the same predicates', async () => {
  const titleHit = await makeItem({ title: `${tag} title-match ${uniqueToken}meta` });
  const authorHit = await makeItem({
    title: `${tag} author-only`,
    creator: { firstName: 'Ada', lastName: `Lovelace${uniqueToken}` },
  });
  const bodyHit = await makeItem({ title: `${tag} body-only` });
  await indexPlainText(bodyHit.id, `Introduction. This paper studies ${uniqueToken} in detail.`);

  const result = await Items.list({
    search: uniqueToken,
    page: 1,
    pageSize: 20,
    sortField: 'dateModified',
  });
  const keys = result.items.map((it) => it.key);
  assert.ok(keys.includes(titleHit.key), 'title ILIKE should match');
  assert.ok(keys.includes(authorHit.key), 'author ILIKE should match');
  assert.ok(keys.includes(bodyHit.key), 'full-text tsv should match');
  assert.ok(result.total >= 3);

  const bodyRow = result.items.find((it) => it.key === bodyHit.key);
  assert.equal(bodyRow.fulltextHit, true);
  assert.ok(bodyRow.fulltextSnippet);
  assert.match(bodyRow.fulltextSnippet, new RegExp(uniqueToken, 'i'));

  const titleRow = result.items.find((it) => it.key === titleHit.key);
  assert.equal(titleRow.fulltextHit, false);
});

test('search hydrates ts_headline only after pagination', async () => {
  const first = await makeItem({ title: `${tag} page-a` });
  const second = await makeItem({ title: `${tag} page-b` });
  await indexPlainText(first.id, `Unique passage one about ${uniqueToken}page.`);
  await indexPlainText(second.id, `Unique passage two about ${uniqueToken}page.`);

  const page1 = await Items.list({
    search: `${uniqueToken}page`,
    page: 1,
    pageSize: 1,
    sortField: 'dateModified',
  });
  assert.equal(page1.total, 2);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.items[0].fulltextHit, true);
  assert.ok(page1.items[0].fulltextSnippet);
  assert.match(page1.items[0].fulltextSnippet, new RegExp(`${uniqueToken}page`, 'i'));

  const page2 = await Items.list({
    search: `${uniqueToken}page`,
    page: 2,
    pageSize: 1,
    sortField: 'dateModified',
  });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.items[0].fulltextHit, true);
  assert.ok(page2.items[0].fulltextSnippet);
  assert.notEqual(page1.items[0].key, page2.items[0].key);
});

test('open articles browse by date and search stay consistent', async () => {
  const older = await makeItem({ title: `${tag} dated-old`, date: '2011-02-01' });
  const newer = await makeItem({ title: `${tag} dated-new`, date: '2019-08-01' });

  const browse = await request(app)
    .get('/api/open/v1/articles')
    .query({ q: tag, pageSize: 50 })
    .expect(200);
  const keys = browse.body.items.map((it) => it.key);
  assert.ok(keys.includes(older.key));
  assert.ok(keys.includes(newer.key));

  const noQ = await request(app).get('/api/open/v1/articles').query({ pageSize: 5 }).expect(200);
  assert.ok(noQ.body.total > 0);
  assert.ok(noQ.body.items.length <= 5);
  assert.ok(noQ.body.items.every((it) => it.key && it.fields));
});
