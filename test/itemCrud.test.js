import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { setDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
import { Item, Items } from '../src/models/Item.js';
import { Collection, Collections } from '../src/models/Collection.js';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  setDb(db);
  runMigrations();
  seed();
  return db;
}

test('Item CRUD: create, load, update, soft delete', () => {
  setup();
  try {
    const it = new Item();
    it.setItemType('journalArticle');
    it.setField('title', 'Test Paper');
    it.setField('DOI', '10.1000/xyz');
    it.addCreator({ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' });
    it.save();
    assert.ok(it.id);
    assert.ok(it.key);

    const loaded = Item.loadByKey(it.key);
    assert.equal(loaded.getField('title'), 'Test Paper');
    assert.equal(loaded.getField('DOI'), '10.1000/xyz');
    assert.equal(loaded.creators.length, 1);
    assert.equal(loaded.creators[0].lastName, 'Lovelace');

    loaded.setField('date', '2024-01-01').save();
    const reloaded = Item.loadByKey(it.key);
    assert.equal(reloaded.getField('date'), '2024-01-01');

    assert.equal(Items.list().length, 1);
    reloaded.delete();
    assert.equal(Items.list().length, 0);
    assert.equal(Items.list({ includeDeleted: true }).length, 1);
  } finally {
    closeDb();
  }
});

test('Item rejects unknown itemType', () => {
  setup();
  try {
    const it = new Item();
    assert.throws(() => it.setItemType('notARealType'));
  } finally {
    closeDb();
  }
});

test('Collection CRUD and addItem', () => {
  setup();
  try {
    const col = new Collection({ name: 'ML' });
    col.save();
    assert.ok(col.key);

    const it = new Item();
    it.setItemType('journalArticle');
    it.setField('title', 'Paper A');
    it.save();

    col.addItem(it.id);
    const loaded = Collection.loadByKey(col.key);
    assert.equal(loaded.items().length, 1);
    assert.equal(loaded.items()[0].key, it.key);

    const listed = Collections.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'ML');
  } finally {
    closeDb();
  }
});
