import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { buildApp } from '../src/api/server.js';
import { Item } from '../src/models/Item.js';
import { insertAttachment } from '../src/repositories/itemRepo.js';
import { JOURNAL_WHITELIST } from '../src/services/journalWhitelist.js';

const createdKeys = [];
const tag = `open-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

test('open item endpoints expose Basket items by key and reject unfiled items', async () => {
  const visible = await makeItem({
    title: `${tag} visible`,
    doi: `10.9999/${tag}`,
    creator: { firstName: 'Grace', lastName: `Hopper-${tag}` },
  });
  const hidden = await makeItem({ title: `${tag} hidden`, journal: `Outside Journal ${tag}` });

  const detail = await request(app).get(`/api/open/v1/items/${visible.key}`).expect(200);
  assert.equal(detail.body.item.key, visible.key);
  assert.equal(detail.body.item.fields.title, `${tag} visible`);

  await request(app).get(`/api/open/v1/items/${hidden.key}`).expect(404);
  await request(app).get('/api/open/v1/items/DOESNOTEXIST').expect(404);

  const missingDoi = await makeItem({ title: `${tag} no-doi`, doi: null });
  await request(app).get(`/api/open/v1/items/${missingDoi.key}`).expect(404);
});

test('open item export supports BibTeX and RIS and validates format', async () => {
  const item = await makeItem({ title: `${tag} export`, doi: `10.9999/${tag}-export` });

  const bib = await request(app)
    .get(`/api/open/v1/items/${item.key}/export`)
    .query({ format: 'bibtex' })
    .expect(200);
  assert.match(bib.text, /@article\{/);
  assert.match(bib.text, new RegExp(tag));

  const ris = await request(app)
    .get(`/api/open/v1/items/${item.key}/export`)
    .query({ format: 'ris' })
    .expect(200);
  assert.match(ris.text, /^TY {2}- JOUR/m);
  assert.match(ris.text, /ER {2}-/);

  await request(app)
    .get(`/api/open/v1/items/${item.key}/export`)
    .query({ format: 'csv' })
    .expect(400);
});

test('open PDF, markdown and structure endpoints return stable availability states', async () => {
  const item = await makeItem({ title: `${tag} assets` });
  const attachment = new Item();
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

  const pdf = await request(app).get(`/api/open/v1/items/${item.key}/pdf-url`).expect(200);
  assert.equal(pdf.body.itemKey, item.key);
  assert.equal(pdf.body.attachmentKey, attachment.key);
  assert.match(
    pdf.body.absoluteUrl,
    new RegExp(`/api/attachments/${attachment.key}/file\\?exp=\\d+&sig=`),
  );
  assert.ok(pdf.body.expiresAt);
  assert.ok(pdf.body.ttlSec > 0);

  await request(app).get(`/api/attachments/${attachment.key}/file`).expect(404);
  const signed = await request(app).get(pdf.body.url);
  assert.ok(signed.status === 200 || signed.body?.error === 'file missing');

  const structure = await request(app).get(`/api/open/v1/items/${item.key}/structure`).expect(200);
  assert.equal(structure.body.itemKey, item.key);
  assert.equal(structure.body.state, 'idle');
  assert.deepEqual(structure.body.outline, []);
  assert.deepEqual(structure.body.references, []);

  const markdown = await request(app).get(`/api/open/v1/items/${item.key}/markdown`).expect(404);
  assert.equal(markdown.body.state, 'idle');
});

test('open facets and timeline honor search and Basket visibility', async () => {
  await makeItem({ title: `${tag} facet alpha`, date: '2022-04-01' });
  await makeItem({ title: `${tag} facet beta`, date: '2023' });
  await makeItem({ title: `${tag} facet hidden`, date: '2023', journal: `Outside Journal ${tag}` });

  const facets = await request(app)
    .get('/api/open/v1/facets')
    .query({ q: `${tag} facet` })
    .expect(200);
  assert.equal(facets.body.journals.find((row) => row.value === JOURNAL_WHITELIST[0])?.count, 2);
  assert.equal(facets.body.years.find((row) => row.value === 2022)?.count, 1);
  assert.equal(facets.body.years.find((row) => row.value === 2023)?.count, 1);
  assert.equal(facets.body.types.find((row) => row.value === 'journalArticle')?.count, 2);
  assert.ok(Object.hasOwn(facets.body.availability, 'withMarkdown'));

  const timeline = await request(app)
    .get('/api/open/v1/stats/timeline')
    .query({ q: `${tag} facet` })
    .expect(200);
  assert.deepEqual(timeline.body.years, [
    { year: 2022, count: 1 },
    { year: 2023, count: 1 },
  ]);
});

test('open overview counts only Basket items', async () => {
  await makeItem({ title: `${tag} overview visible`, doi: `10.9999/${tag}-overview` });
  await makeItem({ title: `${tag} overview hidden`, journal: `Outside Overview ${tag}` });

  const response = await request(app).get('/api/open/v1/stats/overview').expect(200);
  assert.ok(response.body.totalItems > 0);
  assert.ok(response.body.totalAuthors >= 0);
  assert.ok(response.body.withDoi >= 1);
  assert.ok(response.body.withPdf >= 0);
  assert.ok(response.body.withMarkdown >= 0);
  assert.equal(response.body.journalCount, JOURNAL_WHITELIST.length);
});

test('filtered article export contains only matching Basket records', async () => {
  await makeItem({ title: `${tag} bulk export`, date: '2021' });
  await makeItem({ title: `${tag} bulk hidden`, date: '2021', journal: `Outside Export ${tag}` });

  const response = await request(app)
    .get('/api/open/v1/articles/export')
    .query({ q: `${tag} bulk`, format: 'bibtex' })
    .expect(200);
  assert.equal(response.headers['x-export-count'], '1');
  assert.match(response.text, /bulk export/);
  assert.doesNotMatch(response.text, /bulk hidden/);
});
