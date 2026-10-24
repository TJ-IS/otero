// Force-directed layout for the author co-authorship bubble map.
// Uses d3-force purely for physics; rendering is plain React/SVG.

import { useEffect, useRef, useState } from 'react';
import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force';

// Bubble radius scales with sqrt(paperCount) so *area* (not radius) tracks
// paper count linearly, matching how humans perceive bubble size.
const MIN_RADIUS = 6;
const MAX_RADIUS = 72;
const UNIFORM_RADIUS = 16;
// >1 pushes low/mid paperCount nodes down relative to the top end, so hub
// authors balloon out while small nodes stay near MIN_RADIUS — exaggerates
// the visual contrast instead of the strictly area-linear sqrt scaling.
const EXAGGERATION = 1.5;

export function radiusScale(value, maxValue, minValue = maxValue) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return MIN_RADIUS;
  if (maxValue === minValue) return UNIFORM_RADIUS;
  const safeValue = Math.max(0, Number(value) || 0);
  const t = Math.pow(Math.sqrt(safeValue) / Math.sqrt(maxValue), EXAGGERATION);
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
}

export function nodeMetricValue(node, metric = 'paperCount') {
  if (metric === 'degree') return Number(node.metrics?.degree) || 0;
  if (metric === 'weightedDegree') return Number(node.metrics?.weightedDegree) || 0;
  if (metric === 'betweenness') return Number(node.metrics?.betweenness) || 0;
  return Number(node.paperCount) || 0;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function settleInFrames(simulation, tickCount, onComplete) {
  let remaining = tickCount;
  let frame = null;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    const batch = Math.min(6, remaining);
    simulation.tick(batch);
    remaining -= batch;
    if (remaining <= 0) {
      onComplete();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    if (frame != null) cancelAnimationFrame(frame);
  };
}

/**
 * Runs a d3-force simulation over { nodes, edges } and returns live node
 * positions (id -> {x,y,radius,...}) as the simulation ticks, plus the
 * simulation instance for external control (e.g. reheating on resize).
 */
export function useForceLayout(nodes, edges, { width, height, sizeMetric = 'paperCount' }) {
  const [positions, setPositions] = useState(new Map());
  const [settled, setSettled] = useState(false);
  const simRef = useRef(null);
  const latestPositionsRef = useRef(new Map());
  const publishRef = useRef(null);
  const reducedSettleCancelRef = useRef(null);
  const simulationSizeRef = useRef({ width: null, height: null });
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      setPositions(new Map());
      setSettled(true);
      return;
    }
    setSettled(false);
    if (reducedMotion) setPositions(new Map());
    const metricValues = nodes.map((node) => nodeMetricValue(node, sizeMetric));
    const maxMetricValue = Math.max(...metricValues);
    const minMetricValue = Math.min(...metricValues);
    // d3-force mutates node objects in place (adds x/y/vx/vy) — clone so we
    // don't mutate the caller's data across re-runs.
    const simNodes = nodes.map((node) => {
      const previous = latestPositionsRef.current.get(node.id);
      return {
        ...node,
        x: previous?.x,
        y: previous?.y,
        radius: radiusScale(nodeMetricValue(node, sizeMetric), maxMetricValue, minMetricValue),
      };
    });
    const simLinks = edges.map((e) => ({ ...e }));

    // Stronger repulsion pushes disconnected authors/components apart so
    // separate collaboration circles read as distinct clusters instead of
    // one blob. Link strength/distance scale with co-authorship weight so
    // frequent collaborators clump tightly while one-off links stretch,
    // making the sub-community structure visible.
    const sim = forceSimulation(simNodes)
      .force('charge', forceManyBody().strength(-450).distanceMax(900))
      .force(
        'link',
        forceLink(simLinks)
          .id((d) => d.id)
          .distance((d) => 100 + 120 / Math.sqrt(d.weight))
          .strength((d) => Math.min(1, 0.25 + d.weight * 0.15)),
      )
      .force('center', forceCenter(width / 2, height / 2))
      .force(
        'collide',
        forceCollide((d) => d.radius + 8),
      )
      .alphaDecay(0.035);

    simRef.current = sim;
    simulationSizeRef.current = { width, height };

    let lastPublishedAt = 0;
    const publish = () => {
      const next = new Map();
      for (const n of simNodes) next.set(n.id, n);
      latestPositionsRef.current = next;
      setPositions(next);
    };
    publishRef.current = publish;

    if (reducedMotion) {
      sim.stop();
      reducedSettleCancelRef.current?.();
      const cancel = settleInFrames(sim, 220, () => {
        if (simRef.current !== sim) return;
        publish();
        setSettled(true);
        if (reducedSettleCancelRef.current === cancel) reducedSettleCancelRef.current = null;
      });
      reducedSettleCancelRef.current = cancel;
    } else {
      sim.on('tick', () => {
        const now = globalThis.performance?.now?.() ?? Date.now();
        if (now - lastPublishedAt < 30 && sim.alpha() > sim.alphaMin() * 2) return;
        lastPublishedAt = now;
        publish();
      });
      sim.on('end', () => {
        publish();
        setSettled(true);
      });
    }

    return () => {
      reducedSettleCancelRef.current?.();
      reducedSettleCancelRef.current = null;
      sim.stop();
      sim.on('tick', null);
      sim.on('end', null);
      simRef.current = null;
      publishRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, sizeMetric, reducedMotion]);

  useEffect(() => {
    const simulation = simRef.current;
    if (!simulation) return;
    const previousSize = simulationSizeRef.current;
    if (previousSize.width === width && previousSize.height === height) return;
    simulationSizeRef.current = { width, height };
    setSettled(false);
    simulation.force('center', forceCenter(width / 2, height / 2));
    simulation.alpha(Math.max(simulation.alpha(), 0.18));
    if (reducedMotion) {
      simulation.stop();
      reducedSettleCancelRef.current?.();
      const cancel = settleInFrames(simulation, 220, () => {
        if (simRef.current !== simulation) return;
        publishRef.current?.();
        setSettled(true);
        if (reducedSettleCancelRef.current === cancel) reducedSettleCancelRef.current = null;
      });
      reducedSettleCancelRef.current = cancel;
      return () => {
        cancel();
        if (reducedSettleCancelRef.current === cancel) reducedSettleCancelRef.current = null;
      };
    } else {
      simulation.restart();
    }
    return undefined;
  }, [width, height, reducedMotion]);

  return { positions, settled, reducedMotion };
}
