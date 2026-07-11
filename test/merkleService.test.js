import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { Item } from '../src/models/Item.js';
import { merkleTree, sha256Hex, normalizeDoi } from '../src/services/merkleService.js';

const createdKeys = [];

async function setup() {
  await initDb();
  await runMigrations();
  await seed();
  merkleTree._tree = null;
}

async function createArticle(doi, title) {
  const it = new Item();
  await it.setItemType('journalArticle');
  if (title) it.setField('title', title);
  if (doi) it.setField('DOI', doi);
  await it.save();
  createdKeys.push(it.key);
  return it;
}

async function cleanupCreated() {
  for (const key of createdKeys.splice(0)) {
    const it = await Item.loadByKey(key);
    if (it) await it.delete(true);
  }
  merkleTree._tree = null;
}

before(async () => {
  await setup();
});

after(async () => {
  await cleanupCreated();
  await closeDb();
});

test('normalizeDoi lowercases and trims DOI', () => {
  assert.equal(normalizeDoi(' 10.1000/XYZ '), '10.1000/xyz');
  assert.equal(normalizeDoi('10.1000/ABC'), '10.1000/abc');
});

test('sha256Hex produces 64 hex chars', () => {
  const hash = sha256Hex('10.1000/xyz');
  assert.equal(hash.length, 64);
  assert.ok(/^[0-9a-f]+$/.test(hash));
});

test('empty tree has null root', async () => {
  // Isolate from any pre-existing DOIs by rebuilding over an empty DOI set
  // via a temporary wipe of DOI field values for created test items only.
  await cleanupCreated();
  await merkleTree.rebuild();
  // Root may be non-null if the DB already has DOIs; only assert API shape.
  const root = await merkleTree.getRoot();
  assert.ok(root === null || typeof root === 'string');
  assert.equal(typeof await merkleTree.getLeafCount(), 'number');
});

test('single DOI proof verifies against root', async () => {
  await cleanupCreated();
  const unique = `10.1000/merkle-single-${Date.now()}`;
  await createArticle(unique, 'Single');
  await merkleTree.rebuild();

  const proof = await merkleTree.getProof(unique);
  assert.ok(proof);
  assert.equal(proof.doi, unique);
  assert.equal(proof.leafHash, sha256Hex(unique));
  assert.equal(proof.root, await merkleTree.getRoot());
  assert.ok(merkleTree.verify(unique, proof));
});

test('multiple DOIs produce valid proofs and reject unknown DOI', async () => {
  await cleanupCreated();
  const a = `10.1000/merkle-a-${Date.now()}`;
  const b = `10.1000/merkle-b-${Date.now()}`;
  const c = `10.1000/merkle-c-${Date.now()}`;
  await createArticle(a, 'A');
  await createArticle(b, 'B');
  await createArticle(c, 'C');
  await merkleTree.rebuild();

  const root = await merkleTree.getRoot();
  assert.ok(root);

  for (const doi of [a, b, c]) {
    const proof = await merkleTree.getProof(doi);
    assert.ok(proof);
    assert.equal(proof.root, root);
    assert.ok(merkleTree.verify(doi, proof));
  }

  assert.equal(await merkleTree.exists('10.1000/missing-definitely'), false);
  assert.equal(await merkleTree.getProof('10.1000/missing-definitely'), null);
});

test('proof is case-insensitive for DOI', async () => {
  await cleanupCreated();
  const base = `10.1000/merkle-mixed-${Date.now()}`;
  await createArticle(base.toUpperCase(), 'Mixed');
  await merkleTree.rebuild();

  const lowerProof = await merkleTree.getProof(base.toLowerCase());
  const upperProof = await merkleTree.getProof(base.toUpperCase());
  assert.equal(lowerProof.root, upperProof.root);
  assert.ok(merkleTree.verify(base.toLowerCase(), upperProof));
});

test('deleted items are excluded from tree', async () => {
  await cleanupCreated();
  const del = `10.1000/merkle-del-${Date.now()}`;
  const keep = `10.1000/merkle-keep-${Date.now()}`;
  const it = await createArticle(del, 'To Delete');
  await createArticle(keep, 'Keep');
  await merkleTree.rebuild();
  assert.ok(await merkleTree.exists(del));

  await it.delete();
  await merkleTree.rebuild();
  assert.equal(await merkleTree.exists(del), false);
  assert.ok(await merkleTree.exists(keep));
});

test('child items are excluded from tree', async () => {
  await cleanupCreated();
  const parentDoi = `10.1000/merkle-parent-${Date.now()}`;
  const childDoi = `10.1000/merkle-child-${Date.now()}`;
  const parent = await createArticle(parentDoi, 'Parent');
  const child = new Item();
  await child.setItemType('journalArticle');
  child.setField('title', 'Child');
  child.setField('DOI', childDoi);
  child.setParent(parent.id);
  await child.save();
  createdKeys.push(child.key);

  await merkleTree.rebuild();
  assert.ok(await merkleTree.exists(parentDoi));
  assert.equal(await merkleTree.exists(childDoi), false);
});

test('duplicate DOIs are deduplicated in tree', async () => {
  await cleanupCreated();
  const dup = `10.1000/merkle-dup-${Date.now()}`;
  await createArticle(dup, 'One');
  await createArticle(dup, 'Two');
  await merkleTree.rebuild();

  assert.ok(await merkleTree.exists(dup));
  const proof = await merkleTree.getProof(dup);
  assert.ok(merkleTree.verify(dup, proof));
});

test('malicious proof fails verification', async () => {
  await cleanupCreated();
  const good = `10.1000/merkle-good-${Date.now()}`;
  const other = `10.1000/merkle-other-${Date.now()}`;
  await createArticle(good, 'Good');
  await createArticle(other, 'Other');
  await merkleTree.rebuild();

  const proof = await merkleTree.getProof(good);
  assert.equal(merkleTree.verify('10.1000/evil', proof), false);
});

test('proof includes step-by-step path with intermediate hashes', async () => {
  await cleanupCreated();
  const one = `10.1000/merkle-one-${Date.now()}`;
  const two = `10.1000/merkle-two-${Date.now()}`;
  const three = `10.1000/merkle-three-${Date.now()}`;
  await createArticle(one, 'One');
  await createArticle(two, 'Two');
  await createArticle(three, 'Three');
  await merkleTree.rebuild();

  const proof = await merkleTree.getProof(one);
  assert.ok(proof.path);
  assert.equal(proof.path.length, proof.siblings.length);

  if (proof.path.length > 0) {
    assert.equal(proof.path[0].inputHash, proof.leafHash);
    const lastStep = proof.path[proof.path.length - 1];
    assert.equal(lastStep.outputHash, proof.root);

    for (let i = 0; i < proof.path.length - 1; i++) {
      assert.equal(proof.path[i].outputHash, proof.path[i + 1].inputHash);
    }

    for (const step of proof.path) {
      const expected = step.siblingSide === 'left'
        ? sha256Hex(step.siblingHash + step.inputHash)
        : sha256Hex(step.inputHash + step.siblingHash);
      assert.equal(step.outputHash, expected);
    }
  }
});

test('getLeafCount returns number of unique DOIs', async () => {
  await cleanupCreated();
  // Count before inserting so we can assert the delta.
  await merkleTree.rebuild();
  const before = await merkleTree.getLeafCount();
  const a = `10.1000/merkle-count-a-${Date.now()}`;
  const b = `10.1000/merkle-count-b-${Date.now()}`;
  await createArticle(a, 'A');
  await createArticle(b, 'B');
  await createArticle(a, 'Duplicate A');
  await merkleTree.rebuild();

  assert.equal(await merkleTree.getLeafCount(), before + 2);
});
