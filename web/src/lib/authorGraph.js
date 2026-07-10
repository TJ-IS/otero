// Force-directed layout for the author co-authorship bubble map.
// Uses d3-force purely for physics; rendering is plain React/SVG.

import { useEffect, useRef, useState } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
} from 'd3-force';

// Bubble radius scales with sqrt(paperCount) so *area* (not radius) tracks
// paper count linearly, matching how humans perceive bubble size.
const MIN_RADIUS = 6;
const MAX_RADIUS = 72;
// >1 pushes low/mid paperCount nodes down relative to the top end, so hub
// authors balloon out while small nodes stay near MIN_RADIUS — exaggerates
// the visual contrast instead of the strictly area-linear sqrt scaling.
const EXAGGERATION = 1.5;

export function radiusScale(paperCount, maxPaperCount) {
  if (!maxPaperCount || maxPaperCount <= 1) return MIN_RADIUS;
  const t = Math.pow(Math.sqrt(paperCount) / Math.sqrt(maxPaperCount), EXAGGERATION);
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
}

/**
 * Runs a d3-force simulation over { nodes, edges } and returns live node
 * positions (id -> {x,y,radius,...}) as the simulation ticks, plus the
 * simulation instance for external control (e.g. reheating on resize).
 */
export function useForceLayout(nodes, edges, { width, height }) {
  const [positions, setPositions] = useState(new Map());
  const simRef = useRef(null);

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      setPositions(new Map());
      return;
    }
    const maxPaperCount = Math.max(...nodes.map(n => n.paperCount));
    // d3-force mutates node objects in place (adds x/y/vx/vy) — clone so we
    // don't mutate the caller's data across re-runs.
    const simNodes = nodes.map(n => ({
      ...n,
      radius: radiusScale(n.paperCount, maxPaperCount),
    }));
    const simLinks = edges.map(e => ({ ...e }));

    // Stronger repulsion pushes disconnected authors/components apart so
    // separate collaboration circles read as distinct clusters instead of
    // one blob. Link strength/distance scale with co-authorship weight so
    // frequent collaborators clump tightly while one-off links stretch,
    // making the sub-community structure visible.
    const sim = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-450).distanceMax(900))
      .force('link', forceLink(simLinks).id(d => d.id)
        .distance(d => 100 + 120 / Math.sqrt(d.weight))
        .strength(d => Math.min(1, 0.25 + d.weight * 0.15)))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide(d => d.radius + 8))
      .alphaDecay(0.02);

    simRef.current = sim;

    sim.on('tick', () => {
      const next = new Map();
      for (const n of simNodes) next.set(n.id, n);
      setPositions(next);
    });

    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height]);

  return positions;
}
