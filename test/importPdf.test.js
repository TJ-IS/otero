import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { importPdf } from '../src/services/importService.js';
import { Item } from '../src/models/Item.js';
import { Attachment } from '../src/models/Attachment.js';
import { closeDb, setDb } from '../src/db/connection.js';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.join(__dirname, 'fixtures', 'sample.pdf');

function setup() {
  // In-memory DB to keep tests isolated. Schema must be (re)created each time.
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  setDb(db);
  runMigrations();
  seed();
  return db;
}

test('importPdf extracts metadata from PDF Info dict (fallback path)', async () => {
  const db = setup();
  try {
    const r = await importPdf(SAMPLE_PDF, { skipRecognize: false });
    assert.ok(r.attachment, 'attachment should be created');
    assert.equal(r.attachment.contentType, 'application/pdf');
    assert.match(r.attachment.path, /\.pdf$/);

    // No network in fallback path: source should be 'fallback'.
    assert.equal(r.recognized.source, 'fallback');

    assert.ok(r.parent, 'parent item should be created');
    assert.equal(r.parent.itemType, 'document');

    const reloaded = Item.loadByKey(r.parent.key);
    assert.equal(reloaded.getField('title'), 'Attention Is All You Need');
    assert.equal(reloaded.getField('DOI'), '10.5555/3295222.3295349');

    const atts = Attachment.listByParent(reloaded.id);
    assert.equal(atts.length, 1);
    assert.equal(atts[0].isPdf(), true);
  } finally {
    closeDb();
  }
});

test('importPdf with skipRecognize creates only an attachment', async () => {
  const db = setup();
  try {
    const r = await importPdf(SAMPLE_PDF, { skipRecognize: true });
    assert.ok(r.attachment);
    assert.equal(r.parent, null);
  } finally {
    closeDb();
  }
});
