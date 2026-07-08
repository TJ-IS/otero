import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { Item } from '../src/models/Item.js';
import { merkleTree, sha256Hex, normalizeDoi } from '../src/services/merkleService.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  setDb(db);
  runMigrations();
  seed();
  return db;
}

function createArticle(doi, title) {
  const it = new Item();
  it.setItemType('journalArticle');
  if (title) it.setField('title', title);
  if (doi) it.setField('DOI', doi);
  it.save();
  return it;
}

test('normalizeDoi lowercases and trims DOI', () => {
  assert.equal(normalizeDoi(' 10.1000/XYZ '), '10.1000/xyz');
  assert.equal(normalizeDoi('10.1000/ABC'), '10.1000/abc');
});

test('sha256Hex produces 64 hex chars', () => {
  const hash = sha256Hex('10.1000/xyz');
  assert.equal(hash.length, 64);
  assert.ok(/^[0-9a-f]+$/.test(hash));
});

test('empty tree has null root', () => {
  setup();
  try {
    merkleTree.rebuild();
    assert.equal(merkleTree.getRoot(), null);
    assert.equal(merkleTree.exists('10.1000/xyz'), false);
    assert.equal(merkleTree.getProof('10.1000/xyz'), null);
  } finally {
    closeDb();
  }
});

test('single DOI proof verifies against root', () => {
  setup();
  try {
    createArticle('10.1000/xyz', 'Single');
    merkleTree.rebuild();
    const root = merkleTree.getRoot();
    assert.equal(root, sha256Hex('10.1000/xyz'));

    const proof = merkleTree.getProof('10.1000/xyz');
    assert.equal(proof.doi, '10.1000/xyz');
    assert.equal(proof.leafHash, sha256Hex('10.1000/xyz'));
    assert.equal(proof.root, root);
    assert.equal(proof.siblings.length, 0);
    assert.ok(merkleTree.verify('10.1000/xyz', proof));
  } finally {
    closeDb();
  }
});

test('multiple DOIs produce valid proofs and reject unknown DOI', () => {
  setup();
  try {
    createArticle('10.1000/a', 'A');
    createArticle('10.1000/b', 'B');
    createArticle('10.1000/c', 'C');
    merkleTree.rebuild();

    const root = merkleTree.getRoot();
    assert.ok(root);

    for (const doi of ['10.1000/a', '10.1000/b', '10.1000/c']) {
      const proof = merkleTree.getProof(doi);
      assert.ok(proof);
      assert.equal(proof.root, root);
      assert.ok(merkleTree.verify(doi, proof));
    }

    assert.equal(merkleTree.exists('10.1000/missing'), false);
    assert.equal(merkleTree.getProof('10.1000/missing'), null);
  } finally {
    closeDb();
  }
});

test('proof is case-insensitive for DOI', () => {
  setup();
  try {
    createArticle('10.1000/MIXED', 'Mixed');
    merkleTree.rebuild();

    const lowerProof = merkleTree.getProof('10.1000/mixed');
    const upperProof = merkleTree.getProof('10.1000/MIXED');
    assert.equal(lowerProof.root, upperProof.root);
    assert.ok(merkleTree.verify('10.1000/mixed', upperProof));
  } finally {
    closeDb();
  }
});

test('deleted items are excluded from tree', () => {
  setup();
  try {
    const it = createArticle('10.1000/del', 'To Delete');
    createArticle('10.1000/keep', 'Keep');
    merkleTree.rebuild();
    assert.ok(merkleTree.exists('10.1000/del'));

    it.delete();
    merkleTree.rebuild();
    assert.equal(merkleTree.exists('10.1000/del'), false);
    assert.ok(merkleTree.exists('10.1000/keep'));
  } finally {
    closeDb();
  }
});

test('child items are excluded from tree', () => {
  setup();
  try {
    const parent = createArticle('10.1000/parent', 'Parent');
    const child = new Item();
    child.setItemType('journalArticle');
    child.setField('title', 'Child');
    child.setField('DOI', '10.1000/child');
    child.setParent(parent.id);
    child.save();

    merkleTree.rebuild();
    assert.ok(merkleTree.exists('10.1000/parent'));
    assert.equal(merkleTree.exists('10.1000/child'), false);
  } finally {
    closeDb();
  }
});

test('duplicate DOIs are deduplicated in tree', () => {
  setup();
  try {
    createArticle('10.1000/dup', 'One');
    createArticle('10.1000/dup', 'Two');
    merkleTree.rebuild();

    assert.ok(merkleTree.exists('10.1000/dup'));
    const proof = merkleTree.getProof('10.1000/dup');
    assert.ok(merkleTree.verify('10.1000/dup', proof));
  } finally {
    closeDb();
  }
});

test('malicious proof fails verification', () => {
  setup();
  try {
    createArticle('10.1000/good', 'Good');
    createArticle('10.1000/other', 'Other');
    merkleTree.rebuild();

    const proof = merkleTree.getProof('10.1000/good');
    // Tamper with the proof by claiming the DOI is something else.
    assert.equal(merkleTree.verify('10.1000/evil', proof), false);
  } finally {
    closeDb();
  }
});

test('proof includes step-by-step path with intermediate hashes', () => {
  setup();
  try {
    createArticle('10.1000/one', 'One');
    createArticle('10.1000/two', 'Two');
    createArticle('10.1000/three', 'Three');
    merkleTree.rebuild();

    const proof = merkleTree.getProof('10.1000/one');
    assert.ok(proof.path);
    assert.equal(proof.path.length, proof.siblings.length);

    // First step: inputHash should be the leaf hash
    assert.equal(proof.path[0].inputHash, proof.leafHash);

    // Last step: outputHash should equal the root
    const lastStep = proof.path[proof.path.length - 1];
    assert.equal(lastStep.outputHash, proof.root);

    // Each step's outputHash should be the next step's inputHash
    for (let i = 0; i < proof.path.length - 1; i++) {
      assert.equal(proof.path[i].outputHash, proof.path[i + 1].inputHash);
    }

    // Verify path consistency: recompute each output from input + sibling
    for (const step of proof.path) {
      const expected = step.siblingSide === 'left'
        ? sha256Hex(step.siblingHash + step.inputHash)
        : sha256Hex(step.inputHash + step.siblingHash);
      assert.equal(step.outputHash, expected);
    }
  } finally {
    closeDb();
  }
});

test('getLeafCount returns number of unique DOIs', () => {
  setup();
  try {
    createArticle('10.1000/a', 'A');
    createArticle('10.1000/b', 'B');
    createArticle('10.1000/a', 'Duplicate A');
    merkleTree.rebuild();

    assert.equal(merkleTree.getLeafCount(), 2);
  } finally {
    closeDb();
  }
});
