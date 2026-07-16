import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../src/api/server.js';
import { prepareTestDb, closeDb } from './helpers/pg.js';

let app;

before(async () => {
  await prepareTestDb();
  app = buildApp();
});

after(async () => {
  await closeDb();
});

test('GET /api/authors/graph strictly validates integer filters', async () => {
  await request(app)
    .get('/api/authors/graph?minPapers=2papers')
    .expect(400)
    .expect((res) => assert.match(res.body.error, /minPapers/));

  await request(app)
    .get('/api/authors/graph?minCollaborations=0')
    .expect(400)
    .expect((res) => assert.match(res.body.error, /minCollaborations/));

  await request(app)
    .get('/api/authors/graph?yearFrom=2100')
    .expect(400)
    .expect((res) => assert.match(res.body.error, /yearFrom/));
});

test('GET /api/authors/graph validates Basket journals and single values', async () => {
  await request(app)
    .get('/api/authors/graph')
    .query({ journal: 'Example Journal' })
    .expect(400)
    .expect((res) => assert.match(res.body.error, /Basket/));

  await request(app)
    .get('/api/authors/graph')
    .query({ journal: ['MIS Quarterly', 'Information Systems Research'] })
    .expect(400)
    .expect((res) => assert.match(res.body.error, /single value/));
});

test('GET /api/authors/graph rejects inverted year ranges', async () => {
  await request(app)
    .get('/api/authors/graph?yearFrom=2025&yearTo=2020')
    .expect(400)
    .expect((res) => assert.match(res.body.error, /yearFrom/));
});

test('GET /api/authors/graph returns the analyzed graph contract', async () => {
  await request(app)
    .get('/api/authors/graph?minPapers=1000&minCollaborations=2')
    .expect(200)
    .expect((res) => {
      assert.ok(Array.isArray(res.body.nodes));
      assert.ok(Array.isArray(res.body.edges));
      assert.ok(Array.isArray(res.body.communities));
      assert.equal(res.body.meta.metricScope, 'displayed-network');
      assert.equal(res.body.meta.filters.minPapers, 1000);
      assert.equal(res.body.meta.filters.minCollaborations, 2);
      assert.equal(res.body.meta.filters.maxNodes, 600);
    });
});
