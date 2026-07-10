import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Moon, Sun, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useForceLayout } from '@/lib/authorGraph';

const DEFAULT_MIN_PAPERS = 10;

export function AuthorGraph() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [minPapers, setMinPapers] = useState(DEFAULT_MIN_PAPERS);
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState(null);
  const containerRef = useRef(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  // Pan/zoom state (manual, no d3-zoom — matches the project's existing
  // hand-rolled drag pattern in LibraryView.jsx).
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef({ dragging: false, startX: 0, startY: 0, startViewX: 0, startViewY: 0 });

  const loadGraph = useCallback((mp) => {
    setLoading(true);
    api.getAuthorGraph(mp)
      .then((g) => setGraph(g))
      .catch((err) => toast.error(`加载学者关系图失败: ${err.message}`))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadGraph(minPapers);
  }, [minPapers, loadGraph]);

  // Track container size for the force center + SVG viewport.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const positions = useForceLayout(nodes, edges, size);

  const neighborIds = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set([hoveredId]);
    for (const e of edges) {
      if (e.source === hoveredId) set.add(e.target);
      if (e.target === hoveredId) set.add(e.source);
    }
    return set;
  }, [hoveredId, edges]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setView((v) => {
      const k = Math.min(4, Math.max(0.2, v.k * (1 + delta)));
      return { ...v, k };
    });
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    panRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startViewX: view.x,
      startViewY: view.y,
    };
  }, [view.x, view.y]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!panRef.current.dragging) return;
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setView((v) => ({ ...v, x: panRef.current.startViewX + dx, y: panRef.current.startViewY + dy }));
    };
    const handleMouseUp = () => { panRef.current.dragging = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const resetView = () => setView({ x: 0, y: 0, k: 1 });

  const hoveredNode = hoveredId != null ? nodes.find(n => n.id === hoveredId) : null;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          title="返回文库"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Button>

        <span className="text-sm font-medium">学者合作关系图</span>

        <div className="ml-4 flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">最少发文数</span>
          <input
            type="range"
            min={1}
            max={15}
            value={minPapers}
            onChange={(e) => setMinPapers(Number(e.target.value))}
            className="w-32 accent-primary"
          />
          <Badge variant="outline" className="font-mono text-xs font-normal tabular-nums">{minPapers}</Badge>
        </div>

        {graph && (
          <Badge variant="secondary" className="hidden font-normal md:inline-flex">
            {nodes.length} 位学者 · {edges.length} 条合作关系
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={resetView} title="重置视图">
            <RefreshCw className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ cursor: panRef.current.dragging ? 'grabbing' : 'grab' }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 text-muted-foreground">
            <RefreshCw className="size-5 animate-spin opacity-60" />
            <span className="text-sm">正在计算合作网络…</span>
          </div>
        )}

        {!loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            没有满足条件的学者，试试降低最少发文数
          </div>
        )}

        <svg width={size.width} height={size.height} className="select-none">
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            <g className="opacity-70">
              {edges.map((e, i) => {
                const s = positions.get(e.source);
                const t = positions.get(e.target);
                if (!s || !t) return null;
                const dimmed = neighborIds && !(neighborIds.has(e.source) && neighborIds.has(e.target));
                return (
                  <line
                    key={i}
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={Math.min(3, 0.5 + e.weight * 0.4)}
                    strokeOpacity={dimmed ? 0.06 : Math.min(0.6, 0.15 + e.weight * 0.1)}
                  />
                );
              })}
            </g>
            <g>
              {nodes.map((n) => {
                const p = positions.get(n.id);
                if (!p) return null;
                const dimmed = neighborIds && !neighborIds.has(n.id);
                const isHovered = hoveredId === n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x},${p.y})`}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId((cur) => (cur === n.id ? null : cur))}
                    onClick={() => navigate(`/authors/${n.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <circle
                      r={p.radius}
                      fill="hsl(var(--primary))"
                      fillOpacity={dimmed ? 0.12 : isHovered ? 0.9 : 0.55}
                      stroke="hsl(var(--primary))"
                      strokeOpacity={dimmed ? 0.2 : 1}
                      strokeWidth={isHovered ? 2 : 1}
                    />
                    {p.radius > 14 && (
                      <text
                        textAnchor="middle"
                        dy="0.32em"
                        fontSize={Math.min(12, p.radius * 0.4)}
                        fill="hsl(var(--primary-foreground))"
                        opacity={dimmed ? 0.15 : 1}
                        style={{ pointerEvents: 'none' }}
                      >
                        {n.name}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {hoveredNode && (
          <div className="pointer-events-none absolute left-4 top-4 rounded-md border bg-popover px-3 py-2 text-sm shadow-lg">
            <div className="font-medium">{hoveredNode.name || '(未命名)'}</div>
            <div className="text-xs text-muted-foreground">
              {hoveredNode.paperCount} 篇论文 · {neighborIds ? neighborIds.size - 1 : 0} 位合作者
            </div>
            <div className="text-xs text-muted-foreground/70 mt-0.5">点击查看论文列表</div>
          </div>
        )}
      </div>
    </div>
  );
}
