import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { Item } from '../src/models/Item.js';
import { getCoauthorGraph, getAuthorDetail } from '../src/repositories/authorRepo.js';

const createdKeys = [];
const suffix = () => `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

before(async () => {
  await prepareTestDb();
});

after(async () => {
  for (const key of createdKeys.splice(0)) {
    const it = await Item.loadByKey(key);
    if (it) await it.delete(true);
  }
  await closeDb();
});

async function makeItem(title, creators) {
  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', title);
  for (const c of creators) it.addCreator(c);
  await it.save();
  createdKeys.push(it.key);
  return it;
}

test('getCoauthorGraph: weight counts shared papers, no duplicate edges', async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Jones-${tag}`, creatorType: 'author' };
  const carol = { firstName: 'Carol', lastName: `White-${tag}`, creatorType: 'author' };

  await makeItem(`Paper 1 ${tag}`, [alice, bob]);
  await makeItem(`Paper 2 ${tag}`, [alice, bob]);
  await makeItem(`Paper 3 ${tag}`, [carol]);

  const { nodes, edges } = await getCoauthorGraph({ minPapers: 1 });
  const a = nodes.find(n => n.name === `Smith-${tag}, Alice`);
  const b = nodes.find(n => n.name === `Jones-${tag}, Bob`);
  const c = nodes.find(n => n.name === `White-${tag}, Carol`);
  assert.ok(a && b && c);
  assert.equal(a.paperCount, 2);
  assert.equal(b.paperCount, 2);
  assert.equal(c.paperCount, 1);

  const edge = edges.find(e => {
    const ids = new Set([e.source, e.target]);
    return ids.has(a.id) && ids.has(b.id);
  });
  assert.ok(edge);
  assert.equal(edge.weight, 2);
});

test('getCoauthorGraph: minPapers filters out low-output authors and their edges', async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Jones-${tag}`, creatorType: 'author' };

  await makeItem(`Paper 1 ${tag}`, [alice, bob]);
  await makeItem(`Paper 2 ${tag}`, [alice]);
  await makeItem(`Paper 3 ${tag}`, [alice]);

  const { nodes, edges } = await getCoauthorGraph({ minPapers: 2 });
  const a = nodes.find(n => n.name === `Smith-${tag}, Alice`);
  const b = nodes.find(n => n.name === `Jones-${tag}, Bob`);
  assert.ok(a);
  assert.equal(a.paperCount, 3);
  assert.equal(b, undefined);
  assert.ok(!edges.some(e => e.source === a.id || e.target === a.id));
});

test('getCoauthorGraph: high minPapers can return empty graph', async () => {
  const { nodes, edges } = await getCoauthorGraph({ minPapers: 1_000_000 });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test('getAuthorDetail: returns name and itemIds for all of an author\'s top-level papers', async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Jones-${tag}`, creatorType: 'author' };

  const p1 = await makeItem(`Paper 1 ${tag}`, [alice, bob]);
  const p2 = await makeItem(`Paper 2 ${tag}`, [alice]);
  await makeItem(`Paper 3 ${tag}`, [bob]);

  const { nodes } = await getCoauthorGraph({ minPapers: 1 });
  const a = nodes.find(n => n.name === `Smith-${tag}, Alice`);
  assert.ok(a);

  const detail = await getAuthorDetail(a.id);
  assert.equal(detail.name, `Smith-${tag}, Alice`);
  assert.deepEqual(new Set(detail.itemIds), new Set([p1.id, p2.id]));
});

test('getAuthorDetail: returns null for an unknown creatorID', async () => {
  assert.equal(await getAuthorDetail(999999999), null);
});
