import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { Item, Items } from '../src/models/Item.js';
import { Collection, Collections } from '../src/models/Collection.js';

const createdItemKeys = [];
const createdCollectionKeys = [];

before(async () => {
  await prepareTestDb();
});

after(async () => {
  for (const key of createdCollectionKeys.splice(0)) {
    const col = await Collection.loadByKey(key);
    if (col) await col.delete();
  }
  for (const key of createdItemKeys.splice(0)) {
    const it = await Item.loadByKey(key);
    if (it) await it.delete(true);
  }
  await closeDb();
});

test('Item CRUD: create, load, update, soft delete', async () => {
  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', 'Test Paper');
  it.setField('DOI', `10.1000/xyz-crud-${Date.now()}`);
  it.addCreator({ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' });
  await it.save();
  createdItemKeys.push(it.key);
  assert.ok(it.id);
  assert.ok(it.key);

  const loaded = await Item.loadByKey(it.key);
  assert.equal(loaded.getField('title'), 'Test Paper');
  assert.equal(loaded.getField('DOI'), it.getField('DOI'));
  assert.equal(loaded.creators.length, 1);
  assert.equal(loaded.creators[0].lastName, 'Lovelace');

  loaded.setField('date', '2024-01-01');
  await loaded.save();
  const reloaded = await Item.loadByKey(it.key);
  assert.equal(reloaded.getField('date'), '2024-01-01');

  assert.ok((await Items.list()).items.some(x => x.key === it.key));
  await reloaded.delete();
  assert.ok(!(await Items.list()).items.some(x => x.key === it.key));
  assert.ok((await Items.list({ includeDeleted: true })).items.some(x => x.key === it.key));
});

test('Item rejects unknown itemType', async () => {
  const it = new Item();
  await assert.rejects(() => it.setItemType('notARealType'));
});

test('Collection CRUD and addItem', async () => {
  const col = new Collection({ name: `ML-${Date.now()}` });
  await col.save();
  createdCollectionKeys.push(col.key);
  assert.ok(col.key);

  const it = new Item();
  await it.setItemType('journalArticle');
  it.setField('title', 'Paper A');
  await it.save();
  createdItemKeys.push(it.key);

  await col.addItem(it.id);
  const loaded = await Collection.loadByKey(col.key);
  const items = await loaded.items();
  assert.equal(items.length, 1);
  assert.equal(items[0].key, it.key);

  const listed = await Collections.list();
  assert.ok(listed.some(c => c.key === col.key && c.name === col.name));
});
