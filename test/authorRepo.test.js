import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { Item } from '../src/models/Item.js';
import { getCoauthorGraph, getAuthorDetail } from '../src/repositories/authorRepo.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  setDb(db);
  runMigrations();
  seed();
  return db;
}

function makeItem(title, creators) {
  const it = new Item();
  it.setItemType('journalArticle');
  it.setField('title', title);
  for (const c of creators) it.addCreator(c);
  it.save();
  return it;
}

test('getCoauthorGraph: weight counts shared papers, no duplicate edges', () => {
  setup();
  try {
    // Alice & Bob co-author two papers; Carol solo-authors one.
    makeItem('Paper 1', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ]);
    makeItem('Paper 2', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ]);
    makeItem('Paper 3', [
      { firstName: 'Carol', lastName: 'White', creatorType: 'author' },
    ]);

    const { nodes, edges } = getCoauthorGraph({ minPapers: 1 });

    assert.equal(nodes.length, 3);
    const alice = nodes.find(n => n.name === 'Smith, Alice');
    const bob = nodes.find(n => n.name === 'Jones, Bob');
    const carol = nodes.find(n => n.name === 'White, Carol');
    assert.ok(alice && bob && carol);
    assert.equal(alice.paperCount, 2);
    assert.equal(bob.paperCount, 2);
    assert.equal(carol.paperCount, 1);

    // Exactly one edge between Alice and Bob, weight 2. No edge involving Carol.
    assert.equal(edges.length, 1);
    const edge = edges[0];
    assert.equal(edge.weight, 2);
    const ids = new Set([edge.source, edge.target]);
    assert.ok(ids.has(alice.id) && ids.has(bob.id));
  } finally {
    closeDb();
  }
});

test('getCoauthorGraph: minPapers filters out low-output authors and their edges', () => {
  setup();
  try {
    makeItem('Paper 1', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ]);
    makeItem('Paper 2', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    ]);
    makeItem('Paper 3', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    ]);

    // Bob has 1 paper, Alice has 3. minPapers=2 should drop Bob entirely.
    const { nodes, edges } = getCoauthorGraph({ minPapers: 2 });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].name, 'Smith, Alice');
    assert.equal(edges.length, 0);
  } finally {
    closeDb();
  }
});

test('getCoauthorGraph: empty database returns empty graph', () => {
  setup();
  try {
    const { nodes, edges } = getCoauthorGraph({ minPapers: 1 });
    assert.deepEqual(nodes, []);
    assert.deepEqual(edges, []);
  } finally {
    closeDb();
  }
});

test('getAuthorDetail: returns name and itemIds for all of an author\'s top-level papers', () => {
  setup();
  try {
    const p1 = makeItem('Paper 1', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ]);
    const p2 = makeItem('Paper 2', [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
    ]);
    makeItem('Paper 3 (not Alice\'s)', [
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ]);

    const { nodes } = getCoauthorGraph({ minPapers: 1 });
    const alice = nodes.find(n => n.name === 'Smith, Alice');

    const detail = getAuthorDetail(alice.id);
    assert.equal(detail.name, 'Smith, Alice');
    assert.deepEqual(new Set(detail.itemIds), new Set([p1.id, p2.id]));
  } finally {
    closeDb();
  }
});

test('getAuthorDetail: returns null for an unknown creatorID', () => {
  setup();
  try {
    assert.equal(getAuthorDetail(99999), null);
  } finally {
    closeDb();
  }
});
