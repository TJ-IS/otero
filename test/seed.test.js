import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedRows } from '../src/db/seed.js';

test('seed relations are complete and have unique composite keys', () => {
  const { itemTypeFields, itemTypeCreatorTypes } = buildSeedRows();

  assert.equal(itemTypeFields.length, 115);
  assert.equal(itemTypeCreatorTypes.length, 30);
  assert.equal(
    new Set(itemTypeFields.map(row => `${row.itemTypeId}:${row.fieldId}`)).size,
    itemTypeFields.length
  );
  assert.equal(
    new Set(itemTypeCreatorTypes.map(row => `${row.itemTypeId}:${row.creatorTypeId}`)).size,
    itemTypeCreatorTypes.length
  );
});
