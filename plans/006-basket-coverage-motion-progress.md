# 006 — Use motion-progress for basket coverage bars

- **Status**: DONE
- **Commit**: e19e9bd
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (`BasketCoveragePanel.jsx`)

## Problem

Journal coverage bars set `width` as a percentage with no transition. The same dashboard already animates coverage with compositor-friendly `scaleX` via `.motion-progress`.

```jsx
/* web/src/components/dashboard/BasketCoveragePanel.jsx:155-159 — current */
<span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
  <span
    className="block h-full rounded-full bg-[hsl(var(--chart-good))]"
    style={{ width: `${Math.min(100, r.coveragePct)}%` }}
  />
</span>
```

## Target

Match the Venn exemplar exactly:

```jsx
/* web/src/components/dashboard/DoiCoverageVenn.jsx:300-304 — exemplar */
<div className="h-2 overflow-hidden rounded-full bg-muted">
  <div
    className="motion-progress h-full origin-left rounded-full bg-[hsl(var(--chart-good))]"
    style={{ transform: `scaleX(${Math.min(100, data.coveragePct) / 100})` }}
  />
</div>
```

For BasketCoveragePanel row bars (keep `h-1 w-16` track size):

```jsx
<span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
  <span
    className="motion-progress block h-full origin-left rounded-full bg-[hsl(var(--chart-good))]"
    style={{ transform: `scaleX(${Math.min(100, r.coveragePct) / 100})` }}
  />
</span>
```

`.motion-progress` already defines:

```css
/* web/src/index.css:99-101 */
.motion-progress {
  transition: transform 220ms var(--motion-ease-out);
}
```

and under reduced motion `transition: none`.

Inner bar must be full width of the track (default `width: 100%` / `w-full` / `block` filling the span) so `scaleX` maps 0–1 correctly. Add `w-full` if `block h-full` alone does not stretch.

## Repo conventions to follow

- Exemplar: `DoiCoverageVenn.jsx:301-303`.
- Token curve: `--motion-ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; duration 220ms via `.motion-progress`.

## Steps

1. Edit `BasketCoveragePanel.jsx` bar markup as above.
2. Visually confirm bars still right-aligned in the table cell and fill left→right (`origin-left`).
3. No CSS token changes.

## Boundaries

- Do NOT change table data, missing-DOI filters, or chart colors.
- Do NOT animate `width`.
- Do NOT touch other dashboard panels in this plan.

## Verification

- **Mechanical**: open Dashboard basket coverage; bars render for each journal.
- **Feel check**:
  - On load / data arrival, fill grows over ~220ms ease-out from the left.
  - `prefers-reduced-motion: reduce`: bar appears at final width with no transition.
- **Done when**: uses `motion-progress` + `scaleX`, no percentage `width` on the fill.
