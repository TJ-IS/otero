import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { config } from '../src/config.js';
import { importPdf } from '../src/services/importService.js';
import { Item } from '../src/models/Item.js';
import { Attachment } from '../src/models/Attachment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.join(__dirname, 'fixtures', 'sample.pdf');
const createdKeys = [];

before(async () => {
  // Keep PDF import tests independent of local MinIO TLS settings.
  config.storage.type = 'filesystem';
  await prepareTestDb();
});

after(async () => {
  for (const key of createdKeys.splice(0)) {
    const it = await Item.loadByKey(key);
    if (it) await it.delete(true);
  }
  await closeDb();
});

test('importPdf extracts metadata from PDF Info dict (fallback path)', async () => {
  const r = await importPdf(SAMPLE_PDF, { skipRecognize: false });
  assert.ok(r.attachment, 'attachment should be created');
  createdKeys.push(r.attachment.key);
  assert.equal(r.attachment.contentType, 'application/pdf');
  assert.match(r.attachment.path, /\.pdf$/);

  assert.equal(r.recognized.source, 'fallback');
  assert.ok(r.parent, 'parent item should be created');
  createdKeys.push(r.parent.key);
  assert.equal(r.parent.itemType, 'document');

  const reloaded = await Item.loadByKey(r.parent.key);
  assert.equal(reloaded.getField('title'), 'Attention Is All You Need');
  assert.equal(reloaded.getField('DOI'), '10.5555/3295222.3295349');

  const atts = await Attachment.listByParent(reloaded.id);
  assert.equal(atts.length, 1);
  assert.equal(atts[0].isPdf(), true);
});

test('importPdf with skipRecognize creates only an attachment', async () => {
  const r = await importPdf(SAMPLE_PDF, { skipRecognize: true });
  assert.ok(r.attachment);
  createdKeys.push(r.attachment.key);
  assert.equal(r.parent, null);
});
