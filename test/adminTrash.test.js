import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyTrashWithClient } from '../src/services/adminService.js';

test('empty trash uses one bulk delete and cleans orphan dictionaries', async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      if (statements.length === 1) {
        return { rows: [{ rootItems: 2, ids: [10, 11, 12, 13, 14] }], rowCount: 1 };
      }
      if (statements.length <= 4) return { rows: [], rowCount: 1 };
      if (statements.length === 5) return { rows: [], rowCount: 5 };
      if (statements.length === 6) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 7 };
    },
  };

  const result = await emptyTrashWithClient(client);

  assert.equal(statements.length, 7);
  assert.match(statements[0], /WITH RECURSIVE item_edges/);
  assert.match(statements[1], /DELETE FROM "itemAttachments"/);
  assert.match(statements[2], /DELETE FROM "itemNotes"/);
  assert.match(statements[3], /DELETE FROM "itemAnnotations"/);
  assert.match(statements[4], /DELETE FROM items/);
  assert.match(statements[5], /DELETE FROM creators/);
  assert.match(statements[6], /DELETE FROM "itemDataValues"/);
  assert.deepEqual(
    {
      rootItems: result.rootItems,
      deletedItems: result.deletedItems,
      orphanCreators: result.orphanCreators,
      orphanValues: result.orphanValues,
    },
    { rootItems: 2, deletedItems: 5, orphanCreators: 3, orphanValues: 7 }
  );
});
