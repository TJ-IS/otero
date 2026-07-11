import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetTestDb, closeDb } from './helpers/pg.js';
import { Item, Items } from '../src/models/Item.js';
import { Collection, Collections } from '../src/models/Collection.js';

before(async () => {
  await resetTestDb();
});

after(async () => {
  await closeDb();
});

test('Item CRUD: create, load, update, soft delete', async () => {
  await resetTestDb();
  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', 'Test Paper');
  it.setField('DOI', '10.1000/xyz');
  it.addCreator({ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' });
  await it.save();
  assert.ok(it.id);
  assert.ok(it.key);

  const loaded = await Item.loadByKey(it.key);
  assert.equal(loaded.getField('title'), 'Test Paper');
  assert.equal(loaded.getField('DOI'), '10.1000/xyz');
  assert.equal(loaded.creators.length, 1);
  assert.equal(loaded.creators[0].lastName, 'Lovelace');

  loaded.setField('date', '2024-01-01');
  await loaded.save();
  const reloaded = await Item.loadByKey(it.key);
  assert.equal(reloaded.getField('date'), '2024-01-01');

  assert.equal((await Items.list()).length, 1);
  await reloaded.delete();
  assert.equal((await Items.list()).length, 0);
  assert.equal((await Items.list({ includeDeleted: true })).length, 1);
});

test('Item rejects unknown itemType', async () => {
  await resetTestDb();
  const it = new Item();
  await assert.rejects(() => it.setItemType('notARealType'));
});

test('Collection CRUD and addItem', async () => {
  await resetTestDb();
  const col = new Collection({ name: 'ML' });
  await col.save();
  assert.ok(col.key);

  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', 'Paper A');
  await it.save();

  await col.addItem(it.id);
  const loaded = await Collection.loadByKey(col.key);
  const items = await loaded.items();
  assert.equal(items.length, 1);
  assert.equal(items[0].key, it.key);

  const listed = await Collections.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'ML');
});
