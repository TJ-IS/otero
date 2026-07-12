import { useId, useMemo, useState } from 'react';

const TARGET_FILL = 'hsl(var(--chart-1))';
const COLLECTED_FILL = 'hsl(var(--chart-2))';
const INTERSECTION_FILL = 'hsl(var(--chart-good))';

function formatCount(n) {
  return Number(n || 0).toLocaleString('zh-CN');
}

/** Intersection area of two circles with radii r1, r2 and center distance d. */
function circleIntersectionArea(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const r1sq = r1 * r1;
  const r2sq = r2 * r2;
  const alpha = Math.acos((d * d + r1sq - r2sq) / (2 * d * r1)) * 2;
  const beta = Math.acos((d * d + r2sq - r1sq) / (2 * d * r2)) * 2;
  return 0.5 * r1sq * (alpha - Math.sin(alpha)) + 0.5 * r2sq * (beta - Math.sin(beta));
}

/**
 * Area-proportional two-circle layout for sets A (target) and B (collected).
 * Returns circle centers/radii in a unit space, plus label anchors.
 */
function layoutVenn(targetOnly, intersection, collectedOnly) {
  const setA = Math.max(1, targetOnly + intersection);
  const setB = Math.max(1, collectedOnly + intersection);
  const wantOverlap = Math.min(intersection, setA, setB);

  let rA = Math.sqrt(setA / Math.PI);
  let rB = Math.sqrt(setB / Math.PI);

  let d;
  if (wantOverlap <= 0) {
    d = rA + rB + Math.max(rA, rB) * 0.08;
  } else if (wantOverlap >= Math.min(setA, setB) * 0.999) {
    // Near-subset: nest with a small visible offset
    d = Math.abs(rA - rB) + Math.min(rA, rB) * 0.15;
  } else {
    let lo = Math.abs(rA - rB) + 1e-6;
    let hi = rA + rB - 1e-6;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const area = circleIntersectionArea(rA, rB, mid);
      if (area > wantOverlap) lo = mid;
      else hi = mid;
    }
    d = (lo + hi) / 2;
  }

  // Scale into viewBox with padding
  const pad = 28;
  const rawW = rA + d + rB;
  const rawH = Math.max(rA, rB) * 2;
  const scale = 280 / Math.max(rawW, rawH);
  rA *= scale;
  rB *= scale;
  d *= scale;

  const cxA = pad + rA;
  const cxB = cxA + d;
  const cy = pad + Math.max(rA, rB);
  const width = cxB + rB + pad;
  const height = cy + Math.max(rA, rB) + pad;

  // Label anchors: left lobe, overlap, right lobe
  const midX = (cxA + cxB) / 2;
  const leftOnlyX = cxA - rA * 0.35;
  const rightOnlyX = cxB + rB * 0.35;

  return {
    width,
    height,
    cy,
    left: { cx: cxA, r: rA },
    right: { cx: cxB, r: rB },
    labels: {
      targetOnly: { x: leftOnlyX, y: cy },
      intersection: { x: midX, y: cy },
      collectedOnly: { x: rightOnlyX, y: cy },
    },
  };
}

const REGIONS = [
  {
    id: 'targetOnly',
    label: '目标未收录',
    hint: 'AIS Basket 目标清单中有、文库尚未收录',
    color: TARGET_FILL,
  },
  {
    id: 'intersection',
    label: '已收录',
    hint: '目标清单与文库的交集',
    color: INTERSECTION_FILL,
  },
  {
    id: 'collectedOnly',
    label: '清单外收录',
    hint: '文库已有、但不在 AIS Basket 目标清单中',
    color: COLLECTED_FILL,
  },
];

export function DoiCoverageVenn({ data }) {
  const uid = useId();
  const clipLeft = `${uid}-clip-left`;
  const [hover, setHover] = useState(null);

  const layout = useMemo(
    () => layoutVenn(data.targetOnly, data.intersection, data.collectedOnly),
    [data.targetOnly, data.intersection, data.collectedOnly],
  );

  const counts = {
    targetOnly: data.targetOnly,
    intersection: data.intersection,
    collectedOnly: data.collectedOnly,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
      <div className="relative mx-auto w-full max-w-lg">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="mx-auto h-auto w-full"
          role="img"
          aria-label={`AIS Basket DOI 收录维恩图：目标 ${formatCount(data.targetTotal)}，已收录交集 ${formatCount(data.intersection)}，清单外 ${formatCount(data.collectedOnly)}`}
        >
          <defs>
            <clipPath id={clipLeft}>
              <circle cx={layout.left.cx} cy={layout.cy} r={layout.left.r} />
            </clipPath>
          </defs>

          {/* Target circle (AIS Basket) */}
          <circle
            cx={layout.left.cx}
            cy={layout.cy}
            r={layout.left.r}
            fill={TARGET_FILL}
            fillOpacity={hover && hover !== 'targetOnly' && hover !== 'intersection' ? 0.1 : 0.22}
            stroke={TARGET_FILL}
            strokeWidth={1.5}
            strokeOpacity={0.75}
            style={{ transition: 'fill-opacity 160ms ease' }}
            onMouseEnter={() => setHover('targetOnly')}
            onMouseLeave={() => setHover(null)}
          />

          {/* Collected circle (library) */}
          <circle
            cx={layout.right.cx}
            cy={layout.cy}
            r={layout.right.r}
            fill={COLLECTED_FILL}
            fillOpacity={hover && hover !== 'collectedOnly' && hover !== 'intersection' ? 0.1 : 0.22}
            stroke={COLLECTED_FILL}
            strokeWidth={1.5}
            strokeOpacity={0.75}
            style={{ transition: 'fill-opacity 160ms ease' }}
            onMouseEnter={() => setHover('collectedOnly')}
            onMouseLeave={() => setHover(null)}
          />

          {/* Intersection lobe */}
          <g
            clipPath={`url(#${clipLeft})`}
            opacity={hover && hover !== 'intersection' ? 0.35 : 1}
            style={{ transition: 'opacity 160ms ease' }}
            onMouseEnter={() => setHover('intersection')}
            onMouseLeave={() => setHover(null)}
          >
            <circle
              cx={layout.right.cx}
              cy={layout.cy}
              r={layout.right.r}
              fill={INTERSECTION_FILL}
              fillOpacity={0.55}
            />
          </g>

          {/* Count labels */}
          <text
            x={layout.labels.targetOnly.x}
            y={layout.labels.targetOnly.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground"
            style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatCount(data.targetOnly)}
          </text>
          <text
            x={layout.labels.intersection.x}
            y={layout.labels.intersection.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground"
            style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatCount(data.intersection)}
          </text>
          <text
            x={layout.labels.collectedOnly.x}
            y={layout.labels.collectedOnly.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground"
            style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatCount(data.collectedOnly)}
          </text>

          {/* Circle titles under lobes */}
          <text
            x={layout.left.cx}
            y={layout.height - 10}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 11 }}
          >
            AIS Basket 目标
          </text>
          <text
            x={layout.right.cx}
            y={layout.height - 10}
            textAnchor="middle"
            className="fill-muted-foreground"
            style={{ fontSize: 11 }}
          >
            文库已收录
          </text>
        </svg>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">目标清单覆盖率</p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {data.coveragePct}
              <span className="ml-0.5 text-sm font-medium text-muted-foreground">%</span>
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[hsl(var(--chart-good))] transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(100, data.coveragePct)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            已收录 {formatCount(data.intersection)} / 目标 {formatCount(data.targetTotal)} 篇
          </p>
        </div>

        <ul className="divide-y rounded-lg border">
          {REGIONS.map((r) => {
            const active = hover === r.id;
            return (
              <li
                key={r.id}
                className="flex cursor-default items-start gap-3 px-3 py-2.5 transition-colors"
                style={{ background: active ? 'hsl(var(--muted) / 0.55)' : undefined }}
                onMouseEnter={() => setHover(r.id)}
                onMouseLeave={() => setHover(null)}
              >
                <span
                  className="mt-1 size-2.5 shrink-0 rounded-full"
                  style={{ background: r.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{r.label}</p>
                    <p className="text-sm font-semibold tabular-nums">{formatCount(counts[r.id])}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">{r.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
