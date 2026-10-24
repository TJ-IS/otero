import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config.js';
import {
  pickContentListObjectName,
  getContentListBlocks,
  resolveFullTextAsset,
} from '../src/services/fulltextService.js';

let storageRoot;
const originalStorageDir = config.storageDir;
const originalStorageType = config.storage.type;

before(() => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'otero-fulltext-test-'));
  config.storage.type = 'filesystem';
  config.storageDir = storageRoot;
});

after(() => {
  config.storageDir = originalStorageDir;
  config.storage.type = originalStorageType;
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

function fulltextDir(key) {
  return path.join(storageRoot, key.slice(0, 2), key, 'fulltext');
}

test('pickContentListObjectName returns null for empty or unrelated input', () => {
  assert.equal(pickContentListObjectName([]), null);
  assert.equal(pickContentListObjectName(['full.md', 'images/a.png']), null);
  assert.equal(pickContentListObjectName(['content_list_v2.json']), null);
  assert.equal(pickContentListObjectName(['x/foo_content_list_v2.json']), null);
});

test('pickContentListObjectName prefers an exact content_list.json, shallowest first', () => {
  assert.equal(
    pickContentListObjectName(['x/content_list.json', 'content_list.json', 'images/a.png']),
    'content_list.json',
  );
  assert.equal(
    pickContentListObjectName(['a/b/content_list.json', 'a/content_list.json']),
    'a/content_list.json',
  );
  // Exact match wins over a shallower fallback candidate.
  assert.equal(
    pickContentListObjectName(['a/b/foo_content_list.json', 'z/content_list.json']),
    'z/content_list.json',
  );
});

test('pickContentListObjectName falls back to *_content_list.json but not _v2', () => {
  assert.equal(
    pickContentListObjectName(['a/foo_content_list.json', 'a/content_list_v2.json']),
    'a/foo_content_list.json',
  );
  assert.equal(
    pickContentListObjectName(['deep/a/bar_content_list.json', 'top_baz_content_list.json']),
    'top_baz_content_list.json',
  );
  assert.equal(
    pickContentListObjectName(['a/foo_content_list_v2.json', 'b/bar_content_list.json']),
    'b/bar_content_list.json',
  );
});

test('getContentListBlocks reads an exact content_list.json from the item root', async () => {
  config.storage.type = 'filesystem';
  const key = 'QLROOT0001';
  const dir = fulltextDir(key);
  fs.mkdirSync(dir, { recursive: true });
  const blocks = [{ type: 'text', text: 'hello', page_idx: 0 }];
  fs.writeFileSync(path.join(dir, 'content_list.json'), JSON.stringify(blocks));

  const found = await getContentListBlocks(key);
  assert.deepEqual(found, { blocks, listDirRel: '' });
});

test('getContentListBlocks finds a nested list and reports its relative directory', async () => {
  config.storage.type = 'filesystem';
  const key = 'QLNEST0002';
  const dir = fulltextDir(key);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  const blocks = [{ type: 'image', img_path: 'images/a.png', page_idx: 0 }];
  fs.writeFileSync(path.join(dir, 'sub', 'content_list.json'), JSON.stringify(blocks));

  const found = await getContentListBlocks(key);
  assert.deepEqual(found, { blocks, listDirRel: 'sub' });
});

test('getContentListBlocks returns null for missing, malformed, or non-array content', async () => {
  config.storage.type = 'filesystem';

  assert.equal(await getContentListBlocks('QLMISSING3'), null);

  const badDir = fulltextDir('QLBADJSON4');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'content_list.json'), '{not json');
  assert.equal(await getContentListBlocks('QLBADJSON4'), null);

  const objectDir = fulltextDir('QLOBJECT05');
  fs.mkdirSync(objectDir, { recursive: true });
  fs.writeFileSync(path.join(objectDir, 'content_list.json'), JSON.stringify({ blocks: [] }));
  assert.equal(await getContentListBlocks('QLOBJECT05'), null);
});

test('resolveFullTextAsset resolves existing files under the item fulltext root', async () => {
  config.storage.type = 'filesystem';
  const key = 'QLASSET006';
  const root = fulltextDir(key);
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const asset = path.join(root, 'images', 'fig.png');
  fs.writeFileSync(asset, 'png');

  assert.equal(await resolveFullTextAsset(key, 'images/fig.png'), asset);
  assert.equal(await resolveFullTextAsset(key, ''), root);
});

test('resolveFullTextAsset rejects traversal and missing assets', async () => {
  config.storage.type = 'filesystem';
  const key = 'QLSAFE0007';
  const root = fulltextDir(key);
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  fs.writeFileSync(path.join(root, 'images', 'ok.png'), 'ok');
  fs.writeFileSync(path.join(storageRoot, key.slice(0, 2), key, 'secret.txt'), 'secret');

  assert.equal(await resolveFullTextAsset(key, 'images/missing.png'), null);
  assert.equal(await resolveFullTextAsset(key, '../secret.txt'), null);
  assert.equal(await resolveFullTextAsset(key, '../../../../etc/passwd'), null);
  assert.equal(await resolveFullTextAsset(key, '/etc/passwd'), null);
});
