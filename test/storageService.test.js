import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '../src/config.js';
import { getS3Client } from '../src/services/s3Client.js';
import {
  storagePathForKey,
  storeFile,
  resolveStoredPath,
  readStoredFile,
  storedFileExists,
  deleteStoredFile,
  deleteStoredPrefix,
  listStoredPrefix,
  uploadDir,
} from '../src/services/storageService.js';

// All filesystem writes in this file go under a throwaway temp directory so
// the real data/storage tree is never touched.
let storageRoot;
let srcRoot;

const originalStorageDir = config.storageDir;
const originalStorageType = config.storage.type;

before(() => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'otero-storage-test-'));
  srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'otero-storage-src-'));
  config.storage.type = 'filesystem';
  config.storageDir = storageRoot;
});

after(() => {
  config.storageDir = originalStorageDir;
  config.storage.type = originalStorageType;
  fs.rmSync(storageRoot, { recursive: true, force: true });
  fs.rmSync(srcRoot, { recursive: true, force: true });
});

function uniqueKey(prefix) {
  return `${prefix}${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function writeSource(name, content) {
  const dir = fs.mkdtempSync(path.join(srcRoot, 'case-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test('storagePathForKey shards by the first two key characters', () => {
  assert.equal(storagePathForKey('ABCDEF', 'pdf'), path.join('AB', 'ABCDEF.pdf'));
  assert.equal(storagePathForKey('ZZ1234', 'pdf'), path.join('ZZ', 'ZZ1234.pdf'));
  assert.equal(storagePathForKey('a1b2c3', 'md'), path.join('a1', 'a1b2c3.md'));
  // Default extension is pdf.
  assert.equal(storagePathForKey('Q9WXYZ'), path.join('Q9', 'Q9WXYZ.pdf'));
});

test('storeFile round-trips content and reports accurate metadata', async () => {
  config.storage.type = 'filesystem';
  const key = uniqueKey('RT');
  const content = 'round-trip payload with unicode: 文献\n';
  const src = writeSource('paper.pdf', content);

  const expectedStat = fs.statSync(src);
  const expectedMd5 = crypto.createHash('md5').update(Buffer.from(content)).digest('hex');

  const stored = await storeFile(src, key);

  assert.deepEqual(Object.keys(stored).sort(), ['md5', 'mtime', 'path', 'size']);
  assert.equal(stored.path, storagePathForKey(key, 'pdf'));
  assert.equal(stored.size, expectedStat.size);
  assert.equal(stored.size, Buffer.byteLength(content));
  assert.equal(stored.md5, expectedMd5);
  assert.equal(stored.mtime, expectedStat.mtimeMs);

  assert.equal(await storedFileExists(stored.path), true);
  assert.deepEqual(await readStoredFile(stored.path), Buffer.from(content));

  await deleteStoredFile(stored.path);
  assert.equal(await storedFileExists(stored.path), false);
  assert.equal(fs.existsSync(path.join(storageRoot, stored.path)), false);
});

test('storeFile infers extension from the source path and honours a caller override', async () => {
  config.storage.type = 'filesystem';
  const inferredKey = uniqueKey('EX');
  const overrideKey = uniqueKey('OV');

  const inferred = await storeFile(writeSource('source.PDF', 'a'), inferredKey);
  assert.equal(inferred.path, storagePathForKey(inferredKey, 'PDF'));

  const overridden = await storeFile(writeSource('source.bin', 'b'), overrideKey, { ext: 'md' });
  assert.equal(overridden.path, storagePathForKey(overrideKey, 'md'));
});

test('storeFile move:true removes the source, move:false keeps it', async () => {
  config.storage.type = 'filesystem';

  const movedSrc = writeSource('moved.pdf', 'move me');
  const moved = await storeFile(movedSrc, uniqueKey('MV'), { move: true });
  assert.equal(fs.existsSync(movedSrc), false, 'source should be gone after move');
  assert.equal((await readStoredFile(moved.path)).toString(), 'move me');

  const keptSrc = writeSource('kept.pdf', 'copy me');
  const kept = await storeFile(keptSrc, uniqueKey('CP'), { move: false });
  assert.equal(fs.existsSync(keptSrc), true, 'source should remain after copy');
  assert.equal((await readStoredFile(kept.path)).toString(), 'copy me');
});

test('resolveStoredPath joins relative paths and passes absolute paths through', async () => {
  config.storage.type = 'filesystem';

  const rel = storagePathForKey('AB1234', 'pdf');
  assert.equal(resolveStoredPath(rel), path.join(storageRoot, rel));

  const abs = path.join(storageRoot, 'CD', 'CD9999.pdf');
  assert.equal(resolveStoredPath(abs), abs);

  // A stored relative path resolves to the file storeFile actually wrote.
  const stored = await storeFile(writeSource('r.pdf', 'resolved'), 'EF5678');
  assert.equal(resolveStoredPath(stored.path), path.join(storageRoot, stored.path));
  assert.equal(fs.existsSync(resolveStoredPath(stored.path)), true);
});

test('readStoredFile rejects and deleteStoredFile is a no-op for a missing file', async () => {
  config.storage.type = 'filesystem';
  const missing = storagePathForKey('MI0000', 'pdf');

  await assert.rejects(readStoredFile(missing), { code: 'ENOENT' });
  await deleteStoredFile(missing); // must not throw
  assert.equal(await storedFileExists(missing), false);
});

test('listStoredPrefix/deleteStoredPrefix are inert in filesystem mode', async () => {
  config.storage.type = 'filesystem';
  const stored = await storeFile(writeSource('fs.pdf', 'filesystem'), 'FS0001');

  assert.deepEqual(await listStoredPrefix('FS'), []);
  await deleteStoredPrefix('FS'); // no-op, must not throw
  assert.equal(await storedFileExists(stored.path), true);
});

test('uploadDir uploads nested files and prefix list/delete operate on them', async () => {
  config.storage.type = 's3';

  // In-memory stand-in for the S3 client. No socket is ever opened: only the
  // storageService logic (walk + naming + prefix filtering) is under test.
  const client = getS3Client();
  const saved = new Map();
  for (const name of ['bucketExists', 'fPutObject', 'listObjectsV2', 'removeObjects']) {
    saved.set(name, {
      hadOwn: Object.prototype.hasOwnProperty.call(client, name),
      value: client[name],
    });
  }

  const objects = new Map();
  client.bucketExists = async () => true;
  client.fPutObject = async (_bucket, objectName, localPath) => {
    objects.set(objectName, fs.readFileSync(localPath));
    return 'fake-etag';
  };
  client.listObjectsV2 = (_bucket, prefix) =>
    Readable.from(
      [...objects.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
    );
  client.removeObjects = async (_bucket, list) => {
    for (const obj of list) objects.delete(obj.name);
  };

  try {
    const localDir = fs.mkdtempSync(path.join(srcRoot, 'upload-'));
    fs.writeFileSync(path.join(localDir, 'root.txt'), 'root');
    fs.mkdirSync(path.join(localDir, 'nested', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(localDir, 'nested', 'a.txt'), 'A');
    fs.writeFileSync(path.join(localDir, 'nested', 'deep', 'b.txt'), 'B');

    const prefix = 'UP/ITEMKEY/fulltext';
    const uploaded = await uploadDir(localDir, prefix);
    assert.deepEqual(
      uploaded.sort(),
      [`${prefix}/nested/a.txt`, `${prefix}/nested/deep/b.txt`, `${prefix}/root.txt`].sort(),
    );
    assert.equal(objects.get(`${prefix}/nested/deep/b.txt`).toString(), 'B');

    const listed = await listStoredPrefix(prefix);
    assert.deepEqual(listed.sort(), uploaded.slice().sort());

    const narrowed = await listStoredPrefix(`${prefix}/nested/deep`);
    assert.deepEqual(narrowed, [`${prefix}/nested/deep/b.txt`]);

    await deleteStoredPrefix(prefix);
    assert.deepEqual(await listStoredPrefix(prefix), []);
    assert.equal(objects.size, 0);
  } finally {
    for (const [name, { hadOwn, value }] of saved) {
      if (hadOwn) client[name] = value;
      else delete client[name];
    }
    config.storage.type = 'filesystem';
  }
});
