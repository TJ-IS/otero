import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MissingDoisModal } from '@/components/dashboard/MissingDoisModal';

const TARGET_FILL = 'hsl(var(--chart-1))';
const COLLECTED_FILL = 'hsl(var(--chart-2))';
const INTERSECTION_FILL = 'hsl(var(--chart-good))';

function formatCount(n, lng) {
  return Number(n || 0).toLocaleString(lng || 'zh-CN');
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
 * Near-subset cases get a minimum center gap so crescents and labels stay readable.
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
    // Near-subset: nest with a visible offset so the crescent remains readable
    d = Math.abs(rA - rB) + Math.min(rA, rB) * 0.28;
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

  // Keep crescents wide enough for count labels (schematic breathing room)
  const minD = Math.min(rA, rB) * 0.48;
  if (d < minD) d = minD;

  const padX = 36;
  const padTop = 20;
  const padBottom = 16;
  const rawW = rA + d + rB;
  const rawH = Math.max(rA, rB) * 2;
  const scale = 260 / Math.max(rawW, rawH);
  rA *= scale;
  rB *= scale;
  d *= scale;

  const cxA = padX + rA;
  const cxB = cxA + d;
  const cy = padTop + Math.max(rA, rB);
  const width = cxB + rB + padX;
  const height = cy + Math.max(rA, rB) + padBottom;

  // Crescent / lobe anchors (not circle centers)
  const leftEdgeA = cxA - rA;
  const leftEdgeB = cxB - rB;
  const rightEdgeA = cxA + rA;
  const rightEdgeB = cxB + rB;

  let targetOnlyX = (leftEdgeA + Math.min(leftEdgeB, cxA)) / 2;
  let intersectionX = (cxA + cxB) / 2;
  let collectedOnlyX = (Math.max(rightEdgeA, cxB) + rightEdgeB) / 2;

  // Prefer the smaller circle's center for the intersection when heavily nested
  if (d + Math.min(rA, rB) < Math.max(rA, rB) * 0.85) {
    intersectionX = rB <= rA ? cxB : cxA;
  }

  let targetOnlyY = cy;
  let intersectionY = cy;
  let collectedOnlyY = cy;

  // Stagger vertically if labels would collide horizontally
  const minGap = 42;
  if (Math.abs(intersectionX - targetOnlyX) < minGap) {
    targetOnlyY = cy - Math.min(rA, rB) * 0.42;
    intersectionY = cy + Math.min(rA, rB) * 0.12;
  }
  if (Math.abs(collectedOnlyX - intersectionX) < minGap) {
    collectedOnlyY = cy + Math.min(rA, rB) * 0.38;
    if (Math.abs(intersectionY - cy) < 4) intersectionY = cy - Math.min(rA, rB) * 0.08;
  }

  // Tiny collected-only crescent: park the number just outside the right edge
  if (collectedOnly > 0 && collectedOnly < Math.max(1, intersection) * 0.05) {
    collectedOnlyX = Math.max(collectedOnlyX, rightEdgeA + 14, rightEdgeB - rB * 0.15);
    collectedOnlyY = cy;
  }

  return {
    width,
    height,
    cy,
    left: { cx: cxA, r: rA },
    right: { cx: cxB, r: rB },
    labels: {
      targetOnly: { x: targetOnlyX, y: targetOnlyY },
      intersection: { x: intersectionX, y: intersectionY },
      collectedOnly: { x: collectedOnlyX, y: collectedOnlyY },
    },
  };
}

export function DoiCoverageVenn({ data }) {
  const { t, i18n } = useTranslation('dashboard');
  const uid = useId();
  const clipLeft = `${uid}-clip-left`;
  const [hover, setHover] = useState(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const lng = i18n.language;

  const regions = [
    {
      id: 'targetOnly',
      label: t('venn.targetMissing'),
      hint: t('venn.targetMissingHint'),
      color: TARGET_FILL,
      actionable: true,
    },
    {
      id: 'intersection',
      label: t('venn.collected'),
      hint: t('venn.collectedHint'),
      color: INTERSECTION_FILL,
      actionable: false,
    },
    {
      id: 'collectedOnly',
      label: t('venn.extra'),
      hint: t('venn.extraHint'),
      color: COLLECTED_FILL,
      actionable: false,
    },
  ];

  const layout = useMemo(
    () => layoutVenn(data.targetOnly, data.intersection, data.collectedOnly),
    [data.targetOnly, data.intersection, data.collectedOnly],
  );

  const counts = {
    targetOnly: data.targetOnly,
    intersection: data.intersection,
    collectedOnly: data.collectedOnly,
  };

  const canOpenMissing = (data.targetOnly || 0) > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center">
      <div className="relative mx-auto w-full max-w-lg">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="mx-auto h-auto w-full"
          role="img"
          aria-label={t('venn.aria', {
            target: formatCount(data.targetTotal, lng),
            intersection: formatCount(data.intersection, lng),
            extra: formatCount(data.collectedOnly, lng),
          })}
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
            onClick={() => {
              if (canOpenMissing) setMissingOpen(true);
            }}
            className={canOpenMissing ? 'cursor-pointer' : undefined}
          />

          {/* Collected circle (library) */}
          <circle
            cx={layout.right.cx}
            cy={layout.cy}
            r={layout.right.r}
            fill={COLLECTED_FILL}
            fillOpacity={
              hover && hover !== 'collectedOnly' && hover !== 'intersection' ? 0.1 : 0.22
            }
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
            className={`fill-foreground ${canOpenMissing ? 'cursor-pointer' : ''}`}
            style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
            onClick={() => {
              if (canOpenMissing) setMissingOpen(true);
            }}
            onMouseEnter={() => setHover('targetOnly')}
            onMouseLeave={() => setHover(null)}
          >
            {formatCount(data.targetOnly, lng)}
          </text>
          <text
            x={layout.labels.intersection.x}
            y={layout.labels.intersection.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground"
            style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            onMouseEnter={() => setHover('intersection')}
            onMouseLeave={() => setHover(null)}
          >
            {formatCount(data.intersection, lng)}
          </text>
          <text
            x={layout.labels.collectedOnly.x}
            y={layout.labels.collectedOnly.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground"
            style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
            onMouseEnter={() => setHover('collectedOnly')}
            onMouseLeave={() => setHover(null)}
          >
            {formatCount(data.collectedOnly, lng)}
          </text>
        </svg>

        <div className="mt-2 flex items-center justify-between gap-4 px-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: TARGET_FILL }} />
            {t('venn.targetList')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-full" style={{ background: COLLECTED_FILL }} />
            {t('venn.libraryDois')}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">{t('venn.coverageRate')}</p>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">
              {data.coveragePct}
              <span className="ml-0.5 text-sm font-medium text-muted-foreground">%</span>
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="motion-progress h-full origin-left rounded-full bg-[hsl(var(--chart-good))]"
              style={{ transform: `scaleX(${Math.min(100, data.coveragePct) / 100})` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('venn.collectedOfTarget', {
              intersection: formatCount(data.intersection, lng),
              target: formatCount(data.targetTotal, lng),
            })}
          </p>
        </div>

        <ul className="divide-y border border-border/80">
          {regions.map((r) => {
            const active = hover === r.id;
            const isAction = r.actionable && canOpenMissing;
            return (
              <li key={r.id}>
                <div
                  className={`flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                    isAction
                      ? 'cursor-pointer hover:bg-muted/50 active:scale-[0.995]'
                      : 'cursor-default'
                  }`}
                  style={{ background: active ? 'hsl(var(--muted) / 0.55)' : undefined }}
                  onMouseEnter={() => setHover(r.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={isAction ? () => setMissingOpen(true) : undefined}
                  onKeyDown={
                    isAction
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setMissingOpen(true);
                          }
                        }
                      : undefined
                  }
                  role={isAction ? 'button' : undefined}
                  tabIndex={isAction ? 0 : undefined}
                >
                  <span
                    className="mt-1 size-2.5 shrink-0 rounded-full"
                    style={{ background: r.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-sm font-semibold tabular-nums">
                        {formatCount(counts[r.id], lng)}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">{r.hint}</p>
                    {isAction ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="mt-1 h-auto px-0 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMissingOpen(true);
                        }}
                      >
                        {t('venn.viewMissing')}
                        <ExternalLink className="size-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <MissingDoisModal open={missingOpen} onOpenChange={setMissingOpen} />
    </div>
  );
}
