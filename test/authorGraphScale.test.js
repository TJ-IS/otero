import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeMetricValue, radiusScale } from '../web/src/lib/authorGraph.js';

test('radiusScale supports normalized metrics whose maximum is one', () => {
  assert.equal(radiusScale(0, 1, 0), 6);
  assert.equal(radiusScale(1, 1, 0), 72);
  assert.ok(radiusScale(0.25, 1, 0) > 6);
  assert.ok(radiusScale(0.25, 1, 0) < 72);
  assert.equal(radiusScale(1, 1, 1), 16);
});

test('nodeMetricValue reads each supported server metric safely', () => {
  const node = {
    paperCount: 8,
    metrics: { degree: 4, weightedDegree: 7, betweenness: 0.125 },
  };
  assert.equal(nodeMetricValue(node, 'paperCount'), 8);
  assert.equal(nodeMetricValue(node, 'degree'), 4);
  assert.equal(nodeMetricValue(node, 'weightedDegree'), 7);
  assert.equal(nodeMetricValue(node, 'betweenness'), 0.125);
  assert.equal(nodeMetricValue({}, 'degree'), 0);
});
