import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetTestDb, closeDb } from './helpers/pg.js';
import { Item } from '../src/models/Item.js';
import { getCoauthorGraph, getAuthorDetail } from '../src/repositories/authorRepo.js';

before(async () => {
  await resetTestDb();
});

after(async () => {
  await closeDb();
});

async function makeItem(title, creators) {
  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', title);
  for (const c of creators) it.addCreator(c);
  await it.save();
  return it;
}

test('getCoauthorGraph: weight counts shared papers, no duplicate edges', async () => {
  await resetTestDb();
  await makeItem('Paper 1', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
  ]);
  await makeItem('Paper 2', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
  ]);
  await makeItem('Paper 3', [
    { firstName: 'Carol', lastName: 'White', creatorType: 'author' },
  ]);

  const { nodes, edges } = await getCoauthorGraph({ minPapers: 1 });

  assert.equal(nodes.length, 3);
  const alice = nodes.find(n => n.name === 'Smith, Alice');
  const bob = nodes.find(n => n.name === 'Jones, Bob');
  const carol = nodes.find(n => n.name === 'White, Carol');
  assert.ok(alice && bob && carol);
  assert.equal(alice.paperCount, 2);
  assert.equal(bob.paperCount, 2);
  assert.equal(carol.paperCount, 1);

  assert.equal(edges.length, 1);
  const edge = edges[0];
  assert.equal(edge.weight, 2);
  const ids = new Set([edge.source, edge.target]);
  assert.ok(ids.has(alice.id) && ids.has(bob.id));
});

test('getCoauthorGraph: minPapers filters out low-output authors and their edges', async () => {
  await resetTestDb();
  await makeItem('Paper 1', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
  ]);
  await makeItem('Paper 2', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
  ]);
  await makeItem('Paper 3', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
  ]);

  const { nodes, edges } = await getCoauthorGraph({ minPapers: 2 });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, 'Smith, Alice');
  assert.equal(edges.length, 0);
});

test('getCoauthorGraph: empty database returns empty graph', async () => {
  await resetTestDb();
  const { nodes, edges } = await getCoauthorGraph({ minPapers: 1 });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test('getAuthorDetail: returns name and itemIds for all of an author\'s top-level papers', async () => {
  await resetTestDb();
  const p1 = await makeItem('Paper 1', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
  ]);
  const p2 = await makeItem('Paper 2', [
    { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
  ]);
  await makeItem('Paper 3 (not Alice\'s)', [
    { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
  ]);

  const { nodes } = await getCoauthorGraph({ minPapers: 1 });
  const alice = nodes.find(n => n.name === 'Smith, Alice');

  const detail = await getAuthorDetail(alice.id);
  assert.equal(detail.name, 'Smith, Alice');
  assert.deepEqual(new Set(detail.itemIds), new Set([p1.id, p2.id]));
});

test('getAuthorDetail: returns null for an unknown creatorID', async () => {
  await resetTestDb();
  assert.equal(await getAuthorDetail(99999), null);
});
