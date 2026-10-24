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

async function makeItem(title, creators, { journal = 'MIS Quarterly', date = '2099-01-01' } = {}) {
  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', title);
  it.setField('publicationTitle', journal);
  it.setField('date', date);
  for (const c of creators) it.addCreator(c);
  await it.save();
  createdKeys.push(it.key);
  return it;
}

const TEST_GRAPH_FILTERS = {
  journal: 'MIS Quarterly',
  yearFrom: 2099,
  yearTo: 2099,
  maxNodes: 600,
};

test('getCoauthorGraph: weight counts shared papers, no duplicate edges', async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Jones-${tag}`, creatorType: 'author' };
  const carol = { firstName: 'Carol', lastName: `White-${tag}`, creatorType: 'author' };

  await makeItem(`Paper 1 ${tag}`, [alice, bob]);
  await makeItem(`Paper 2 ${tag}`, [alice, bob]);
  await makeItem(`Paper 3 ${tag}`, [carol]);

  const { nodes, edges } = await getCoauthorGraph({ minPapers: 1, ...TEST_GRAPH_FILTERS });
  const a = nodes.find((n) => n.name === `Smith-${tag}, Alice`);
  const b = nodes.find((n) => n.name === `Jones-${tag}, Bob`);
  const c = nodes.find((n) => n.name === `White-${tag}, Carol`);
  assert.ok(a && b && c);
  assert.equal(a.paperCount, 2);
  assert.equal(b.paperCount, 2);
  assert.equal(c.paperCount, 1);

  const edge = edges.find((e) => {
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

  const { nodes, edges } = await getCoauthorGraph({ minPapers: 2, ...TEST_GRAPH_FILTERS });
  const a = nodes.find((n) => n.name === `Smith-${tag}, Alice`);
  const b = nodes.find((n) => n.name === `Jones-${tag}, Bob`);
  assert.ok(a);
  assert.equal(a.paperCount, 3);
  assert.equal(b, undefined);
  assert.ok(!edges.some((e) => e.source === a.id || e.target === a.id));
});

test('getCoauthorGraph: high minPapers can return empty graph', async () => {
  const { nodes, edges } = await getCoauthorGraph({
    minPapers: 1_000_000,
    ...TEST_GRAPH_FILTERS,
  });
  assert.deepEqual(nodes, []);
  assert.deepEqual(edges, []);
});

test("getAuthorDetail: returns name and itemIds for all of an author's top-level papers", async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Jones-${tag}`, creatorType: 'author' };

  const p1 = await makeItem(`Paper 1 ${tag}`, [alice, bob]);
  const p2 = await makeItem(`Paper 2 ${tag}`, [alice]);
  await makeItem(`Paper 3 ${tag}`, [bob]);

  const { nodes } = await getCoauthorGraph({ minPapers: 1, ...TEST_GRAPH_FILTERS });
  const a = nodes.find((n) => n.name === `Smith-${tag}, Alice`);
  assert.ok(a);

  const detail = await getAuthorDetail(a.id);
  assert.equal(detail.name, `Smith-${tag}, Alice`);
  assert.deepEqual(new Set(detail.itemIds), new Set([p1.id, p2.id]));
});

test('getAuthorDetail: returns null for an unknown creatorID', async () => {
  assert.equal(await getAuthorDetail(999999999), null);
});

test('getCoauthorGraph: defaults to Basket items and recalculates counts inside filters', async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Scope-A-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Scope-B-${tag}`, creatorType: 'author' };

  await makeItem(`MISQ 2098 ${tag}`, [alice, bob], { date: 'Spring 2098' });
  await makeItem(`MISQ 2097 ${tag}`, [alice, bob], { date: '2097-01-01' });
  await makeItem(`Outside ${tag}`, [alice, bob], {
    journal: 'Example Journal',
    date: '2098-01-01',
  });

  const graph = await getCoauthorGraph({
    minPapers: 1,
    yearFrom: 2098,
    yearTo: 2098,
    maxNodes: 600,
  });
  const a = graph.nodes.find((node) => node.name === `Scope-A-${tag}, Alice`);
  const b = graph.nodes.find((node) => node.name === `Scope-B-${tag}, Bob`);
  assert.ok(a && b);
  assert.equal(a.paperCount, 1);
  assert.equal(b.paperCount, 1);
  const edge = graph.edges.find(
    (candidate) =>
      new Set([candidate.source, candidate.target]).has(a.id) &&
      new Set([candidate.source, candidate.target]).has(b.id),
  );
  assert.ok(edge);
  assert.equal(edge.weight, 1);
  assert.equal(edge.jaccard, 1);
  assert.equal(edge.cosine, 1);
});

test('getCoauthorGraph: minCollaborations filters weak ties before metrics', async () => {
  const tag = suffix();
  const alice = { firstName: 'Alice', lastName: `Strong-A-${tag}`, creatorType: 'author' };
  const bob = { firstName: 'Bob', lastName: `Strong-B-${tag}`, creatorType: 'author' };
  const carol = { firstName: 'Carol', lastName: `Weak-C-${tag}`, creatorType: 'author' };

  await makeItem(`Strong 1 ${tag}`, [alice, bob], { date: '2096-01-01' });
  await makeItem(`Strong 2 ${tag}`, [alice, bob], { date: '2096-02-01' });
  await makeItem(`Weak ${tag}`, [alice, carol], { date: '2096-03-01' });

  const graph = await getCoauthorGraph({
    minPapers: 1,
    minCollaborations: 2,
    yearFrom: 2096,
    yearTo: 2096,
    maxNodes: 600,
  });
  const a = graph.nodes.find((node) => node.name === `Strong-A-${tag}, Alice`);
  const b = graph.nodes.find((node) => node.name === `Strong-B-${tag}, Bob`);
  const c = graph.nodes.find((node) => node.name === `Weak-C-${tag}, Carol`);
  assert.ok(a && b && c);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].weight, 2);
  assert.equal(a.metrics.degree, 1);
  assert.equal(b.metrics.degree, 1);
  assert.equal(c.metrics.degree, 0);
  assert.equal(c.community, -1);
});
