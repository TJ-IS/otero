import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';

function compareIds(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function roundMetric(value, digits = 6) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

/**
 * Normalize a weighted, undirected graph into stable indexed adjacency lists.
 * Invalid/dangling edges, self-loops, and non-positive weights are ignored.
 * Duplicate or reversed edges are combined.
 */
function normalizeGraph(nodes, edges) {
  const sortedNodes = [...(nodes || [])].sort((a, b) => compareIds(a.id, b.id));
  const ids = sortedNodes.map((node) => node.id);
  const indexById = new Map(ids.map((id, index) => [id, index]));
  const edgeWeights = new Map();

  for (const edge of edges || []) {
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    const weight = Number(edge.weight);
    if (sourceIndex == null || targetIndex == null || sourceIndex === targetIndex) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const a = Math.min(sourceIndex, targetIndex);
    const b = Math.max(sourceIndex, targetIndex);
    const key = `${a}:${b}`;
    edgeWeights.set(key, (edgeWeights.get(key) || 0) + weight);
  }

  const adjacency = Array.from({ length: ids.length }, () => new Map());
  const stableEdges = [...edgeWeights.entries()].sort((a, b) => {
    const [aSource, aTarget] = a[0].split(':').map(Number);
    const [bSource, bTarget] = b[0].split(':').map(Number);
    return aSource - bSource || aTarget - bTarget;
  });
  for (const [key, weight] of stableEdges) {
    const [sourceIndex, targetIndex] = key.split(':').map(Number);
    adjacency[sourceIndex].set(targetIndex, weight);
    adjacency[targetIndex].set(sourceIndex, weight);
  }

  return { sortedNodes, ids, indexById, adjacency, edgeCount: edgeWeights.size };
}

function connectedComponents(adjacency) {
  const componentByIndex = new Array(adjacency.length).fill(-1);
  const components = [];

  for (let start = 0; start < adjacency.length; start += 1) {
    if (componentByIndex[start] !== -1) continue;
    const members = [];
    const stack = [start];
    componentByIndex[start] = components.length;

    while (stack.length) {
      const node = stack.pop();
      members.push(node);
      for (const neighbor of adjacency[node].keys()) {
        if (componentByIndex[neighbor] !== -1) continue;
        componentByIndex[neighbor] = components.length;
        stack.push(neighbor);
      }
    }
    components.push(members);
  }

  const order = components
    .map((members, oldId) => ({ oldId, members }))
    .sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0]);
  const stableId = new Map(order.map((entry, index) => [entry.oldId, index]));

  return {
    componentByIndex: componentByIndex.map((id) => stableId.get(id)),
    componentSizes: order.map((entry) => entry.members.length),
  };
}

/**
 * Deterministic, weighted, multi-level Louvain community detection. Nodes and
 * edges are inserted in stable order and random traversal is disabled; final
 * IDs are re-ranked by size so the same graph retains the same color mapping.
 */
function detectCommunities(adjacency) {
  const n = adjacency.length;
  if (n === 0) return { communityByIndex: [], communityCount: 0, modularity: 0 };
  const edgeCount = adjacency.reduce((total, neighbors) => total + neighbors.size, 0) / 2;
  if (edgeCount === 0) {
    return {
      communityByIndex: Array.from({ length: n }, (_, index) => index),
      communityCount: n,
      modularity: 0,
    };
  }

  const graph = new UndirectedGraph({ allowSelfLoops: false, multi: false });
  for (let index = 0; index < n; index += 1) graph.addNode(String(index));
  for (let source = 0; source < n; source += 1) {
    for (const [target, weight] of adjacency[source]) {
      if (source >= target) continue;
      graph.addUndirectedEdgeWithKey(`${source}:${target}`, String(source), String(target), {
        weight,
      });
    }
  }

  const details = louvain.detailed(graph, {
    getEdgeWeight: 'weight',
    randomWalk: false,
    resolution: 1,
  });
  const communityByIndex = Array.from(
    { length: n },
    (_, index) => details.communities[String(index)],
  );
  const membersByCommunity = new Map();
  for (let index = 0; index < n; index += 1) {
    const community = communityByIndex[index];
    if (!membersByCommunity.has(community)) membersByCommunity.set(community, []);
    membersByCommunity.get(community).push(index);
  }
  const orderedCommunities = [...membersByCommunity.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[1][0] - b[1][0],
  );
  const stableId = new Map(orderedCommunities.map(([oldId], index) => [oldId, index]));
  return {
    communityByIndex: communityByIndex.map((oldId) => stableId.get(oldId)),
    communityCount: orderedCommunities.length,
    modularity: roundMetric(details.modularity),
  };
}

function betweennessCentrality(adjacency) {
  // Deliberately topological: collaboration counts describe relationship
  // strength, not path distance. The UI labels this metric as topology-based.
  const n = adjacency.length;
  const centrality = new Array(n).fill(0);
  if (n < 3) return centrality;

  for (let source = 0; source < n; source += 1) {
    const stack = [];
    const predecessors = Array.from({ length: n }, () => []);
    const paths = new Array(n).fill(0);
    const distance = new Array(n).fill(-1);
    const queue = new Array(n);
    let head = 0;
    let tail = 0;

    paths[source] = 1;
    distance[source] = 0;
    queue[tail++] = source;

    while (head < tail) {
      const node = queue[head++];
      stack.push(node);
      for (const neighbor of adjacency[node].keys()) {
        if (distance[neighbor] < 0) {
          distance[neighbor] = distance[node] + 1;
          queue[tail++] = neighbor;
        }
        if (distance[neighbor] === distance[node] + 1) {
          paths[neighbor] += paths[node];
          predecessors[neighbor].push(node);
        }
      }
    }

    const dependency = new Array(n).fill(0);
    while (stack.length) {
      const node = stack.pop();
      for (const predecessor of predecessors[node]) {
        if (paths[node] > 0) {
          dependency[predecessor] += (paths[predecessor] / paths[node]) * (1 + dependency[node]);
        }
      }
      if (node !== source) centrality[node] += dependency[node];
    }
  }

  const denominator = (n - 1) * (n - 2);
  return centrality.map((value) => roundMetric(value / denominator));
}

function coreNumbers(adjacency) {
  const n = adjacency.length;
  const degrees = adjacency.map((neighbors) => neighbors.size);
  const active = new Array(n).fill(true);
  const core = new Array(n).fill(0);

  for (let removed = 0; removed < n; removed += 1) {
    let candidate = -1;
    for (let index = 0; index < n; index += 1) {
      if (!active[index]) continue;
      if (candidate === -1 || degrees[index] < degrees[candidate]) candidate = index;
    }
    if (candidate === -1) break;
    active[candidate] = false;
    core[candidate] = degrees[candidate];
    for (const neighbor of adjacency[candidate].keys()) {
      if (active[neighbor] && degrees[neighbor] > degrees[candidate]) degrees[neighbor] -= 1;
    }
  }
  return core;
}

/**
 * Add deterministic network metrics and community assignments to graph nodes.
 * All values describe the supplied (usually filtered and capped) graph only.
 */
export function analyzeUndirectedGraph(nodes = [], edges = []) {
  const { sortedNodes, adjacency, edgeCount } = normalizeGraph(nodes, edges);
  const { componentByIndex, componentSizes } = connectedComponents(adjacency);
  const detected = detectCommunities(adjacency);
  const connectedCommunityIds = [
    ...new Set(detected.communityByIndex.filter((_, index) => adjacency[index].size > 0)),
  ].sort((a, b) => a - b);
  const communityIdMap = new Map(connectedCommunityIds.map((id, index) => [id, index]));
  const communityByIndex = detected.communityByIndex.map((id, index) =>
    adjacency[index].size === 0 ? -1 : communityIdMap.get(id),
  );
  const communityCount = connectedCommunityIds.length;
  const modularity = detected.modularity;
  const betweenness = betweennessCentrality(adjacency);
  const core = coreNumbers(adjacency);

  const analyzedNodes = sortedNodes.map((node, index) => {
    let weightedDegree = 0;
    for (const weight of adjacency[index].values()) weightedDegree += weight;
    return {
      ...node,
      community: communityByIndex[index] ?? -1,
      component: componentByIndex[index] ?? index,
      metrics: {
        degree: adjacency[index].size,
        weightedDegree: roundMetric(weightedDegree),
        betweenness: betweenness[index] || 0,
        core: core[index] || 0,
      },
    };
  });

  const communities = Array.from({ length: communityCount }, (_, id) => ({
    id,
    nodeCount: 0,
    paperCount: 0,
  }));
  for (const node of analyzedNodes) {
    if (node.community < 0) continue;
    const summary = communities[node.community];
    summary.nodeCount += 1;
    summary.paperCount += Number(node.paperCount) || 0;
  }

  const n = analyzedNodes.length;
  return {
    nodes: analyzedNodes,
    communities,
    stats: {
      nodeCount: n,
      edgeCount,
      communityCount,
      componentCount: componentSizes.length,
      largestComponentSize: componentSizes[0] || 0,
      isolatedNodeCount: adjacency.filter((neighbors) => neighbors.size === 0).length,
      density: n > 1 ? roundMetric((2 * edgeCount) / (n * (n - 1))) : 0,
      modularity,
    },
  };
}
