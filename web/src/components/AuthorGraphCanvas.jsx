import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, LocateFixed, Minus, Network, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CATEGORICAL_COLORS } from '@/lib/chartColors';
import { useForceLayout } from '@/lib/authorGraph';
import { GRAPH_MIN_ZOOM, useGraphViewport } from '@/hooks/useGraphViewport';

const MAX_COLORED_COMMUNITIES = CATEGORICAL_COLORS.length;
const DEFAULT_ZOOM = 0.78;

function centeredView(width, height, k = DEFAULT_ZOOM) {
  return {
    x: (width * (1 - k)) / 2,
    y: (height * (1 - k)) / 2,
    k,
  };
}

function fitView(positions, { width, height }, { rightInset = 0, bottomInset = 0 } = {}) {
  const values = [...positions.values()];
  if (!values.length || width <= 0 || height <= 0) return centeredView(width, height);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of values) {
    const radius = Number(node.radius) || 0;
    minX = Math.min(minX, node.x - radius);
    minY = Math.min(minY, node.y - radius);
    maxX = Math.max(maxX, node.x + radius);
    maxY = Math.max(maxY, node.y + radius);
  }
  const padding = width < 640 ? 24 : 48;
  const availableWidth = Math.max(120, width - rightInset - padding * 2);
  const availableHeight = Math.max(120, height - bottomInset - padding * 2);
  const graphWidth = Math.max(1, maxX - minX);
  const graphHeight = Math.max(1, maxY - minY);
  const k = Math.min(
    1.1,
    Math.max(GRAPH_MIN_ZOOM, Math.min(availableWidth / graphWidth, availableHeight / graphHeight)),
  );
  const screenCenterX = padding + availableWidth / 2;
  const screenCenterY = padding + availableHeight / 2;
  return {
    x: screenCenterX - ((minX + maxX) / 2) * k,
    y: screenCenterY - ((minY + maxY) / 2) * k,
    k,
  };
}

function communityColor(community) {
  if (!Number.isInteger(community) || community < 0 || community >= MAX_COLORED_COMMUNITIES) {
    return 'hsl(var(--muted-foreground))';
  }
  return CATEGORICAL_COLORS[community];
}

function formatMetric(value, metric, lng) {
  if (metric === 'betweenness') return `${((Number(value) || 0) * 100).toFixed(1)}%`;
  return Number(value || 0).toLocaleString(lng || 'zh-CN');
}

function graphLabel(name, unnamedLabel) {
  const value = name || unnamedLabel;
  return value.length > 22 ? `${value.slice(0, 21)}…` : value;
}

const GraphScene = memo(function GraphScene({
  nodes,
  edges,
  positions,
  neighborIds,
  matchedIds,
  hoveredId,
  selectedId,
  keyboardFocusId,
  onHover,
  onSelect,
  onOpenAuthor,
  onFocusNode,
  onEnsureVisible,
  onKeyboardFocus,
  onKeyboardMove,
  dragMovedRef,
}) {
  const { t } = useTranslation('dashboard');
  const unnamedLabel = t('authors.unnamed');

  return (
    <>
      <g>
        {edges.map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          if (!source || !target) return null;
          const dimmed = neighborIds
            && !(neighborIds.has(edge.source) && neighborIds.has(edge.target));
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={Math.min(3.5, 0.55 + Math.sqrt(edge.weight) * 0.7)}
              strokeOpacity={dimmed ? 0.035 : Math.min(0.58, 0.12 + edge.weight * 0.1)}
            />
          );
        })}
      </g>

      <g>
        {nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          const isHovered = hoveredId === node.id;
          const isSelected = selectedId === node.id;
          const isKeyboardTarget = keyboardFocusId === node.id;
          const isMatched = matchedIds?.has(node.id);
          const dimmedByFocus = neighborIds && !neighborIds.has(node.id);
          const dimmedBySearch = !neighborIds && matchedIds && matchedIds.size > 0
            && !isMatched && !isSelected;
          const dimmed = dimmedByFocus || dimmedBySearch;
          const fill = communityColor(node.community);
          const mutedCommunity = node.community < 0 || node.community >= MAX_COLORED_COMMUNITIES;
          const showLabel = position.radius > 16 || isHovered || isSelected || isMatched;
          const displayName = node.name || unnamedLabel;
          const degree = node.metrics?.degree || 0;
          return (
            <g
              key={node.id}
              transform={`translate(${position.x},${position.y})`}
              role="button"
              tabIndex={isKeyboardTarget ? 0 : -1}
              data-node-id={node.id}
              aria-label={t('authors.nodeAria', { name: displayName, papers: node.paperCount, degree })}
              onMouseEnter={() => onHover(node.id)}
              onMouseLeave={() => onHover((current) => (current === node.id ? null : current))}
              onFocus={() => {
                onKeyboardFocus(node.id);
                onHover(node.id);
                onEnsureVisible(node.id);
              }}
              onBlur={() => onHover((current) => (current === node.id ? null : current))}
              onClick={(event) => {
                event.stopPropagation();
                if (!dragMovedRef.current) {
                  onKeyboardFocus(node.id);
                  onSelect(node.id);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenAuthor(node.id);
                } else if (event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(node.id);
                } else if (event.key.startsWith('Arrow')) {
                  event.preventDefault();
                  event.stopPropagation();
                  onKeyboardMove(node.id, event.key);
                }
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (!dragMovedRef.current) {
                  onSelect(node.id);
                  onFocusNode(node.id);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              {isSelected ? (
                <circle
                  r={position.radius + 5}
                  fill="none"
                  stroke="hsl(var(--foreground))"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.9"
                />
              ) : null}
              {isMatched && !isSelected ? (
                <circle
                  r={position.radius + 4}
                  fill="none"
                  stroke="hsl(var(--foreground))"
                  strokeWidth="1.5"
                  opacity="0.8"
                />
              ) : null}
              <circle
                r={position.radius}
                fill={fill}
                fillOpacity={dimmed ? 0.07 : isHovered || isSelected ? 0.88 : mutedCommunity ? 0.38 : 0.62}
                stroke={fill}
                strokeOpacity={dimmed ? 0.15 : 0.95}
                strokeWidth={isHovered || isSelected ? 2 : 1}
              />
              {showLabel ? (
                <text
                  textAnchor="middle"
                  dy="0.32em"
                  fontSize={Math.min(12, Math.max(9, position.radius * 0.38))}
                  fill="hsl(var(--foreground))"
                  stroke="hsl(var(--background))"
                  strokeWidth="3"
                  paintOrder="stroke"
                  opacity={dimmed ? 0.18 : 1}
                  style={{ pointerEvents: 'none' }}
                >
                  {graphLabel(node.name, unnamedLabel)}
                </text>
              ) : null}
              <title>{t('authors.nodeTitle', { name: displayName, papers: node.paperCount })}</title>
            </g>
          );
        })}
      </g>
    </>
  );
});

function AuthorDetails({ node, neighbors, onClose, onOpenAuthor }) {
  const { t, i18n } = useTranslation('dashboard');
  if (!node) return null;
  return (
    <aside className="absolute inset-x-3 bottom-3 max-h-[44%] overflow-auto rounded-sm border bg-background/95 p-4 shadow-sm backdrop-blur-md md:inset-x-auto md:bottom-auto md:right-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="size-2 rounded-full"
              style={{ background: communityColor(node.community) }}
            />
            {node.community >= 0
              ? t('authors.communityN', { n: node.community + 1 })
              : t('authors.unconnected')}
          </div>
          <h2 className="truncate text-sm font-semibold" title={node.name}>{node.name}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('authors.metricsNote')}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-9 shrink-0" onClick={onClose} title={t('authors.closeDetail')}>
          <X className="size-4" />
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-2 border-y py-3 text-xs">
        <div className="border-r pr-3">
          <dt className="text-muted-foreground">{t('authors.metricPapers')}</dt>
          <dd className="mt-1 font-mono text-base font-semibold tabular-nums">{node.paperCount}</dd>
        </div>
        <div className="pl-3">
          <dt className="text-muted-foreground">{t('authors.metricDegree')}</dt>
          <dd className="mt-1 font-mono text-base font-semibold tabular-nums">{node.metrics?.degree || 0}</dd>
        </div>
        <div className="mt-3 border-r pr-3">
          <dt className="text-muted-foreground">{t('authors.metricStrength')}</dt>
          <dd className="mt-1 font-mono text-base font-semibold tabular-nums">{node.metrics?.weightedDegree || 0}</dd>
        </div>
        <div className="mt-3 pl-3">
          <dt className="text-muted-foreground">{t('authors.metricBetweenness')}</dt>
          <dd className="mt-1 font-mono text-base font-semibold tabular-nums">
            {formatMetric(node.metrics?.betweenness, 'betweenness', i18n.language)}
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium">{t('authors.strongestTies')}</span>
          <span className="text-muted-foreground">k-core {node.metrics?.core || 0}</span>
        </div>
        {neighbors.length ? (
          <ol className="space-y-1.5">
            {neighbors.slice(0, 5).map((entry) => (
              <li key={entry.node.id} className="flex items-center justify-between gap-3 text-xs">
                <button
                  type="button"
                  className="min-w-0 truncate text-left hover:underline"
                  onClick={() => onOpenAuthor(entry.node.id)}
                  title={entry.node.name}
                >
                  {entry.node.name}
                </button>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {t('authors.nPapersUnit', { count: entry.weight })}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-muted-foreground">{t('authors.noTies')}</p>
        )}
      </div>

      <Button className="mt-4 w-full active:scale-[0.98]" size="sm" onClick={() => onOpenAuthor(node.id)}>
        {t('authors.viewAuthorPapers')}
        <ArrowUpRight className="size-4" />
      </Button>
    </aside>
  );
}

export function AuthorGraphCanvas({
  nodes,
  edges,
  communities,
  meta,
  sizeMetric,
  searchQuery,
  selectedId,
  onSelect,
  onOpenAuthor,
  resetToken,
  focusToken,
}) {
  const { t } = useTranslation('dashboard');
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hoveredId, setHoveredId] = useState(null);
  const [keyboardFocusId, setKeyboardFocusId] = useState(nodes[0]?.id ?? null);
  const [coarsePointer, setCoarsePointer] = useState(() => (
    window.matchMedia?.('(any-pointer: coarse)').matches ?? false
  ));
  const { positions, settled, reducedMotion } = useForceLayout(nodes, edges, { ...size, sizeMetric });
  const viewportApiRef = useRef(null);
  const handleDoubleTap = useCallback((point) => {
    viewportApiRef.current?.zoomAt(point, 1.55, { animated: true });
  }, []);
  const viewport = useGraphViewport({
    initialView: centeredView(800, 600),
    reducedMotion,
    onDoubleTap: handleDoubleTap,
  });
  viewportApiRef.current = viewport;
  const {
    view,
    viewRef,
    isInteracting,
    dragMovedRef,
    userInteractedRef,
    interactionVersionRef,
    markUserInteraction,
    commitView,
    animateTo,
    zoomAt,
    cancelAnimation,
    wheelHandler,
    bind,
  } = viewport;
  const lastFocusTokenRef = useRef(0);
  const pendingFocusRef = useRef(null);
  const previousResetTokenRef = useRef(resetToken);
  const previousNodesRef = useRef(nodes);
  const previousSelectedIdRef = useRef(null);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const fitInsets = useMemo(() => {
    if (selectedId == null || !nodeById.has(selectedId)) return {};
    return size.width >= 768
      ? { rightInset: 332 }
      : { bottomInset: size.height * 0.44 + 12 };
  }, [nodeById, selectedId, size.height, size.width]);
  const fittedView = useCallback(
    () => fitView(positions, size, fitInsets),
    [fitInsets, positions, size],
  );
  const neighborsById = useMemo(() => {
    const map = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;
      map.get(source.id).push({ node: target, weight: edge.weight });
      map.get(target.id).push({ node: source, weight: edge.weight });
    }
    for (const list of map.values()) list.sort((a, b) => b.weight - a.weight || a.node.name.localeCompare(b.node.name));
    return map;
  }, [edges, nodeById, nodes]);

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchedIds = useMemo(() => {
    if (!normalizedSearch) return null;
    const matches = new Set();
    for (const node of nodes) {
      if (node.name.toLocaleLowerCase().includes(normalizedSearch)) matches.add(node.id);
    }
    return matches;
  }, [nodes, normalizedSearch]);

  const focusedId = hoveredId ?? selectedId;
  const neighborIds = useMemo(() => {
    if (focusedId == null) return null;
    const result = new Set([focusedId]);
    for (const entry of neighborsById.get(focusedId) || []) result.add(entry.node.id);
    return result;
  }, [focusedId, neighborsById]);

  useEffect(() => {
    const media = window.matchMedia('(any-pointer: coarse)');
    const update = () => setCoarsePointer(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const update = () => {
      const width = Math.round(element.clientWidth);
      const height = Math.round(element.clientHeight);
      setSize((current) => (
        current.width === width && current.height === height ? current : { width, height }
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return undefined;
    element.addEventListener('wheel', wheelHandler, { passive: false });
    return () => element.removeEventListener('wheel', wheelHandler);
  }, [wheelHandler]);

  useEffect(() => {
    if (previousResetTokenRef.current === resetToken) return;
    previousResetTokenRef.current = resetToken;
    markUserInteraction();
    userInteractedRef.current = false;
    animateTo(fittedView());
    // The token is the command. Position ticks should not replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  useEffect(() => {
    if (previousNodesRef.current === nodes) return;
    previousNodesRef.current = nodes;
    userInteractedRef.current = false;
    cancelAnimation();
    commitView(centeredView(size.width, size.height));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useEffect(() => {
    if (!settled || userInteractedRef.current || positions.size !== nodes.length) return;
    if (!nodes.every((node) => positions.has(node.id))) return;
    animateTo(fittedView());
  }, [animateTo, fittedView, nodes, positions, settled, userInteractedRef]);

  const focusNode = useCallback((nodeId) => {
    const position = positions.get(nodeId);
    if (!position) return;
    const current = viewRef.current;
    const k = Math.max(current.k, 1.05);
    const targetX = size.width >= 768 && selectedId != null
      ? (size.width - 320) / 2
      : size.width / 2;
    const targetY = size.width < 768 && selectedId != null ? size.height * 0.32 : size.height / 2;
    animateTo({
      x: targetX - position.x * k,
      y: targetY - position.y * k,
      k,
    });
  }, [animateTo, positions, selectedId, size.height, size.width, viewRef]);

  useEffect(() => {
    if (!focusToken || focusToken === lastFocusTokenRef.current) return;
    pendingFocusRef.current = {
      token: focusToken,
      nodeId: selectedId,
      interactionVersion: interactionVersionRef.current,
    };
  }, [focusToken, interactionVersionRef, selectedId]);

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || pending.token !== focusToken || !settled) return;
    if (selectedId == null) {
      lastFocusTokenRef.current = pending.token;
      pendingFocusRef.current = null;
      return;
    }
    if (!positions.has(selectedId)) return;
    lastFocusTokenRef.current = pending.token;
    pendingFocusRef.current = null;
    previousSelectedIdRef.current = selectedId;
    if (interactionVersionRef.current !== pending.interactionVersion) return;
    focusNode(selectedId);
  }, [focusNode, focusToken, interactionVersionRef, positions, selectedId, settled]);

  useEffect(() => {
    if (selectedId != null && !nodeById.has(selectedId)) onSelect(null);
  }, [nodeById, onSelect, selectedId]);

  useEffect(() => {
    if (selectedId != null) setKeyboardFocusId(selectedId);
    else if (keyboardFocusId == null || !nodeById.has(keyboardFocusId)) setKeyboardFocusId(nodes[0]?.id ?? null);
  }, [keyboardFocusId, nodeById, nodes, selectedId]);

  const ensureNodeVisible = useCallback((nodeId) => {
    const position = positions.get(nodeId);
    if (!position) return;
    const current = viewRef.current;
    const radius = position.radius * current.k;
    const screenX = current.x + position.x * current.k;
    const screenY = current.y + position.y * current.k;
    const horizontalPadding = 24 + radius;
    const verticalPadding = 24 + radius;
    const left = horizontalPadding;
    const right = size.width - (fitInsets.rightInset || 0) - horizontalPadding;
    const top = verticalPadding;
    const bottom = size.height - (fitInsets.bottomInset || 0) - verticalPadding;
    const targetX = right < left
      ? (left + right) / 2
      : Math.min(right, Math.max(left, screenX));
    const targetY = bottom < top
      ? (top + bottom) / 2
      : Math.min(bottom, Math.max(top, screenY));
    const dx = targetX - screenX;
    const dy = targetY - screenY;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    animateTo({ x: current.x + dx, y: current.y + dy, k: current.k });
  }, [animateTo, fitInsets.bottomInset, fitInsets.rightInset, positions, size.height, size.width, viewRef]);

  useEffect(() => {
    if (selectedId == null) {
      previousSelectedIdRef.current = null;
      return;
    }
    if (pendingFocusRef.current?.nodeId === selectedId) return;
    if (previousSelectedIdRef.current === selectedId || !positions.has(selectedId)) return;
    previousSelectedIdRef.current = selectedId;
    ensureNodeVisible(selectedId);
  }, [ensureNodeVisible, positions, selectedId]);

  const moveKeyboardFocus = useCallback((nodeId, key) => {
    const origin = positions.get(nodeId);
    if (!origin) return;
    const direction = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }[key];
    if (!direction) return;
    let best = null;
    for (const node of nodes) {
      if (node.id === nodeId) continue;
      const candidate = positions.get(node.id);
      if (!candidate) continue;
      const dx = candidate.x - origin.x;
      const dy = candidate.y - origin.y;
      const forward = dx * direction[0] + dy * direction[1];
      if (forward <= 0) continue;
      const d = Math.hypot(dx, dy);
      const alignment = forward / Math.max(1, d);
      const score = d / Math.max(0.08, alignment * alignment);
      if (!best || score < best.score) best = { id: node.id, score };
    }
    if (!best) return;
    markUserInteraction();
    setKeyboardFocusId(best.id);
    requestAnimationFrame(() => {
      svgRef.current?.querySelector(`[data-node-id="${best.id}"]`)?.focus();
    });
  }, [markUserInteraction, nodes, positions]);

  const findNodeAt = useCallback((clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    const minimumRadius = coarsePointer ? 22 : 8;
    let best = null;
    for (const node of nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const radius = position.radius * view.k;
      const distanceToCenter = Math.hypot(
        screenX - (view.x + position.x * view.k),
        screenY - (view.y + position.y * view.k),
      );
      if (distanceToCenter > Math.max(radius, minimumRadius)) continue;
      const insideVisibleBubble = distanceToCenter <= radius;
      const score = distanceToCenter - radius;
      if (!best
        || (insideVisibleBubble && !best.insideVisibleBubble)
        || (insideVisibleBubble === best.insideVisibleBubble && score < best.score)) {
        best = { id: node.id, insideVisibleBubble, score };
      }
    }
    return best?.id ?? null;
  }, [coarsePointer, nodes, positions, view.k, view.x, view.y]);

  const hoveredNode = hoveredId == null ? null : nodeById.get(hoveredId);
  const selectedNode = selectedId == null ? null : nodeById.get(selectedId);
  const selectedNeighbors = selectedId == null ? [] : (neighborsById.get(selectedId) || []);
  const visibleCommunities = communities.slice(0, MAX_COLORED_COMMUNITIES);

  return (
    <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden bg-background">
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="select-none"
        role="group"
        aria-label={t('authors.graphAria', { nodes: meta.nodeCount, edges: meta.edgeCount })}
        {...bind}
        onDoubleClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, 1.55, { animated: true });
        }}
        onClick={(event) => {
          if (!dragMovedRef.current) onSelect(findNodeAt(event.clientX, event.clientY));
        }}
        style={{ cursor: isInteracting ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <GraphScene
            nodes={nodes}
            edges={edges}
            positions={positions}
            neighborIds={neighborIds}
            matchedIds={matchedIds}
            hoveredId={hoveredId}
            selectedId={selectedId}
            keyboardFocusId={keyboardFocusId}
            onHover={setHoveredId}
            onSelect={onSelect}
            onOpenAuthor={onOpenAuthor}
            onFocusNode={focusNode}
            onEnsureVisible={ensureNodeVisible}
            onKeyboardFocus={setKeyboardFocusId}
            onKeyboardMove={moveKeyboardFocus}
            dragMovedRef={dragMovedRef}
          />
        </g>
      </svg>

      {reducedMotion && positions.size !== nodes.length ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-sm border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            {t('authors.layouting')}
          </span>
        </div>
      ) : null}

      <div
        className={`absolute top-3 flex items-center overflow-hidden rounded-sm border bg-background/90 shadow-sm backdrop-blur-md ${selectedNode ? 'right-3 md:right-[21rem]' : 'right-3'}`}
        role="group"
        aria-label={t('authors.zoomAria')}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-none border-r active:scale-[0.96] sm:size-9"
          onClick={() => {
            markUserInteraction();
            zoomAt({ x: size.width / 2, y: size.height / 2 }, 1 / 1.25, { animated: true });
          }}
          title={t('authors.zoomOut')}
        >
          <Minus className="size-4" />
        </Button>
        <button
          type="button"
          className="h-11 min-w-14 border-r px-2 font-mono text-[11px] tabular-nums text-muted-foreground hover:bg-muted/60 active:bg-muted sm:h-9"
          onClick={() => {
            markUserInteraction();
            userInteractedRef.current = false;
            animateTo(fittedView());
          }}
          title={t('authors.fitCanvas')}
        >
          {Math.round(view.k * 100)}%
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-none border-r active:scale-[0.96] sm:size-9"
          onClick={() => {
            markUserInteraction();
            zoomAt({ x: size.width / 2, y: size.height / 2 }, 1.25, { animated: true });
          }}
          title={t('authors.zoomIn')}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 rounded-none active:scale-[0.96] sm:size-9"
          onClick={() => {
            markUserInteraction();
            userInteractedRef.current = false;
            animateTo(fittedView());
          }}
          title={t('authors.fitCanvas')}
        >
          <LocateFixed className="size-4" />
        </Button>
      </div>

      {hoveredNode && hoveredId !== selectedId ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-sm border bg-popover/95 px-3 py-2 text-sm shadow-sm backdrop-blur-sm">
          <div className="max-w-64 truncate font-medium">{hoveredNode.name || t('authors.unnamed')}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t('authors.hoverPapers', {
              papers: hoveredNode.paperCount,
              degree: hoveredNode.metrics?.degree || 0,
            })}
          </div>
        </div>
      ) : null}

      {!selectedNode && visibleCommunities.length ? (
        <div className="pointer-events-none absolute bottom-3 left-3 hidden max-w-sm rounded-sm border bg-background/90 px-3 py-2 backdrop-blur-sm sm:block">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Network className="size-3.5" />
            {t('authors.mainCommunities')}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {visibleCommunities.map((community) => (
              <span key={community.id} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: communityColor(community.id) }} />
                {t('authors.communityPeople', { id: community.id + 1, count: community.nodeCount })}
              </span>
            ))}
            {communities.length > visibleCommunities.length ? (
              <span className="text-[11px] text-muted-foreground">{t('authors.otherCommunitiesGray')}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      <AuthorDetails
        node={selectedNode}
        neighbors={selectedNeighbors}
        onClose={() => onSelect(null)}
        onOpenAuthor={onOpenAuthor}
      />
    </div>
  );
}
