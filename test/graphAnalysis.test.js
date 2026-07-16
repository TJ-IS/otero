import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeUndirectedGraph } from '../src/services/graphAnalysis.js';

function nodeById(result, id) {
  return result.nodes.find((node) => node.id === id);
}

test('analyzeUndirectedGraph handles empty, singleton, and isolated graphs', () => {
  const empty = analyzeUndirectedGraph([], []);
  assert.deepEqual(empty.nodes, []);
  assert.equal(empty.stats.nodeCount, 0);
  assert.equal(empty.stats.density, 0);

  const singleton = analyzeUndirectedGraph([{ id: 1, paperCount: 2 }], []);
  assert.equal(singleton.stats.componentCount, 1);
  assert.equal(singleton.stats.isolatedNodeCount, 1);
  assert.deepEqual(singleton.nodes[0].metrics, {
    degree: 0,
    weightedDegree: 0,
    betweenness: 0,
    core: 0,
  });
  assert.ok(Object.values(singleton.nodes[0].metrics).every(Number.isFinite));
});

test('analyzeUndirectedGraph calculates degree, strength, bridge, and core metrics', () => {
  const nodes = [1, 2, 3, 4].map((id) => ({ id, paperCount: id }));
  const edges = [
    { source: 1, target: 2, weight: 2 },
    { source: 2, target: 3, weight: 1 },
    { source: 3, target: 1, weight: 1 },
    { source: 3, target: 4, weight: 1 },
  ];
  const result = analyzeUndirectedGraph(nodes, edges);

  assert.equal(nodeById(result, 1).metrics.degree, 2);
  assert.equal(nodeById(result, 1).metrics.weightedDegree, 3);
  assert.equal(nodeById(result, 3).metrics.degree, 3);
  assert.equal(nodeById(result, 4).metrics.degree, 1);
  assert.equal(nodeById(result, 1).metrics.core, 2);
  assert.equal(nodeById(result, 4).metrics.core, 1);
  assert.ok(nodeById(result, 3).metrics.betweenness > nodeById(result, 1).metrics.betweenness);
  assert.ok(result.nodes.every((node) => Object.values(node.metrics).every(Number.isFinite)));
});

test('analyzeUndirectedGraph finds two dense communities connected by a weak bridge', () => {
  const nodes = [1, 2, 3, 4, 5, 6].map((id) => ({ id, paperCount: 1 }));
  const edges = [
    { source: 1, target: 2, weight: 3 },
    { source: 1, target: 3, weight: 3 },
    { source: 2, target: 3, weight: 3 },
    { source: 4, target: 5, weight: 3 },
    { source: 4, target: 6, weight: 3 },
    { source: 5, target: 6, weight: 3 },
    { source: 3, target: 4, weight: 1 },
  ];
  const result = analyzeUndirectedGraph(nodes, edges);

  assert.equal(result.stats.communityCount, 2);
  assert.equal(nodeById(result, 1).community, nodeById(result, 3).community);
  assert.equal(nodeById(result, 4).community, nodeById(result, 6).community);
  assert.notEqual(nodeById(result, 3).community, nodeById(result, 4).community);
  assert.ok(nodeById(result, 3).metrics.betweenness > 0);
  assert.ok(nodeById(result, 4).metrics.betweenness > 0);
});

test('analyzeUndirectedGraph is stable and does not mutate its inputs', () => {
  const nodes = [{ id: 2, paperCount: 3 }, { id: 1, paperCount: 2 }, { id: 3, paperCount: 1 }];
  const edges = [
    { source: 2, target: 1, weight: 2 },
    { source: 3, target: 2, weight: 1 },
  ];
  const snapshot = structuredClone({ nodes, edges });
  const first = analyzeUndirectedGraph(nodes, edges);
  const second = analyzeUndirectedGraph([...nodes].reverse(), [...edges].reverse());

  assert.deepEqual({ nodes, edges }, snapshot);
  assert.deepEqual(first, second);
});

test('analyzeUndirectedGraph ignores invalid edges and combines duplicates', () => {
  const result = analyzeUndirectedGraph(
    [{ id: 1 }, { id: 2 }],
    [
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 1, weight: 2 },
      { source: 1, target: 1, weight: 5 },
      { source: 1, target: 99, weight: 5 },
      { source: 1, target: 2, weight: 0 },
    ],
  );

  assert.equal(result.stats.edgeCount, 1);
  assert.equal(nodeById(result, 1).metrics.weightedDegree, 3);
  assert.equal(nodeById(result, 2).metrics.weightedDegree, 3);
});

test('analyzeUndirectedGraph performs multi-level community aggregation', () => {
  const nodes = Array.from({ length: 200 }, (_, id) => ({ id }));
  const edges = Array.from({ length: 199 }, (_, source) => ({
    source,
    target: source + 1,
    weight: 1,
  }));
  const result = analyzeUndirectedGraph(nodes, edges);

  // A one-level local move fragments this path into ~100 pairs. Complete
  // Louvain should aggregate those pairs into a much smaller higher-level set.
  assert.ok(result.stats.communityCount < 40);
  assert.ok(result.stats.modularity > 0.8);
});
